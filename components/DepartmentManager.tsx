"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "./AppProvider";
import type { Department, Stage } from "@/lib/types";

type Usage = { owner: number; related: number; people: number };

export function DepartmentManager({ toast }: { toast: (m: string) => void }) {
  const { departments, reloadDepartments, profiles, reloadProfiles } = useApp();
  const [rows, setRows] = useState<Pick<Stage, "department" | "related_departments">[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [mergeTo, setMergeTo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadUsage = useCallback(async () => {
    const { data } = await supabase().from("stages").select("department,related_departments");
    setRows((data ?? []) as Pick<Stage, "department" | "related_departments">[]);
  }, []);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    setNames(Object.fromEntries((departments ?? []).map((d) => [d.id, d.name])));
  }, [departments]);

  const usage = useCallback(
    (name: string): Usage => ({
      owner: rows.filter((r) => r.department === name).length,
      related: rows.filter((r) => (r.related_departments ?? []).includes(name)).length,
      people: profiles.filter((p) => p.department === name).length,
    }),
    [rows, profiles]
  );

  const listed = useMemo(() => new Set((departments ?? []).map((d) => d.name)), [departments]);
  const unlisted = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      if (r.department && !listed.has(r.department)) set.add(r.department);
      (r.related_departments ?? []).forEach((d) => !listed.has(d) && set.add(d));
    });
    profiles.forEach((p) => p.department && !listed.has(p.department) && set.add(p.department));
    return Array.from(set);
  }, [rows, profiles, listed]);

  async function refresh(msg: string) {
    await Promise.all([reloadDepartments(), loadUsage(), reloadProfiles()]);
    toast(msg);
  }

  async function rename(oldName: string, nn: string) {
    const n = nn.trim();
    if (!n || n === oldName) return;
    const u = usage(oldName);
    const merge = listed.has(n);
    const msg = merge
      ? `'${oldName}'을(를) '${n}'(으)로 합칩니다.\n\n담당 ${u.owner}개 · 연관 ${u.related}개 단계, 사용자 ${u.people}명, 템플릿이 모두 '${n}'(으)로 바뀝니다.`
      : `부서명을 '${oldName}' → '${n}'(으)로 바꿉니다.\n\n담당 ${u.owner}개 · 연관 ${u.related}개 단계, 사용자 ${u.people}명, 템플릿에 모두 반영됩니다.`;
    if (!confirm(msg)) return;
    setBusy(true);
    const { error } = await supabase().rpc("rename_department", { old_name: oldName, new_name: n });
    setBusy(false);
    if (error) return toast(`실패: ${error.message}`);
    setMergeTo((m) => ({ ...m, [oldName]: "" }));
    refresh(merge ? `'${n}'(으)로 합쳤습니다` : "부서명을 바꿨습니다");
  }

  async function add(name: string) {
    const n = name.trim();
    if (!n) return;
    if (listed.has(n)) return toast("이미 있는 부서입니다");
    const order = (departments ?? []).reduce((m, d) => Math.max(m, d.sort_order), -1) + 1;
    const { error } = await supabase().from("departments").insert({ name: n, sort_order: order });
    if (error) return toast(`실패: ${error.message}`);
    setNewName("");
    refresh(`'${n}' 부서를 추가했습니다`);
  }

  async function remove(d: Department) {
    const u = usage(d.name);
    const inUse = u.owner + u.related + u.people > 0;
    const msg = inUse
      ? `'${d.name}'은(는) 아직 담당 ${u.owner}개 · 연관 ${u.related}개 단계, 사용자 ${u.people}명이 쓰고 있습니다.\n\n목록에서만 빠지고 기존 단계의 부서명은 그대로 남습니다 (아래 '목록에 없는 부서'로 표시).\n다른 부서로 옮기려면 삭제 대신 이름 칸에 그 부서명을 입력해 '합치기' 하세요.\n\n그래도 목록에서 뺄까요?`
      : `'${d.name}' 부서를 목록에서 삭제할까요?`;
    if (!confirm(msg)) return;
    const { error } = await supabase().from("departments").delete().eq("id", d.id);
    if (error) return toast(`실패: ${error.message}`);
    refresh("목록에서 뺐습니다");
  }

  async function move(i: number, dir: -1 | 1) {
    const list = [...(departments ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const sb = supabase();
    await Promise.all(list.map((d, k) => (d.sort_order !== k ? sb.from("departments").update({ sort_order: k }).eq("id", d.id) : null)));
    await reloadDepartments();
  }

  if (departments === null) {
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        부서 관리를 쓰려면 DB 업데이트가 필요합니다. Supabase SQL Editor에서 <code className="rounded bg-white/60 px-1">supabase/003_departments.sql</code> 내용을 실행해 주세요.
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="card overflow-hidden" data-tour="dept-admin">
        <div className="border-b border-black/[0.06] px-4 py-3">
          <h2 className="text-sm font-semibold">부서 목록</h2>
          <p className="text-xs text-slate-500">
            여기 있는 부서만 단계의 담당·연관부서와 사용자 부서로 고를 수 있습니다. 순서는 부서별 일정·선택 목록에 그대로 쓰입니다.
          </p>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50/70">
            <tr>
              <th className="th w-16">순서</th>
              <th className="th">부서명 (고치면 전체 반영)</th>
              <th className="th text-right">담당 단계</th>
              <th className="th text-right">협업 단계</th>
              <th className="th text-right">사용자</th>
              <th className="th w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.05]">
            {departments.map((d, i) => {
              const u = usage(d.name);
              const edited = (names[d.id] ?? d.name).trim();
              const changed = edited !== d.name && edited !== "";
              const willMerge = changed && listed.has(edited);
              return (
                <tr key={d.id}>
                  <td className="td">
                    <div className="flex">
                      <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">
                        ↑
                      </button>
                      <button
                        className="btn-ghost px-1.5 py-0.5 text-xs"
                        disabled={i === departments.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="아래로"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <input
                        className="input max-w-56 py-1"
                        value={names[d.id] ?? d.name}
                        onChange={(e) => setNames((n) => ({ ...n, [d.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && changed && rename(d.name, edited)}
                      />
                      {changed && (
                        <>
                          <button className="btn-primary shrink-0 py-1 text-xs" disabled={busy} onClick={() => rename(d.name, edited)}>
                            {willMerge ? "합치기" : "이름 변경"}
                          </button>
                          <button className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => setNames((n) => ({ ...n, [d.id]: d.name }))}>
                            취소
                          </button>
                        </>
                      )}
                    </div>
                    {willMerge && <p className="mt-1 text-[11px] text-violet-700">이미 있는 &lsquo;{edited}&rsquo;로 합쳐집니다</p>}
                  </td>
                  <td className="td text-right tabular-nums text-slate-600">{u.owner}</td>
                  <td className="td text-right tabular-nums text-violet-700">{u.related}</td>
                  <td className="td text-right tabular-nums text-slate-600">{u.people}</td>
                  <td className="td text-right">
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => remove(d)}>
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex gap-2 border-t border-black/[0.06] px-4 py-3">
          <input
            className="input max-w-56"
            placeholder="새 부서명 (예: 디자인팀)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add(newName)}
          />
          <button className="btn-outline shrink-0" disabled={!newName.trim()} onClick={() => add(newName)}>
            + 부서 추가
          </button>
        </div>
      </section>

      <aside className="space-y-4">
        <div className="card" data-tour="dept-unlisted">
          <div className="border-b border-black/[0.06] px-4 py-3">
            <h2 className="text-sm font-semibold">목록에 없는 부서</h2>
            <p className="text-xs text-slate-500">시트에서 가져오거나 예전에 직접 입력된 이름입니다. 목록에 추가하거나, 기존 부서로 합쳐서 정리하세요.</p>
          </div>
          {unlisted.length === 0 ? (
            <p className="p-5 text-center text-sm text-slate-400">정리할 이름이 없습니다 👍</p>
          ) : (
            <ul className="divide-y divide-black/[0.05]">
              {unlisted.map((n) => {
                const u = usage(n);
                return (
                  <li key={n} className="space-y-2 px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-amber-800">{n}</span>
                      <span className="text-[11px] text-slate-400">
                        담당 {u.owner} · 협업 {u.related} · 사용자 {u.people}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <button className="btn-outline py-1 text-xs" onClick={() => add(n)}>
                        목록에 추가
                      </button>
                      <select
                        className="rounded-lg border border-black/10 px-2 py-1 text-xs"
                        value={mergeTo[n] ?? ""}
                        onChange={(e) => setMergeTo((m) => ({ ...m, [n]: e.target.value }))}
                      >
                        <option value="">합칠 부서 선택…</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.name}>
                            {d.name}
                          </option>
                        ))}
                      </select>
                      <button className="btn-primary py-1 text-xs" disabled={!mergeTo[n] || busy} onClick={() => rename(n, mergeTo[n])}>
                        합치기
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="rounded-xl bg-slate-100/70 p-4 text-xs leading-relaxed text-slate-600">
          <b>이름 변경</b>: 부서명 칸을 고치고 [이름 변경] → 그 부서가 들어간 모든 단계(담당·연관), 사용자, 템플릿이 한 번에 바뀝니다.
          <br />
          <b>합치기</b>: 부서명 칸에 이미 있는 다른 부서명을 입력하면 두 부서가 하나로 합쳐집니다.
          <br />
          <b>삭제</b>: 목록에서만 빠지고, 기존 단계의 부서명은 그대로 남습니다.
        </div>
      </aside>
    </div>
  );
}
