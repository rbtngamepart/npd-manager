"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { displayName, useApp } from "./AppProvider";
import { DeptSelect } from "./DeptPicker";
import { ProjectFilter } from "./ProjectFilter";
import type { Invite, Project } from "@/lib/types";

type Role = "viewer" | "gamepart" | "admin";
const ROLE_LABEL: Record<Role, string> = {
  viewer: "보기 (+지정 프로젝트 편집)",
  gamepart: "게임파트 (전체 편집)",
  admin: "관리자",
};
const roleOf = (i: Pick<Invite, "is_admin" | "is_game_part">): Role => (i.is_admin ? "admin" : i.is_game_part ? "gamepart" : "viewer");

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function guideText(email?: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return [
    "[게임파트 NPD] 프로젝트 일정 관리 사이트에 초대되었습니다.",
    "",
    `· 접속: ${origin}`,
    `· 로그인: ${email ? `${email} 계정으로 ` : "초대받은 메일 계정으로 "}[Google 계정으로 로그인] 또는 [로그인 링크 받기]`,
    "· 승인 절차 없이 바로 사용할 수 있습니다.",
    "· 처음 들어오면 오른쪽 위 [튜토리얼]을 눌러보세요.",
  ].join("\n");
}

export function InviteManager({ toast }: { toast: (m: string) => void }) {
  const { profiles, deptNames, profileById, reloadProfiles } = useApp();
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [missing, setMissing] = useState(false);
  const [raw, setRaw] = useState("");
  const [name, setName] = useState("");
  const [dept, setDept] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("viewer");
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"all" | "pending" | "used">("all");

  const load = useCallback(async () => {
    const sb = supabase();
    const [i, p] = await Promise.all([
      sb.from("invites").select("*").order("created_at", { ascending: false }),
      sb.from("projects").select("*").eq("archived", false).order("created_at", { ascending: false }),
    ]);
    if (i.error) {
      setMissing(true);
      setInvites([]);
    } else setInvites((i.data ?? []) as Invite[]);
    setProjects((p.data ?? []) as Project[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const emails = useMemo(() => Array.from(new Set((raw.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))), [raw]);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "(보관/삭제된 프로젝트)";
  const signedUp = (email: string) => profiles.find((p) => p.email.toLowerCase() === email);

  async function submit() {
    if (!emails.length) return;
    const already = (invites ?? []).filter((i) => emails.includes(i.email));
    if (already.length && !confirm(`이미 초대된 메일 ${already.length}개는 새 설정으로 덮어씁니다. 계속할까요?`)) return;
    setBusy(true);
    const rows = emails.map((email) => ({
      email,
      name: emails.length === 1 && name.trim() ? name.trim() : null,
      department: dept,
      is_game_part: role !== "viewer",
      is_admin: role === "admin",
      project_ids: role === "viewer" ? projectIds : [],
    }));
    const { error } = await supabase().from("invites").upsert(rows, { onConflict: "email" });
    setBusy(false);
    if (error) return toast(`실패: ${error.message}`);
    const existing = emails.filter((e) => signedUp(e)).length;
    setRaw("");
    setName("");
    setProjectIds([]);
    await Promise.all([load(), reloadProfiles()]);
    toast(`${emails.length}명 초대 등록${existing ? ` · 이미 로그인한 ${existing}명은 바로 적용됨` : ""}`);
  }

  async function remove(i: Invite) {
    const msg = i.used_at
      ? `${i.email} 초대 기록을 지울까요?\n\n이미 가입한 사용자라 접속 권한은 그대로 남습니다. 권한을 빼려면 [사용자] 탭에서 '승인'을 해제하세요.`
      : `${i.email} 초대를 취소할까요? 이 메일로 로그인하면 다시 '승인 대기'가 됩니다.`;
    if (!confirm(msg)) return;
    await supabase().from("invites").delete().eq("email", i.email);
    load();
  }

  async function copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      prompt("아래 내용을 복사하세요", text);
    }
  }

  if (missing) {
    return (
      <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
        초대 기능을 쓰려면 DB 업데이트가 필요합니다. Supabase SQL Editor에서 <code className="rounded bg-white/60 px-1">supabase/004_invites.sql</code> 내용을 실행해 주세요.
      </div>
    );
  }

  const list = (invites ?? []).filter((i) => filter === "all" || (filter === "used" ? i.used_at : !i.used_at));
  const pendingN = (invites ?? []).filter((i) => !i.used_at).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
      <section className="card self-start" data-tour="invite-form">
        <div className="border-b border-black/[0.06] px-4 py-3">
          <h2 className="text-sm font-semibold">메일 미리 등록</h2>
          <p className="text-xs text-slate-500">등록한 메일로 처음 로그인하면 승인 대기 없이 바로 접속되고, 아래 부서·권한이 자동 적용됩니다.</p>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="label">이메일 (여러 개는 줄바꿈·쉼표로)</label>
            <textarea
              className="input min-h-20 font-mono text-xs"
              placeholder={"kim@redbutton.co.kr\nlee@redbutton.co.kr"}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
            {raw.trim() && (
              <p className="mt-1 text-[11px] text-slate-500">
                인식한 메일 {emails.length}개
                {emails.filter((e) => signedUp(e)).length > 0 && (
                  <span className="text-emerald-700"> · 이미 로그인한 {emails.filter((e) => signedUp(e)).length}명은 등록 즉시 적용</span>
                )}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">이름 {emails.length > 1 && <span className="font-normal">(1명일 때만)</span>}</label>
              <input className="input" disabled={emails.length > 1} value={name} onChange={(e) => setName(e.target.value)} placeholder="선택" />
            </div>
            <div>
              <label className="label">부서</label>
              <DeptSelect value={dept} options={deptNames} onChange={setDept} />
            </div>
          </div>
          <div>
            <label className="label">권한</label>
            <div className="space-y-1">
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                <label key={r} className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={role === r} onChange={() => setRole(r)} />
                  {ROLE_LABEL[r]}
                </label>
              ))}
            </div>
          </div>
          {role === "viewer" && (
            <div>
              <label className="label">편집할 프로젝트 (선택)</label>
              <ProjectFilter
                title="편집"
                emptyLabel="없음 (보기만)"
                showCount={false}
                options={projects.map((p) => ({ id: p.id, name: p.name, category: p.category, count: 0 }))}
                value={projectIds}
                onChange={setProjectIds}
              />
              <p className="mt-1 text-[11px] text-slate-400">타부서 담당자에게 특정 프로젝트만 편집 권한을 줄 때</p>
            </div>
          )}
          <button className="btn-primary w-full" disabled={!emails.length || busy} onClick={submit}>
            {busy ? "등록 중…" : emails.length > 1 ? `${emails.length}명 초대 등록` : "초대 등록"}
          </button>
          <button className="btn-ghost w-full text-xs" onClick={() => copy(guideText(), "안내 문구를 복사했습니다")}>
            📋 공통 안내 문구 복사 (메신저·메일용)
          </button>
        </div>
      </section>

      <section className="card overflow-hidden" data-tour="invite-list">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-2.5">
          <h2 className="mr-2 text-sm font-semibold">초대 목록</h2>
          <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs">
            {(
              [
                ["all", "전체"],
                ["pending", `로그인 전 ${pendingN}`],
                ["used", "가입 완료"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 ${filter === k ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {invites === null ? (
          <p className="p-8 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : list.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-400">초대한 메일이 없습니다.</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">이메일</th>
                  <th className="th">부서</th>
                  <th className="th">권한</th>
                  <th className="th">상태</th>
                  <th className="th">초대한 사람</th>
                  <th className="th"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {list.map((i) => (
                  <tr key={i.email}>
                    <td className="td">
                      <div className="font-medium">{i.email}</div>
                      {i.name && <div className="text-xs text-slate-400">{i.name}</div>}
                    </td>
                    <td className="td text-slate-600">{i.department ?? "—"}</td>
                    <td className="td text-xs text-slate-600">
                      {ROLE_LABEL[roleOf(i)].replace(" (+지정 프로젝트 편집)", "")}
                      {i.project_ids.length > 0 && (
                        <div className="mt-0.5 text-[11px] text-slate-400" title={i.project_ids.map(projectName).join(", ")}>
                          편집: {i.project_ids.length === 1 ? projectName(i.project_ids[0]) : `프로젝트 ${i.project_ids.length}개`}
                        </div>
                      )}
                    </td>
                    <td className="td">
                      {i.used_at ? (
                        <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700 ring-1 ring-inset ring-emerald-200">
                          가입 완료 {new Date(i.used_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" })}
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">로그인 전</span>
                      )}
                    </td>
                    <td className="td text-xs text-slate-500">{i.invited_by ? displayName(profileById[i.invited_by]) : "—"}</td>
                    <td className="td whitespace-nowrap text-right">
                      {!i.used_at && (
                        <button className="btn-ghost px-2 py-0.5 text-xs" onClick={() => copy(guideText(i.email), `${i.email} 안내 문구를 복사했습니다`)}>
                          안내 복사
                        </button>
                      )}
                      <button className="btn-danger px-2 py-0.5 text-xs" onClick={() => remove(i)}>
                        {i.used_at ? "기록 삭제" : "초대 취소"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
