"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useApp } from "@/components/AppProvider";
import { Gantt } from "@/components/Gantt";
import { DeptBadges } from "@/components/DeptPicker";
import { ProjectFilter, type ProjectOption } from "@/components/ProjectFilter";
import { Empty, ProgressBar, StatusChip } from "@/components/ui";
import { collectDepartments, deptRole, rolesFor } from "@/lib/departments";
import { makeDeptColor } from "@/lib/deptColors";
import { short, today as todayFn } from "@/lib/dates";
import { stageFinalStatus } from "@/lib/status";
import type { Project, Stage } from "@/lib/types";

const PREF_KEY = "npd-dept";
const PROJ_KEY = "npd-dept-projects";

function DepartmentsPage() {
  const { me, profiles, deptNames } = useApp();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayFn();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"gantt" | "list">("gantt");
  const [scale, setScale] = useState<"week" | "month">("month");
  const [hideDone, setHideDone] = useState(true);
  const [depts, setDepts] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[] | null>(null); // 빈 배열 = 전체
  const [order, setOrder] = useState<"project" | "date">("project");

  useEffect(() => {
    (async () => {
      const sb = supabase();
      const [p, s] = await Promise.all([
        sb.from("projects").select("*").eq("archived", false),
        sb.from("stages").select("*").order("plan_start", { nullsFirst: false }),
      ]);
      setProjects((p.data ?? []) as Project[]);
      setStages((s.data ?? []) as Stage[]);
      setLoading(false);
    })();
  }, []);

  const departments = useMemo(
    () => collectDepartments(stages, profiles.map((p) => p.department), deptNames),
    [stages, profiles, deptNames]
  );

  // 처음 선택: 주소 → 지난번 선택 → 내 부서 → 첫 부서 (여러 개는 쉼표로)
  useEffect(() => {
    if (depts.length || !departments.length) return;
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(PREF_KEY);
    } catch {
      /* 무시 */
    }
    const parse = (raw: string | null | undefined) => (raw ?? "").split(",").filter((d) => departments.includes(d));
    const pick = [parse(params.get("d")), parse(saved), parse(me?.department)].find((l) => l.length) ?? [departments[0]];
    setDepts(pick);
  }, [departments, depts, params, me]);

  // 처음 프로젝트 선택: 주소(?p=) → 지난번 선택
  useEffect(() => {
    if (picked !== null || loading) return;
    let raw = params.get("p");
    if (raw === null) {
      try {
        raw = localStorage.getItem(PROJ_KEY);
      } catch {
        /* 무시 */
      }
    }
    const ids = (raw ?? "").split(",").filter((id) => projects.some((p) => p.id === id));
    setPicked(ids);
  }, [loading, picked, params, projects]);

  function syncUrl(ds: string[], ids: string[]) {
    const q = new URLSearchParams({ d: ds.join(",") });
    if (ids.length) q.set("p", ids.join(","));
    router.replace(`/departments?${q.toString()}`);
  }

  function setDeptList(next: string[]) {
    setDepts(next);
    try {
      localStorage.setItem(PREF_KEY, next.join(","));
    } catch {
      /* 무시 */
    }
    syncUrl(next, picked ?? []);
  }

  /** 부서 칩 누르기: 추가/빼기 (마지막 하나는 남김) */
  function toggle(d: string) {
    if (depts.includes(d)) {
      if (depts.length > 1) setDeptList(depts.filter((x) => x !== d));
    } else setDeptList([...depts, d]);
  }

  function pickProjects(ids: string[]) {
    setPicked(ids);
    try {
      localStorage.setItem(PROJ_KEY, ids.join(","));
    } catch {
      /* 무시 */
    }
    syncUrl(depts, ids);
  }

  const colorOf = useMemo(() => makeDeptColor(deptNames), [deptNames]);
  const projectById = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p])), [projects]);
  const sel = picked ?? [];
  const inSel = (pid: string) => sel.length === 0 || sel.includes(pid);
  const rows = stages
    .filter((s) => projectById[s.project_id] && inSel(s.project_id) && !s.skipped && rolesFor(s, depts))
    .filter((s) => !hideDone || !s.actual_end);
  const counts = (d: string) =>
    stages.filter((s) => projectById[s.project_id] && inSel(s.project_id) && !s.skipped && !s.actual_end && deptRole(s, d)).length;

  // 프로젝트 선택 목록: 이 부서 단계가 있는 프로젝트를 위로
  const projectOptions: ProjectOption[] = projects
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      count: stages.filter((s) => s.project_id === p.id && !s.skipped && (!hideDone || !s.actual_end) && rolesFor(s, depts)).length,
    }))
    .sort((a, b) => Number(b.count > 0) - Number(a.count > 0) || a.name.localeCompare(b.name, "ko"));
  const projectRank = Object.fromEntries(projectOptions.map((o, i) => [o.id, i]));

  const ownerN = rows.filter((s) => rolesFor(s, depts) === "owner").length;
  const relatedN = rows.length - ownerN;

  // 간트에 프로젝트명이 보이도록 이름을 바꿔서 전달
  const byDate = (a: Stage, b: Stage) => (a.plan_start ?? "9999").localeCompare(b.plan_start ?? "9999");
  const ganttRows = rows
    .slice()
    .sort((a, b) =>
      order === "project"
        ? projectRank[a.project_id] - projectRank[b.project_id] || a.sort_order - b.sort_order || byDate(a, b)
        : byDate(a, b)
    );
  const projectsInView = new Set(rows.map((s) => s.project_id)).size;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">부서별 일정</h1>
        <p className="mt-1 text-sm text-slate-500">
          부서를 고르면(여러 개 가능) 모든 프로젝트에서 그 부서가 <b>담당</b>하거나 <b className="text-violet-700">연관부서(협업)</b>로 들어간 단계를 모아 봅니다. 단계는 하나라서 일정을 바꾸면 모든 부서 화면에 같이 반영됩니다.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" data-tour="dept-chips">
        {departments.map((d) => {
          const n = counts(d);
          const on = depts.includes(d);
          const c = colorOf(d);
          return (
            <button
              key={d}
              onClick={() => toggle(d)}
              title={on ? (depts.length > 1 ? "선택 빼기" : "최소 한 부서는 선택돼 있어야 해요") : "함께 보기에 추가"}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm transition"
              style={{
                background: on ? c.solid : "#fff",
                color: on ? "#fff" : "#334155",
                boxShadow: on ? "none" : "inset 0 0 0 1px rgba(0,0,0,.1)",
              }}
            >
              {on ? <span className="text-xs">✓</span> : <span className="h-2 w-2 rounded-full" style={{ background: c.solid }} />}
              {d}
              <span className="text-xs" style={{ opacity: 0.6 }}>
                {n}
              </span>
            </button>
          );
        })}
        {depts.length > 1 && (
          <button className="ml-1 text-xs text-slate-500 underline-offset-2 hover:underline" onClick={() => setDeptList([depts[0]])}>
            하나만 보기
          </button>
        )}
      </div>

      <section className="card overflow-hidden" data-tour="dept-view">
        <div className="flex flex-wrap items-center gap-3 border-b border-black/[0.06] px-4 py-2.5 text-xs">
          <span className="text-sm font-semibold">{depts.join(" · ")}</span>
          <span className="text-slate-500">
            프로젝트 {projectsInView} · 담당 {ownerN} · <span className="text-violet-700">협업 {relatedN}</span>
          </span>
          <div data-tour="dept-projects">
            <ProjectFilter options={projectOptions} value={sel} onChange={pickProjects} />
          </div>
          <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5">
            {(
              [
                ["project", "프로젝트별"],
                ["date", "날짜순"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} onClick={() => setOrder(k)} className={`rounded-md px-2.5 py-1 ${order === k ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
                {l}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-slate-500">
            <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
            완료 단계 숨기기
          </label>
          <div className="ml-auto flex gap-2">
            {view === "gantt" && (
              <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5">
                {(["week", "month"] as const).map((s) => (
                  <button key={s} onClick={() => setScale(s)} className={`rounded-md px-2.5 py-1 ${scale === s ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
                    {s === "week" ? "주" : "월"}
                  </button>
                ))}
              </div>
            )}
            <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5">
              {(
                [
                  ["gantt", "간트"],
                  ["list", "목록"],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setView(k)} className={`rounded-md px-2.5 py-1 ${view === k ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {sel.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-black/[0.06] bg-brand-50/30 px-4 py-2 text-xs">
            <span className="text-slate-500">선택한 프로젝트</span>
            {sel.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 ring-1 ring-inset ring-black/10">
                {projectById[id]?.name ?? "?"}
                <button className="text-slate-400 hover:text-ink" onClick={() => pickProjects(sel.filter((x) => x !== id))} aria-label="선택 빼기">
                  ✕
                </button>
              </span>
            ))}
            <button className="ml-1 text-slate-500 underline-offset-2 hover:underline" onClick={() => pickProjects([])}>
              전체 보기
            </button>
          </div>
        )}
        {loading ? (
          <p className="p-10 text-center text-sm text-slate-400">불러오는 중…</p>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <Empty>
              {sel.length ? "선택한 프로젝트에서 " : ""}
              {depts.join(", ")} 부서가 담당하거나 협업하는 {hideDone ? "진행 중인 " : ""}단계가 없습니다.
            </Empty>
          </div>
        ) : view === "gantt" ? (
          <Gantt
            stages={ganttRows}
            projectStart={null}
            scale={scale}
            canEdit={false}
            today={today}
            selectedId={null}
            dept={depts}
            colorOf={colorOf}
            colorBy={depts.length > 1 ? "dept" : "status"}
            subtitle={(s) => `${projectById[s.project_id]?.name ?? ""} · ${s.department ?? ""}`}
            onSelect={(id) => {
              const s = stages.find((x) => x.id === id);
              if (s) router.push(`/projects/${s.project_id}?stage=${s.id}`);
            }}
            onDates={() => {}}
          />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-slate-50/70">
                <tr>
                  <th className="th">상태</th>
                  <th className="th">역할</th>
                  <th className="th">프로젝트 · 단계</th>
                  <th className="th">담당 · 연관부서</th>
                  <th className="th">계획</th>
                  <th className="th w-36">진행률</th>
                  <th className="th">다음 액션 / 이슈</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.05]">
                {ganttRows.map((s) => {
                  const role = rolesFor(s, depts);
                  return (
                    <tr key={s.id} className="hover:bg-slate-50/60">
                      <td className="td">
                        <StatusChip status={stageFinalStatus(s, today)} size="sm" />
                      </td>
                      <td className="td">
                        {role === "owner" ? (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">담당</span>
                        ) : (
                          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] text-violet-700 ring-1 ring-inset ring-violet-200">협업</span>
                        )}
                      </td>
                      <td className="td">
                        <Link href={`/projects/${s.project_id}?stage=${s.id}`} className="font-medium hover:text-brand-600">
                          {s.name}
                        </Link>
                        <div className="text-xs text-slate-400">{projectById[s.project_id]?.name}</div>
                      </td>
                      <td className="td text-xs text-slate-600">
                        <DeptBadges owner={s.department} related={s.related_departments ?? []} highlight={depts} colorOf={colorOf} />
                      </td>
                      <td className="td whitespace-nowrap text-xs tabular-nums text-slate-600">
                        {s.plan_start ? `${short(s.plan_start)}~${short(s.plan_end)}` : "—"}
                        {s.expected_end && s.plan_end && s.expected_end > s.plan_end && <div className="text-rose-600">예상 {short(s.expected_end)}</div>}
                      </td>
                      <td className="td">
                        <ProgressBar value={s.actual_end ? 100 : s.progress} />
                      </td>
                      <td className="td max-w-[260px] text-xs text-slate-600">
                        <span className="line-clamp-2">{s.next_action || s.issue || "—"}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-20 text-center text-sm text-slate-400">불러오는 중…</p>}>
      <DepartmentsPage />
    </Suspense>
  );
}
