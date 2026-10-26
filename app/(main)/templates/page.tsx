"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "@/components/AppProvider";
import { Empty, Modal, Toast } from "@/components/ui";
import type { Template, TemplateStage } from "@/lib/types";
import { cleanRoles, deptWithRole, parseDeptList, parseDeptRole } from "@/lib/departments";

export default function TemplatesPage() {
  const { me } = useApp();
  const [list, setList] = useState<Template[]>([]);
  const [edit, setEdit] = useState<Template | null>(null);
  const [rows, setRows] = useState<TemplateStage[]>([]);
  const [name, setName] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const canEdit = !!me?.is_game_part;

  async function load() {
    const { data } = await supabase().from("templates").select("*").order("created_at");
    setList((data ?? []) as Template[]);
  }
  useEffect(() => {
    load();
  }, []);

  function open(t: Template | null) {
    setEdit(t ?? ({ id: "", name: "", description: null, stages: [], created_at: "" } as Template));
    setName(t?.name ?? "새 템플릿");
    setRows(t ? t.stages.map((s) => ({ ...s })) : [{ name: "", department: "게임파트", start_week: 1, weeks: 1 }]);
  }

  async function save() {
    if (!edit) return;
    const clean = rows.filter((r) => r.name.trim()).map((r) => ({ ...r, name: r.name.trim() }));
    const sb = supabase();
    const { error } = edit.id
      ? await sb.from("templates").update({ name, stages: clean }).eq("id", edit.id)
      : await sb.from("templates").insert({ name, stages: clean });
    setToast(error ? error.message : "저장했습니다");
    setTimeout(() => setToast(null), 2000);
    setEdit(null);
    load();
  }

  async function remove(t: Template) {
    if (!confirm(`'${t.name}' 템플릿을 삭제할까요? (이미 만든 프로젝트에는 영향 없음)`)) return;
    await supabase().from("templates").delete().eq("id", t.id);
    load();
  }

  const setRow = (i: number, patch: Partial<TemplateStage>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const num = (v: string) => (v === "" ? null : Number(v));

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">단계 템플릿</h1>
          <p className="mt-1 text-sm text-slate-500">새 프로젝트를 만들 때 불러올 단계 구성입니다. 프로젝트 화면의 ⋯ 메뉴에서도 저장할 수 있어요.</p>
        </div>
        {canEdit && (
          <button className="btn-primary" onClick={() => open(null)} data-tour="tpl-add">
            + 템플릿
          </button>
        )}
      </div>

      {list.length === 0 ? (
        <Empty>템플릿이 없습니다.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-tour="tpl-list">
          {list.map((t) => (
            <div key={t.id} className="card flex flex-col">
              <div className="border-b border-black/[0.06] px-4 py-3">
                <div className="font-medium">{t.name}</div>
                {t.description && <div className="text-xs text-slate-500">{t.description}</div>}
              </div>
              <ol className="flex-1 space-y-1 px-4 py-3 text-sm">
                {t.stages.map((s, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="w-4 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                    <span className="flex-1 truncate">
                      {s.name}
                      {s.related_departments?.length ? (
                        <span className="text-xs text-violet-600"> +{s.related_departments.map((d) => deptWithRole(d, s.dept_roles?.[d])).join(", ")}</span>
                      ) : null}
                    </span>
                    <span className="text-xs tabular-nums text-slate-400">
                      {s.start_week ? `${s.start_week}주~` : ""}
                      {s.weeks ? `${s.weeks}주` : ""}
                    </span>
                  </li>
                ))}
              </ol>
              {canEdit && (
                <div className="flex gap-1 border-t border-black/[0.06] px-2 py-1.5">
                  <button className="btn-ghost text-xs" onClick={() => open(t)}>
                    편집
                  </button>
                  <button className="btn-danger ml-auto text-xs" onClick={() => remove(t)}>
                    삭제
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "템플릿 편집" : "새 템플릿"} width="max-w-4xl">
        <div className="space-y-3">
          <input className="input font-medium" value={name} onChange={(e) => setName(e.target.value)} />
          <div className="scroll-thin max-h-[55vh] overflow-auto rounded-lg border border-black/[0.07]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  <th className="th">단계명</th>
                  <th className="th w-32">담당부서</th>
                  <th className="th w-44">연관부서 (쉼표, 역할은 괄호)</th>
                  <th className="th">주요내용</th>
                  <th className="th w-20">시작주차</th>
                  <th className="th w-20">기간(주)</th>
                  <th className="th w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="p-1.5">
                      <input className="input" value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />
                    </td>
                    <td className="p-1.5">
                      <input
                        className="input"
                        defaultValue={r.department ? deptWithRole(r.department, r.dept_roles?.[r.department]) : ""}
                        placeholder="예) 게임파트(주관)"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          const own = v ? parseDeptRole(v) : null;
                          const roles = { ...(r.dept_roles ?? {}) };
                          if (r.department) delete roles[r.department];
                          if (own?.role) roles[own.dept] = own.role;
                          setRow(i, { department: own?.dept ?? null, dept_roles: cleanRoles(roles, own?.dept ?? null, r.related_departments ?? []) });
                        }}
                      />
                    </td>
                    <td className="p-1.5">
                      <input
                        className="input"
                        defaultValue={(r.related_departments ?? []).map((d) => deptWithRole(d, r.dept_roles?.[d])).join(", ")}
                        placeholder="예) 운영팀(검토), 경영진(의결)"
                        onBlur={(e) => {
                          const rel = parseDeptList(e.target.value);
                          const ownRole = r.department ? r.dept_roles?.[r.department] : undefined;
                          const roles: Record<string, string> = { ...rel.roles };
                          if (r.department && ownRole) roles[r.department] = ownRole;
                          const related = rel.depts.filter((d) => d !== r.department);
                          setRow(i, { related_departments: related, dept_roles: cleanRoles(roles, r.department ?? null, related) });
                        }}
                      />
                    </td>
                    <td className="p-1.5">
                      <input className="input" value={r.description ?? ""} onChange={(e) => setRow(i, { description: e.target.value || null })} />
                    </td>
                    <td className="p-1.5">
                      <input type="number" min={1} className="input" placeholder="자동" value={r.start_week ?? ""} onChange={(e) => setRow(i, { start_week: num(e.target.value) })} />
                    </td>
                    <td className="p-1.5">
                      <input type="number" min={1} className="input" value={r.weeks ?? ""} onChange={(e) => setRow(i, { weeks: num(e.target.value) })} />
                    </td>
                    <td className="p-1.5 text-right">
                      <button className="btn-danger px-2 text-xs" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">시작주차를 비워두면 앞 단계가 끝난 다음 주차로 자동 배치됩니다.</p>
          <div className="flex justify-between">
            <button className="btn-outline text-xs" onClick={() => setRows((rs) => [...rs, { name: "", department: "게임파트", start_week: null, weeks: 1 }])}>
              + 단계 추가
            </button>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => setEdit(null)}>
                취소
              </button>
              <button className="btn-primary" disabled={!name.trim()} onClick={save}>
                저장
              </button>
            </div>
          </div>
        </div>
      </Modal>
      <Toast msg={toast} />
    </div>
  );
}
