"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "@/components/AppProvider";
import { tourSeen, markTourSeen, useTour } from "@/components/Tour";
import { Empty, ProgressBar, StatusChip, StatusDot } from "@/components/ui";
import { diffDays, full, short, today as todayFn } from "@/lib/dates";
import { stageFinalStatus, summarize, type AutoStatus } from "@/lib/status";
import type { Light, Project, Stage } from "@/lib/types";

const RANK: Record<string, number> = { red: 0, yellow: 1, green: 2, waiting: 3, done: 4 };

export default function Dashboard() {
  const { me } = useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [members, setMembers] = useState<{ project_id: string; user_id: string }[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<"all" | "attention">("all");
  const [loading, setLoading] = useState(true);
  const [welcome, setWelcome] = useState(false);
  const { openMenu, start } = useTour();
  const today = todayFn();

  useEffect(() => setWelcome(!tourSeen()), []);

  async function load() {
    const sb = supabase();
    const [p, s, m] = await Promise.all([
      sb.from("projects").select("*").order("created_at", { ascending: false }),
      sb.from("stages").select("*").order("sort_order"),
      sb.from("project_members").select("project_id,user_id"),
    ]);
    setProjects((p.data ?? []) as Project[]);
    setStages((s.data ?? []) as Stage[]);
    setMembers(m.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("npd-calendar-synced", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("npd-calendar-synced", onFocus);
    };
  }, []);

  const byProject = useMemo(() => {
    const map: Record<string, Stage[]> = {};
    stages.forEach((s) => (map[s.project_id] ??= []).push(s));
    return map;
  }, [stages]);

  const rows = useMemo(() => {
    return projects
      .filter((p) => showArchived || !p.archived)
      .map((p) => ({ p, sum: summarize(p, byProject[p.id] ?? [], today) }))
      .filter((r) => filter === "all" || r.sum.final === "red" || r.sum.final === "yellow" || r.sum.counts.check > 0)
      .sort((a, b) => (RANK[a.sum.final ?? "done"] ?? 5) - (RANK[b.sum.final ?? "done"] ?? 5));
  }, [projects, byProject, showArchived, filter, today]);

  const activeProjects = projects.filter((p) => !p.archived);
  const activeIds = new Set(activeProjects.map((p) => p.id));
  const attention = stages
    .filter((s) => activeIds.has(s.project_id) && !s.skipped)
    .map((s) => ({ s, st: stageFinalStatus(s, today) }))
    .filter((x) => x.st === "red" || x.st === "yellow" || x.s.needs_check)
    .sort((a, b) => (RANK[a.st ?? "done"] ?? 5) - (RANK[b.st ?? "done"] ?? 5));

  const tiles = [
    { label: "진행 중 프로젝트", value: activeProjects.length, tone: "text-ink" },
    { label: "차질 단계", value: attention.filter((x) => x.st === "red").length, tone: "text-rose-600", dot: "red" as AutoStatus },
    { label: "주의 단계", value: attention.filter((x) => x.st === "yellow").length, tone: "text-amber-600", dot: "yellow" as AutoStatus },
    { label: "확인 필요", value: attention.filter((x) => x.s.needs_check).length, tone: "text-sky-700" },
  ];

  const canEdit = (pid: string) => !!me?.is_game_part || members.some((m) => m.project_id === pid && m.user_id === me?.id);

  async function setPm(p: Project, v: Light | null) {
    setProjects((ps) => ps.map((x) => (x.id === p.id ? { ...x, pm_status: v } : x)));
    await supabase().from("projects").update({ pm_status: v }).eq("id", p.id);
  }

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">전체 프로젝트 조망</h1>
          <p className="mt-1 text-sm text-slate-500">계획 대비 예상·실제 진행 상태를 한눈에 봅니다. 기준일 {full(today)}</p>
        </div>
        {me?.is_game_part && (
          <Link href="/projects/new" className="btn-primary" data-tour="new-project">
            + 새 프로젝트
          </Link>
        )}
      </div>

      {welcome && (
        <div className="card flex flex-wrap items-center gap-3 border-brand-500/30 bg-brand-50/40 px-4 py-3">
          <span className="text-xl">👋</span>
          <div className="min-w-0 flex-1 text-sm">
            <b>처음이신가요?</b> 실제 화면을 짚으며 기능을 하나씩 알려드리는 튜토리얼이 있어요. (단원별 1~2분)
          </div>
          <button
            className="btn-ghost text-xs text-slate-500"
            onClick={() => {
              markTourSeen();
              setWelcome(false);
            }}
          >
            다음에
          </button>
          <button className="btn-outline text-xs" onClick={openMenu}>
            단원 고르기
          </button>
          <button
            className="btn-primary text-xs"
            onClick={() => {
              setWelcome(false);
              start("basics");
            }}
          >
            1단원 시작하기
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-tour="tiles">
        {tiles.map((t) => (
          <div key={t.label} className="card px-4 py-3">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              {t.dot && <StatusDot status={t.dot} />}
              {t.label}
            </div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${t.tone}`}>{loading ? "–" : t.value}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <section className="card overflow-hidden" data-tour="project-table">
          <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-2.5" data-tour="dash-filter">
            <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs">
              {(["all", "attention"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-2.5 py-1 ${filter === f ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}
                >
                  {f === "all" ? "전체" : "주의·차질·확인필요"}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-500">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              보관된 프로젝트 포함
            </label>
          </div>

          {loading ? (
            <div className="p-10 text-center text-sm text-slate-400">불러오는 중…</div>
          ) : rows.length === 0 ? (
            <div className="p-6">
              <Empty>
                {projects.length === 0 ? (
                  <>
                    아직 프로젝트가 없습니다.
                    {me?.is_game_part && (
                      <>
                        {" "}
                        <Link href="/projects/new" className="font-medium text-brand-600 underline">
                          첫 프로젝트 만들기
                        </Link>
                      </>
                    )}
                  </>
                ) : (
                  "조건에 맞는 프로젝트가 없습니다."
                )}
              </Empty>
            </div>
          ) : (
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[980px]">
                <thead className="bg-slate-50/70">
                  <tr>
                    <th className="th">프로젝트</th>
                    <th className="th">시작일</th>
                    <th className="th">계획 완료</th>
                    <th className="th">예상 완료</th>
                    <th className="th">실제 완료</th>
                    <th className="th w-40">전체 진행률</th>
                    <th className="th">자동 상태</th>
                    <th className="th">PM 판단</th>
                    <th className="th">최종</th>
                    <th className="th">PM 메모</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/[0.05]">
                  {rows.map(({ p, sum }) => {
                    const delay = sum.planEnd && sum.forecastEnd ? diffDays(sum.planEnd, sum.forecastEnd) : 0;
                    return (
                      <tr key={p.id} className={`hover:bg-slate-50/60 ${p.archived ? "opacity-50" : ""}`}>
                        <td className="td">
                          <Link href={`/projects/${p.id}`} className="font-medium hover:text-brand-600">
                            {p.name}
                          </Link>
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-400">
                            {p.category && <span>{p.category}</span>}
                            <span>
                              {sum.counts.done}/{sum.counts.total} 단계
                            </span>
                            {sum.current[0] && <span className="text-slate-500">▸ {sum.current[0].name}</span>}
                          </div>
                        </td>
                        <td className="td tabular-nums text-slate-600">{full(sum.start)}</td>
                        <td className="td tabular-nums text-slate-600">{full(sum.planEnd)}</td>
                        <td className="td tabular-nums">
                          {full(sum.forecastEnd)}
                          {delay > 0 && <div className="text-xs text-rose-600">+{delay}일</div>}
                        </td>
                        <td className="td tabular-nums text-slate-600">{full(sum.actualEnd)}</td>
                        <td className="td">
                          <ProgressBar value={sum.progress} />
                        </td>
                        <td className="td">
                          <StatusChip status={sum.auto} size="sm" />
                        </td>
                        <td className="td">
                          <select
                            className="rounded-md border border-transparent bg-transparent py-0.5 text-xs hover:border-black/10 disabled:opacity-100"
                            value={p.pm_status ?? ""}
                            disabled={!canEdit(p.id)}
                            onChange={(e) => setPm(p, (e.target.value || null) as Light | null)}
                          >
                            <option value="">—</option>
                            <option value="green">🟢 정상</option>
                            <option value="yellow">🟡 주의</option>
                            <option value="red">🔴 차질</option>
                          </select>
                        </td>
                        <td className="td">
                          <StatusChip status={sum.final} />
                        </td>
                        <td className="td max-w-[220px] text-xs text-slate-600">
                          <span className="line-clamp-2">{p.pm_memo || <span className="text-slate-300">—</span>}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="card self-start" data-tour="attention">
          <div className="border-b border-black/[0.06] px-4 py-3">
            <h2 className="text-sm font-semibold">지금 챙겨야 할 단계</h2>
            <p className="text-xs text-slate-500">차질 · 주의 · 확인 필요</p>
          </div>
          {attention.length === 0 ? (
            <p className="p-6 text-center text-sm text-slate-400">모두 정상입니다 👍</p>
          ) : (
            <ul className="max-h-[560px] divide-y divide-black/[0.05] overflow-y-auto scroll-thin">
              {attention.slice(0, 40).map(({ s, st }) => (
                <li key={s.id}>
                  <Link href={`/projects/${s.project_id}?stage=${s.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <StatusDot status={st} />
                      <span className="truncate text-sm font-medium">{s.name}</span>
                      {s.needs_check && (
                        <span className="ml-auto shrink-0 rounded bg-sky-50 px-1.5 text-[11px] text-sky-700">확인 필요</span>
                      )}
                    </div>
                    <div className="mt-0.5 pl-4 text-xs text-slate-500">
                      {projectName(s.project_id)} · 계획 {short(s.plan_start)}~{short(s.plan_end)}
                      {s.expected_end && s.plan_end && s.expected_end > s.plan_end && (
                        <span className="text-rose-600"> → 예상 {short(s.expected_end)}</span>
                      )}
                    </div>
                    {(s.issue || s.next_action) && (
                      <div className="mt-1 line-clamp-2 pl-4 text-xs text-slate-600">{s.issue || `다음: ${s.next_action}`}</div>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
