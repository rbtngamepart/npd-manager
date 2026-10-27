"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { displayName, useApp } from "@/components/AppProvider";
import { Gantt } from "@/components/Gantt";
import { StagePanel } from "@/components/StagePanel";
import { ProgressTable } from "@/components/ProgressTable";
import { ImportDialog } from "@/components/ImportDialog";
import { ProjectSettings } from "@/components/ProjectSettings";
import { Empty, Modal, PmPicker, ProgressBar, StatusChip, Toast } from "@/components/ui";
import { diffDays, full, relativeTime, short, today as todayFn, weekNumber } from "@/lib/dates";
import { stageAutoStatus, stageFinalStatus, summarize } from "@/lib/status";
import { toTemplate } from "@/lib/templates";
import { useTourEvents } from "@/components/Tour";
import { collectDepartments, deptRole, deptWithRole, matchesDepts } from "@/lib/departments";
import { ProjectFilter } from "@/components/ProjectFilter";
import { makeDeptColor } from "@/lib/deptColors";
import type { CalendarEvent, Light, LogKind, Project, ProjectMember, Stage, StageLog } from "@/lib/types";
import { runCalendarSync, summaryText } from "@/lib/calendar/client";

type Tab = "gantt" | "pm" | "logs" | "settings";

function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const { me, profiles, profileById, deptNames } = useApp();
  const today = todayFn();

  const [project, setProject] = useState<Project | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [logs, setLogs] = useState<StageLog[]>([]);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [calEvents, setCalEvents] = useState<CalendarEvent[] | null>(null); // null = 006 업데이트 전
  const [calSyncing, setCalSyncing] = useState(false);
  const [deptFilter, setDeptFilter] = useState<string[]>([]);
  const toggleDept = (d: string) => setDeptFilter((f) => (f.includes(d) ? f.filter((x) => x !== d) : [...f, d]));
  const [colorBy, setColorByState] = useState<"dept" | "status">("dept");
  const [groupDept, setGroupDeptState] = useState(false);
  useEffect(() => {
    try {
      const c = localStorage.getItem("npd-color-by");
      if (c === "dept" || c === "status") setColorByState(c);
      setGroupDeptState(localStorage.getItem("npd-group-dept") === "1");
    } catch {
      /* 무시 */
    }
  }, []);
  const setColorBy = (v: "dept" | "status") => {
    setColorByState(v);
    try {
      localStorage.setItem("npd-color-by", v);
    } catch {
      /* 무시 */
    }
  };
  const setGroupDept = (v: boolean) => {
    setGroupDeptState(v);
    try {
      localStorage.setItem("npd-group-dept", v ? "1" : "0");
    } catch {
      /* 무시 */
    }
  };
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("gantt");
  const [scale, setScale] = useState<"week" | "month">("week");
  const [selected, setSelected] = useState<string | null>(search.get("stage"));
  const [importOpen, setImportOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplName, setTplName] = useState("");
  const [memo, setMemo] = useState("");
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    setTimeout(() => setToastMsg(null), 2200);
  }, []);

  const load = useCallback(async () => {
    const sb = supabase();
    const [p, s, l, m] = await Promise.all([
      sb.from("projects").select("*").eq("id", id).maybeSingle(),
      sb.from("stages").select("*").eq("project_id", id).order("sort_order").order("plan_start"),
      sb.from("stage_logs").select("*").eq("project_id", id).order("created_at", { ascending: false }).limit(500),
      sb.from("project_members").select("*").eq("project_id", id),
    ]);
    setProject(p.data as Project | null);
    setMemo((p.data as Project | null)?.pm_memo ?? "");
    setStages((s.data ?? []) as Stage[]);
    setLogs((l.data ?? []) as StageLog[]);
    setMembers((m.data ?? []) as ProjectMember[]);
    const ce = await sb.from("calendar_events").select("*").eq("project_id", id);
    setCalEvents(ce.error ? null : ((ce.data ?? []) as CalendarEvent[]));
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
    const sb = supabase();
    // 다른 사람이 수정하면 자동으로 새로고침 (Supabase Realtime이 켜져 있을 때)
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    const ch = sb
      .channel(`project-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "stages", filter: `project_id=eq.${id}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "stage_logs", filter: `project_id=eq.${id}` }, debounced)
      .on("postgres_changes", { event: "*", schema: "public", table: "projects", filter: `id=eq.${id}` }, debounced)
      .subscribe();
    window.addEventListener("focus", load);
    window.addEventListener("npd-calendar-synced", load);
    return () => {
      window.removeEventListener("focus", load);
      window.removeEventListener("npd-calendar-synced", load);
      sb.removeChannel(ch);
    };
  }, [id, load]);

  const canEdit = !!me && (me.is_game_part || members.some((m) => m.user_id === me.id));

  // 튜토리얼에서 오는 동작
  useTourEvents((e) => {
    if (e.type === "tab") setTab(e.tab);
    if (e.type === "open-stage") {
      setTab("gantt");
      const first = stages.find((s) => s.plan_start && !s.skipped) ?? stages[0];
      if (first) setSelected(first.id);
    }
    if (e.type === "close-stage") setSelected(null);
    if (e.type === "import") {
      setTab("gantt");
      setImportOpen(e.open && canEdit);
    }
  });
  const sum = useMemo(() => (project ? summarize(project, stages, today) : null), [project, stages, today]);

  // ---- 단계 조작 -------------------------------------------------------
  async function updateStage(sid: string, patch: Partial<Stage>) {
    setStages((ss) => ss.map((s) => (s.id === sid ? { ...s, ...patch } : s)));
    const { error } = await supabase().from("stages").update(patch).eq("id", sid);
    if (error) toast(`저장 실패: ${error.message}`);
    await load();
  }

  async function addStage() {
    const order = stages.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
    const { data, error } = await supabase()
      .from("stages")
      .insert({ project_id: id, name: "새 단계", department: me?.department ?? "게임파트", sort_order: order })
      .select()
      .single();
    if (error) return toast(error.message);
    await load();
    setSelected(data.id);
  }

  async function deleteStage(sid: string) {
    const s = stages.find((x) => x.id === sid);
    if (!s || !confirm(`'${s.name}' 단계를 삭제할까요?`)) return;
    await supabase().from("stages").delete().eq("id", sid);
    setSelected(null);
    toast("단계를 삭제했습니다");
    load();
  }

  async function moveStage(sid: string, dir: -1 | 1) {
    const i = stages.findIndex((s) => s.id === sid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stages.length) return;
    const next = [...stages];
    [next[i], next[j]] = [next[j], next[i]];
    setStages(next.map((s, k) => ({ ...s, sort_order: k })));
    const sb = supabase();
    await Promise.all(next.map((s, k) => (s.sort_order !== k ? sb.from("stages").update({ sort_order: k }).eq("id", s.id) : null)));
  }

  async function addLog(sid: string, kind: LogKind, body: string) {
    const s = stages.find((x) => x.id === sid);
    const { error } = await supabase()
      .from("stage_logs")
      .insert({ project_id: id, stage_id: sid, stage_name: s?.name, kind, body, author_id: me?.id });
    if (error) return toast(error.message);
    load();
  }

  async function deleteLog(lid: string) {
    if (!confirm("이 기록을 삭제할까요?")) return;
    await supabase().from("stage_logs").delete().eq("id", lid);
    load();
  }

  async function setProjectPm(v: Light | null) {
    setProject((p) => (p ? { ...p, pm_status: v } : p));
    await supabase().from("projects").update({ pm_status: v }).eq("id", id);
  }

  async function saveMemo() {
    if (!project || (project.pm_memo ?? "") === memo) return;
    await supabase().from("projects").update({ pm_memo: memo || null }).eq("id", id);
    toast("PM 메모를 저장했습니다");
    load();
  }

  async function saveTemplate() {
    if (!project || !tplName.trim()) return;
    const { error } = await supabase()
      .from("templates")
      .insert({ name: tplName.trim(), description: `${project.name}에서 저장`, stages: toTemplate(stages, project.start_date) });
    setTplOpen(false);
    setTplName("");
    toast(error ? `실패: ${error.message}` : "템플릿으로 저장했습니다");
  }

  function exportCSV() {
    if (!project) return;
    const head = [
      "단계", "담당부서", "연관부서", "주요내용", "계획 시작주차", "계획 기간(주)", "계획 시작일", "계획 종료일",
      "실제 시작일", "예상 완료일", "실제 완료일", "진행률", "자동 상태", "PM 판단", "최종 상태",
      "이슈/결정 필요사항", "다음 액션", "담당/협의 대상", "확인 필요", "미사용",
    ];
    const label = (v: string | null) =>
      v ? ({ green: "🟢", yellow: "🟡", red: "🔴", done: "완료", waiting: "대기" } as Record<string, string>)[v] ?? v : "";
    const rows = stages.map((s) => {
      const sw = project.start_date && s.plan_start ? weekNumber(project.start_date, s.plan_start) : "";
      const wk = s.plan_start && s.plan_end ? Math.ceil((diffDays(s.plan_start, s.plan_end) + 1) / 7) : "";
      return [
        s.name,
        s.department ? deptWithRole(s.department, s.dept_roles?.[s.department]) : "",
        (s.related_departments ?? []).map((d) => deptWithRole(d, s.dept_roles?.[d])).join(", "),
        s.description, sw, wk, s.plan_start, s.plan_end, s.actual_start, s.expected_end,
        s.actual_end, `${s.progress}%`, label(stageAutoStatus(s, today)), label(s.pm_status),
        label(stageFinalStatus(s, today)), s.issue, s.next_action, s.assignee, s.needs_check ? "TRUE" : "FALSE",
        s.skipped ? "TRUE" : "",
      ];
    });
    const esc = (v: unknown) => {
      const t = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    const csv = "﻿" + [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `${project.name}_${today}.csv`;
    a.click();
  }

  // ---- 렌더 ------------------------------------------------------------
  if (loading) return <p className="py-20 text-center text-sm text-slate-400">불러오는 중…</p>;
  if (!project || !sum)
    return (
      <Empty>
        프로젝트를 찾을 수 없습니다.{" "}
        <Link href="/" className="underline">
          대시보드로
        </Link>
      </Empty>
    );

  const sel = stages.find((s) => s.id === selected) ?? null;
  const departments = deptNames;
  const projectDepts = collectDepartments(stages, [], deptNames).filter((d) => stages.some((s) => deptRole(s, d)));
  const colorOf = makeDeptColor(deptNames);
  const filtered = stages.filter((s) => matchesDepts(s, deptFilter));
  const deptOrder = (d: string | null) => (d ? (projectDepts.indexOf(d) + 1 || 999) : 1000);
  const shown = groupDept
    ? filtered.slice().sort((a, b) => deptOrder(a.department) - deptOrder(b.department) || a.sort_order - b.sort_order)
    : filtered;
  const delay = sum.planEnd && sum.forecastEnd ? diffDays(sum.planEnd, sum.forecastEnd) : 0;
  const pm = project.pm_id ? profileById[project.pm_id] : null;

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link href="/" className="hover:text-ink">
              대시보드
            </Link>
            <span>/</span>
            {project.category && <span>{project.category}</span>}
            {project.archived && <span className="rounded bg-slate-200 px-1.5 text-slate-600">보관됨</span>}
          </div>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">{project.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
            {pm && <span>PM {displayName(pm)}</span>}
            <span>시작 {full(project.start_date)}</span>
            {project.start_date && <span>현재 {weekNumber(project.start_date, today)}주차</span>}
            {!canEdit && <span className="text-amber-700">보기 전용</span>}
          </div>
        </div>
        <div className="flex items-center gap-2" data-tour="proj-pm">
          <span className="text-xs text-slate-500">PM 판단</span>
          <PmPicker value={project.pm_status} onChange={setProjectPm} disabled={!canEdit} />
        </div>
      </div>

      {/* 요약 */}
      <div className="card grid grid-cols-2 divide-black/[0.06] sm:grid-cols-3 lg:grid-cols-6 lg:divide-x" data-tour="proj-summary">
        {[
          { l: "계획 완료", v: full(sum.planEnd) },
          { l: "현재 예상 완료", v: full(sum.forecastEnd), sub: delay > 0 ? `+${delay}일 지연` : delay < 0 ? `${-delay}일 단축` : undefined },
          { l: "실제 완료", v: full(sum.actualEnd) },
          { l: "단계", v: `${sum.counts.done} / ${sum.counts.total} 완료` },
        ].map((x) => (
          <div key={x.l} className="px-4 py-3">
            <div className="text-xs text-slate-500">{x.l}</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums">{x.v}</div>
            {x.sub && <div className={`text-xs ${delay > 0 ? "text-rose-600" : "text-emerald-600"}`}>{x.sub}</div>}
          </div>
        ))}
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">전체 진행률</div>
          <ProgressBar value={sum.progress} className="mt-1.5" />
        </div>
        <div className="px-4 py-3">
          <div className="text-xs text-slate-500">자동 → 최종</div>
          <div className="mt-1 flex items-center gap-1">
            <StatusChip status={sum.auto} size="sm" />
            <span className="text-slate-300">→</span>
            <StatusChip status={sum.final} size="sm" />
          </div>
        </div>
      </div>

      {/* PM 메모 */}
      <div className="card flex items-start gap-3 px-4 py-2.5" data-tour="proj-memo">
        <span className="mt-1.5 shrink-0 text-xs font-medium text-slate-500">PM 메모</span>
        <textarea
          rows={1}
          className="min-h-8 flex-1 resize-y border-0 bg-transparent py-1 text-sm outline-none placeholder:text-slate-300 disabled:text-ink"
          placeholder={canEdit ? "프로젝트 전체에 대한 메모 (대시보드에 표시)" : ""}
          disabled={!canEdit}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          onBlur={saveMemo}
        />
      </div>

      {/* 탭 */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-3 py-2">
          <div className="flex gap-1" data-tour="proj-tabs">
            {(
              [
                ["gantt", "일정 (간트)"],
                ["pm", "진행관리"],
                ["logs", `기록 ${logs.length ? logs.length : ""}`],
                ["settings", "설정·권한"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`rounded-md px-3 py-1.5 text-sm ${tab === k ? "bg-black/[0.06] font-medium" : "text-slate-500 hover:text-ink"}`}
              >
                {l}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {(tab === "gantt" || tab === "pm") && projectDepts.length > 1 && (
              <div data-tour="dept-filter" className="mr-1">
                <ProjectFilter
                  title="부서"
                  placeholder="부서 검색"
                  unit="단계"
                  align="right"
                  options={projectDepts.map((d) => ({
                    id: d,
                    name: d,
                    category: null,
                    dot: colorOf(d).solid,
                    count: stages.filter((s) => deptRole(s, d)).length,
                  }))}
                  value={deptFilter}
                  onChange={setDeptFilter}
                />
              </div>
            )}
            {tab === "gantt" && (
              <>
                <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs" data-tour="gantt-color" title="막대 색 기준">
                  {(
                    [
                      ["dept", "색: 부서"],
                      ["status", "색: 상태"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      onClick={() => setColorBy(k)}
                      className={`rounded-md px-2.5 py-1 ${colorBy === k ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-1 text-xs text-slate-600">
                  <input type="checkbox" checked={groupDept} onChange={(e) => setGroupDept(e.target.checked)} />
                  부서별로 묶기
                </label>
              </>
            )}
            {tab === "gantt" && (
              <div className="mr-2 inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs" data-tour="gantt-scale">
                {(["week", "month"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setScale(s)}
                    className={`rounded-md px-2.5 py-1 ${scale === s ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}
                  >
                    {s === "week" ? "주" : "월"}
                  </button>
                ))}
              </div>
            )}
            {calEvents !== null && (tab === "gantt" || tab === "pm") && (
              <button
                className="btn-ghost py-1 text-xs"
                disabled={calSyncing}
                data-tour="proj-cal-sync"
                title={
                  (project.calendar_tags ?? []).length
                    ? `캘린더 말머리: ${(project.calendar_tags ?? []).map((t) => `[${t}]`).join(" ")}`
                    : `캘린더 말머리: [${project.name}] (설정·권한에서 추가 가능)`
                }
                onClick={async () => {
                  setCalSyncing(true);
                  const r = await runCalendarSync();
                  setCalSyncing(false);
                  toast(summaryText(r));
                }}
              >
                {calSyncing ? "📅 동기화 중…" : "📅 캘린더 동기화"}
              </button>
            )}
            {canEdit && (tab === "gantt" || tab === "pm") && (
              <>
                <button className="btn-outline py-1 text-xs" onClick={() => setImportOpen(true)} data-tour="import-btn">
                  시트에서 가져오기
                </button>
                <button className="btn-primary py-1 text-xs" onClick={addStage} data-tour="add-stage">
                  + 단계
                </button>
              </>
            )}
            {(tab === "gantt" || tab === "pm") && (
              <details className="relative">
                <summary className="btn-ghost cursor-pointer list-none px-2 py-1 text-xs" data-tour="more-menu">⋯</summary>
                <div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-black/10 bg-white p-1 shadow-lg">
                  <button className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50" onClick={exportCSV}>
                    CSV로 내보내기
                  </button>
                  {me?.is_game_part && (
                    <button
                      className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-slate-50"
                      onClick={() => {
                        setTplName(`${project.name} 단계`);
                        setTplOpen(true);
                      }}
                    >
                      이 단계 구성을 템플릿으로 저장
                    </button>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>

        {tab === "gantt" &&
          (stages.length === 0 ? (
            <div className="p-6">
              <Empty>
                단계가 없습니다. {canEdit && "[+ 단계]로 추가하거나 [시트에서 가져오기]로 기존 시트를 붙여넣으세요."}
              </Empty>
            </div>
          ) : (
            <div data-tour="gantt">
              <Gantt
                stages={shown}
                dept={deptFilter}
                colorOf={colorOf}
                colorBy={colorBy}
                groupByDept={groupDept}
                projectStart={project.start_date}
                scale={scale}
                canEdit={canEdit}
                today={today}
                selectedId={selected}
                onSelect={setSelected}
                onDates={(sid, start, end) => updateStage(sid, { plan_start: start, plan_end: end })}
              />
              {projectDepts.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 border-t border-black/[0.06] px-4 py-2 text-xs" data-tour="dept-legend">
                  <span className="mr-1 text-[11px] text-slate-500">부서</span>
                  {projectDepts.map((d) => {
                    const c = colorOf(d);
                    const on = deptFilter.includes(d);
                    const n = stages.filter((s) => s.department === d).length;
                    const r = stages.filter((s) => (s.related_departments ?? []).includes(d)).length;
                    return (
                      <button
                        key={d}
                        onClick={() => toggleDept(d)}
                        title={on ? "선택 해제" : `${d} 추가 (여러 부서 함께 선택 가능)`}
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition"
                        style={{
                          background: on ? c.solid : c.light,
                          color: on ? "#fff" : c.text,
                          boxShadow: on ? "none" : `inset 0 0 0 1px ${c.solid}40`,
                        }}
                      >
                        <span className="h-2 w-2 rounded-full" style={{ background: on ? "#fff" : c.solid }} />
                        {d}
                        <span className="opacity-70">
                          {n}
                          {r ? `+${r}` : ""}
                        </span>
                      </button>
                    );
                  })}
                  {deptFilter.length > 0 && (
                    <button className="ml-1 text-[11px] text-slate-500 underline-offset-2 hover:underline" onClick={() => setDeptFilter([])}>
                      전체 보기
                    </button>
                  )}
                  <span className="ml-auto text-[11px] text-slate-400">숫자: 담당 + 협업 단계 · 눌러서 여러 부서 함께 선택</span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-4 border-t border-black/[0.06] px-4 py-2 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-6 rounded bg-slate-200" />
                  계획 (채움 = {colorBy === "dept" ? "진행률, 색 = 담당부서" : "진행률, 색 = 상태"})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1 w-6 rounded bg-ink/70" />
                  실제 진행
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-6 rounded border border-dashed border-rose-400 bg-rose-50" />
                  예상 지연
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-px bg-brand-500" />
                  오늘
                </span>
                {canEdit && <span className="ml-auto">막대를 끌어서 이동 · 양 끝을 끌어서 기간 조정</span>}
              </div>
            </div>
          ))}

        {tab === "pm" && (
          <ProgressTable
            stages={shown}
            dept={deptFilter}
            logs={logs}
            colorOf={colorOf}
            today={today}
            canEdit={canEdit}
            onSelect={setSelected}
            onQuick={(sid, patch) => updateStage(sid, patch)}
          />
        )}

        {tab === "logs" && (
          <div className="p-5">
            {logs.length === 0 ? (
              <Empty>아직 기록이 없습니다.</Empty>
            ) : (
              <ol className="relative space-y-4 border-l border-black/[0.08] pl-5">
                {logs.map((l) => (
                  <li key={l.id} className="relative">
                    <span
                      className={`absolute -left-[25px] top-1.5 h-2 w-2 rounded-full ${
                        l.kind === "issue" ? "bg-rose-500" : l.kind === "decision" ? "bg-violet-500" : l.kind === "change" ? "bg-sky-400" : "bg-slate-400"
                      }`}
                    />
                    <div className="text-xs text-slate-400">
                      <button className="font-medium text-slate-600 hover:underline" onClick={() => l.stage_id && setSelected(l.stage_id)}>
                        {l.stage_name ?? "(삭제된 단계)"}
                      </button>{" "}
                      · {l.author_id ? displayName(profileById[l.author_id]) : "시스템"} ·{" "}
                      {new Date(l.created_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <p className={`mt-0.5 whitespace-pre-wrap text-sm ${l.kind === "change" ? "text-slate-500" : ""}`}>{l.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {tab === "settings" && me && (
          <ProjectSettings
            key={project.updated_at + members.length}
            project={project}
            stages={stages}
            canEdit={canEdit}
            isGamePart={me.is_game_part}
            profiles={profiles}
            members={members}
            onChanged={load}
            onDeleted={() => router.replace("/")}
            toast={toast}
          />
        )}
      </div>

      {sel && me && (
        <StagePanel
          stage={sel}
          index={stages.indexOf(sel)}
          total={stages.length}
          projectStart={project.start_date}
          canEdit={canEdit}
          today={today}
          logs={logs.filter((l) => l.stage_id === sel.id)}
          myId={me.id}
          profileById={profileById}
          departments={departments}
          colorOf={colorOf}
          calEvents={(calEvents ?? []).filter((e) => e.stage_id === sel.id)}
          onSave={async (patch) => {
            await updateStage(sel.id, patch);
            toast("저장했습니다");
          }}
          onDelete={() => deleteStage(sel.id)}
          onMove={(d) => moveStage(sel.id, d)}
          onAddLog={(k, b) => addLog(sel.id, k, b)}
          onDeleteLog={deleteLog}
          onClose={() => setSelected(null)}
        />
      )}

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        projectId={project.id}
        projectStart={project.start_date}
        existing={stages}
        onDone={(m) => {
          toast(m);
          load();
        }}
      />

      <Modal open={tplOpen} onClose={() => setTplOpen(false)} title="템플릿으로 저장">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            현재 단계 {stages.length}개의 이름·부서·설명과 <b>시작주차·기간</b>이 저장됩니다. 새 프로젝트를 만들 때 선택할 수 있어요.
          </p>
          <input className="input" value={tplName} onChange={(e) => setTplName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setTplOpen(false)}>
              취소
            </button>
            <button className="btn-primary" disabled={!tplName.trim()} onClick={saveTemplate}>
              저장
            </button>
          </div>
        </div>
      </Modal>

      <Toast msg={toastMsg} />
      {/* 최근 활동 시각 */}
      <p className="text-right text-[11px] text-slate-400">마지막 수정 {relativeTime(project.updated_at)} · 기준일 {short(today)}</p>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="py-20 text-center text-sm text-slate-400">불러오는 중…</p>}>
      <ProjectPage />
    </Suspense>
  );
}
