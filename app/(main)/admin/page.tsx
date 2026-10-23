"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { displayName, useApp } from "@/components/AppProvider";
import { DepartmentManager } from "@/components/DepartmentManager";
import { DeptSelect } from "@/components/DeptPicker";
import { Toast } from "@/components/ui";
import type { Profile } from "@/lib/types";

function AdminPage() {
  const { me, profiles, reloadProfiles, deptNames } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") === "departments" ? "departments" : "users";
  const [toast, setToast] = useState<string | null>(null);

  if (!me?.is_admin) return <p className="text-sm text-slate-500">관리자만 볼 수 있습니다.</p>;

  function show(m: string) {
    setToast(m);
    setTimeout(() => setToast(null), 2000);
  }

  async function update(p: Profile, patch: Partial<Profile>) {
    if (p.id === me!.id && (patch.is_admin === false || patch.approved === false)) {
      if (!confirm("본인의 관리자/승인 권한을 해제하면 이 화면에 다시 들어올 수 없습니다. 계속할까요?")) return;
    }
    const { error } = await supabase().from("profiles").update(patch).eq("id", p.id);
    show(error ? error.message : "변경했습니다");
    reloadProfiles();
  }

  const pending = profiles.filter((p) => !p.approved);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">사용자 관리</h1>
          <p className="mt-1 text-sm text-slate-500">사용자 승인·권한과 부서 목록을 관리합니다.</p>
        </div>
        <div className="inline-flex rounded-lg bg-black/[0.05] p-0.5 text-sm" data-tour="admin-tabs">
          {(
            [
              ["users", `사용자 ${pending.length ? `· 대기 ${pending.length}` : ""}`],
              ["departments", "부서"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => router.replace(k === "users" ? "/admin" : "/admin?tab=departments")}
              className={`rounded-md px-3 py-1.5 ${tab === k ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      {tab === "departments" ? (
        <DepartmentManager toast={show} />
      ) : (
        <>
          <p className="text-sm text-slate-500">
            처음 로그인한 사람은 <b>승인 대기</b> 상태입니다. 승인하면 모든 프로젝트를 볼 수 있고, <b>게임파트</b>로 지정하면 모든 프로젝트를 편집할 수 있습니다.
            타부서는 프로젝트의 [설정·권한] 탭에서 프로젝트별 편집자로 추가하세요.
          </p>
          {pending.length > 0 && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              승인 대기 {pending.length}명: {pending.map((p) => p.email).join(", ")}
            </div>
          )}

          <div className="card overflow-x-auto" data-tour="admin-table">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">이름</th>
                  <th className="th">이메일</th>
                  <th className="th">부서</th>
                  <th className="th text-center">승인</th>
                  <th className="th text-center">게임파트 (전체 편집)</th>
                  <th className="th text-center">관리자</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {profiles.map((p) => (
                  <tr key={p.id} className={p.approved ? "" : "bg-amber-50/40"}>
                    <td className="td font-medium">{displayName(p)}</td>
                    <td className="td text-slate-500">{p.email}</td>
                    <td className="td">
                      <DeptSelect
                        className="input w-40 py-1"
                        value={p.department}
                        options={deptNames}
                        placeholder="—"
                        onChange={(v) => update(p, { department: v })}
                      />
                    </td>
                    <td className="td text-center">
                      <input type="checkbox" checked={p.approved} onChange={(e) => update(p, { approved: e.target.checked })} />
                    </td>
                    <td className="td text-center">
                      <input type="checkbox" checked={p.is_game_part} onChange={(e) => update(p, { is_game_part: e.target.checked })} />
                    </td>
                    <td className="td text-center">
                      <input type="checkbox" checked={p.is_admin} onChange={(e) => update(p, { is_admin: e.target.checked })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <Toast msg={toast} />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AdminPage />
    </Suspense>
  );
}
