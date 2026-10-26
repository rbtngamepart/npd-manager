"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "./AppProvider";
import type { RoleType } from "@/lib/types";

/** 관리자: 역할 종류 관리 (주관·의결·검토·협의 …) */
export function RoleTypeManager({ toast }: { toast: (m: string) => void }) {
  const { roleTypes, reloadRoles } = useApp();
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const loadUsage = useCallback(async () => {
    const { data } = await supabase().from("stages").select("dept_roles");
    const count: Record<string, number> = {};
    (data ?? []).forEach((r: { dept_roles: Record<string, string> | null }) =>
      Object.values(r.dept_roles ?? {}).forEach((v) => (count[v] = (count[v] ?? 0) + 1))
    );
    setUsage(count);
  }, []);

  useEffect(() => {
    if (roleTypes !== null) loadUsage();
  }, [roleTypes, loadUsage]);

  useEffect(() => {
    setNames(Object.fromEntries((roleTypes ?? []).map((r) => [r.id, r.name])));
    setDescs(Object.fromEntries((roleTypes ?? []).map((r) => [r.id, r.description ?? ""])));
  }, [roleTypes]);

  if (roleTypes === null) {
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        부서별 역할을 쓰려면 DB 업데이트가 필요합니다. Supabase SQL Editor에서 <code className="rounded bg-white/60 px-1">supabase/005_dept_roles.sql</code> 내용을 실행해 주세요.
      </div>
    );
  }

  const listed = new Set(roleTypes.map((r) => r.name));
  const unlisted = Object.keys(usage).filter((n) => !listed.has(n));

  async function rename(oldName: string, nn: string) {
    const n = nn.trim();
    if (!n || n === oldName) return;
    const merge = listed.has(n);
    if (
      !confirm(
        merge
          ? `역할 '${oldName}'을(를) '${n}'(으)로 합칩니다. 이 역할이 지정된 ${usage[oldName] ?? 0}곳이 모두 '${n}'(으)로 바뀝니다.`
          : `역할 이름을 '${oldName}' → '${n}'(으)로 바꿉니다. 지정된 ${usage[oldName] ?? 0}곳과 템플릿에 모두 반영됩니다.`
      )
    )
      return;
    setBusy(true);
    const { error } = await supabase().rpc("rename_role_type", { old_name: oldName, new_name: n });
    setBusy(false);
    if (error) return toast(`실패: ${error.message}`);
    await Promise.all([reloadRoles(), loadUsage()]);
    toast(merge ? "역할을 합쳤습니다" : "역할 이름을 바꿨습니다");
  }

  async function saveDesc(r: RoleType) {
    const d = (descs[r.id] ?? "").trim();
    if (d === (r.description ?? "")) return;
    await supabase().from("role_types").update({ description: d || null }).eq("id", r.id);
    await reloadRoles();
    toast("설명을 저장했습니다");
  }

  async function add(name: string, desc = "") {
    const n = name.trim();
    if (!n) return;
    if (listed.has(n)) return toast("이미 있는 역할입니다");
    const order = roleTypes!.reduce((m, r) => Math.max(m, r.sort_order), -1) + 1;
    const { error } = await supabase().from("role_types").insert({ name: n, description: desc.trim() || null, sort_order: order });
    if (error) return toast(`실패: ${error.message}`);
    setNewName("");
    setNewDesc("");
    await reloadRoles();
    toast(`'${n}' 역할을 추가했습니다`);
  }

  async function remove(r: RoleType) {
    const n = usage[r.name] ?? 0;
    if (
      !confirm(
        n
          ? `'${r.name}'은(는) ${n}곳에 지정돼 있습니다. 목록에서만 빠지고 지정된 값은 그대로 남습니다.\n다른 역할로 바꾸려면 삭제 대신 이름 칸에 그 역할명을 입력해 합치세요.\n\n그래도 뺄까요?`
          : `'${r.name}' 역할을 삭제할까요?`
      )
    )
      return;
    await supabase().from("role_types").delete().eq("id", r.id);
    await reloadRoles();
    toast("목록에서 뺐습니다");
  }

  async function move(i: number, dir: -1 | 1) {
    const list = [...roleTypes!];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    const sb = supabase();
    await Promise.all(list.map((r, k) => (r.sort_order !== k ? sb.from("role_types").update({ sort_order: k }).eq("id", r.id) : null)));
    await reloadRoles();
  }

  return (
    <section className="card overflow-hidden" data-tour="role-admin">
      <div className="border-b border-black/[0.06] px-4 py-3">
        <h2 className="text-sm font-semibold">부서 역할 종류</h2>
        <p className="text-xs text-slate-500">
          단계에서 부서마다 맡는 역할입니다. 단계 상세의 &lsquo;부서별 역할&rsquo;에서 이 목록으로 고릅니다. 설명은 역할을 고를 때 도움말로 보여요.
        </p>
      </div>
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="bg-slate-50/70">
            <tr>
              <th className="th w-16">순서</th>
              <th className="th">역할 이름</th>
              <th className="th">설명</th>
              <th className="th text-right">지정된 곳</th>
              <th className="th w-16"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/[0.05]">
            {roleTypes.map((r, i) => {
              const edited = (names[r.id] ?? r.name).trim();
              const changed = edited !== r.name && edited !== "";
              const willMerge = changed && listed.has(edited);
              return (
                <tr key={r.id}>
                  <td className="td">
                    <div className="flex">
                      <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">
                        ↑
                      </button>
                      <button className="btn-ghost px-1.5 py-0.5 text-xs" disabled={i === roleTypes.length - 1} onClick={() => move(i, 1)} aria-label="아래로">
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <input
                        className="input w-32 py-1"
                        value={names[r.id] ?? r.name}
                        onChange={(e) => setNames((n) => ({ ...n, [r.id]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && changed && rename(r.name, edited)}
                      />
                      {changed && (
                        <>
                          <button className="btn-primary shrink-0 py-1 text-xs" disabled={busy} onClick={() => rename(r.name, edited)}>
                            {willMerge ? "합치기" : "이름 변경"}
                          </button>
                          <button className="btn-ghost shrink-0 px-2 py-1 text-xs" onClick={() => setNames((n) => ({ ...n, [r.id]: r.name }))}>
                            취소
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                  <td className="td">
                    <input
                      className="input py-1 text-xs"
                      placeholder="예) 최종 결정·승인"
                      value={descs[r.id] ?? ""}
                      onChange={(e) => setDescs((d) => ({ ...d, [r.id]: e.target.value }))}
                      onBlur={() => saveDesc(r)}
                    />
                  </td>
                  <td className="td text-right tabular-nums text-slate-600">{usage[r.name] ?? 0}</td>
                  <td className="td text-right">
                    <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => remove(r)}>
                      삭제
                    </button>
                  </td>
                </tr>
              );
            })}
            {unlisted.map((n) => (
              <tr key={n} className="bg-amber-50/40">
                <td className="td" />
                <td className="td text-amber-800">
                  {n} <span className="text-[11px] text-amber-700">(목록에 없음)</span>
                </td>
                <td className="td text-xs text-slate-500">시트에서 가져오거나 삭제된 역할입니다</td>
                <td className="td text-right tabular-nums text-slate-600">{usage[n]}</td>
                <td className="td text-right">
                  <button className="btn-outline whitespace-nowrap px-2 py-0.5 text-xs" onClick={() => add(n)}>
                    목록에 추가
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-black/[0.06] px-4 py-3">
        <input className="input w-36" placeholder="새 역할 (예: 자문)" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(newName, newDesc)} />
        <input className="input max-w-72 flex-1" placeholder="설명 (선택)" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add(newName, newDesc)} />
        <button className="btn-outline shrink-0" disabled={!newName.trim()} onClick={() => add(newName, newDesc)}>
          + 역할 추가
        </button>
      </div>
    </section>
  );
}
