"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, diffDays, maxDate, minDate, monthStart, nextMonth, short, weekNumber } from "@/lib/dates";
import { STATUS_META, stageFinalStatus } from "@/lib/status";
import type { Stage, StageDep, StageGroup, StageLabel } from "@/lib/types";
import { groupSpan, type Row } from "@/lib/groups";
import { effectiveEnd } from "@/lib/deps";
import { StatusDot } from "./ui";
import { roleLabel, rolesFor, toList } from "@/lib/departments";
import type { DeptColorFn } from "@/lib/deptColors";
import { Fragment } from "react";

type Scale = "week" | "month";
type DragMode = "move" | "start" | "end" | "create";

interface Drag {
  id: string;
  mode: DragMode;
  x0: number;
  start0: string;
  end0: string;
  start: string;
  end: string;
  moved: boolean;
}

const ROW = 44;
const GROUP_ROW = 32;
const DEPT_ROW = 26;
const LEFT = 280;

export type GroupAction = "rename" | "sub" | "stage" | "up" | "down" | "delete";

export function Gantt({
  stages,
  projectStart,
  scale,
  canEdit,
  today,
  selectedId,
  onSelect,
  onDates,
  dept,
  subtitle,
  colorOf,
  colorBy = "status",
  groupByDept = false,
  rows,
  onToggleGroup,
  onGroupAction,
  deps,
  checkCount,
  labelById,
}: {
  stages: Stage[];
  projectStart: string | null;
  scale: Scale;
  canEdit: boolean;
  today: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDates: (id: string, start: string, end: string) => void;
  /** 이 부서 기준으로 담당/협업 표시 */
  dept?: string | string[] | null;
  /** 단계 이름 아래 작은 글씨를 바꾸고 싶을 때 */
  subtitle?: (s: Stage) => string;
  /** 부서 → 색 */
  colorOf?: DeptColorFn;
  /** 막대 색 기준 */
  colorBy?: "status" | "dept";
  /** 담당부서가 바뀌는 곳에 구분 줄 표시 (stages는 미리 부서순 정렬해서 전달) */
  groupByDept?: boolean;
  /** 그룹 트리로 그릴 때 (stages 대신 이 순서대로) */
  rows?: Row[];
  onToggleGroup?: (id: string) => void;
  onGroupAction?: (g: StageGroup, a: GroupAction) => void;
  /** 선후 관계 화살표 */
  deps?: StageDep[] | null;
  /** 체크리스트 진행 */
  checkCount?: Record<string, { done: number; total: number }>;
  labelById?: Record<string, StageLabel>;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  const ppd = scale === "week" ? 6 : 3.2; // px per day
  const scroller = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(1200);

  // 화면 너비만큼은 항상 타임라인을 채움
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (d: Drag | null) => {
    dragRef.current = d;
    setDragState(d);
  };

  const { rangeStart, days } = useMemo(() => {
    const all = stages.flatMap((s) => [s.plan_start, s.plan_end, s.actual_start, s.actual_end, s.expected_end]);
    let rs = projectStart ?? minDate(...all, today) ?? today;
    if (scale === "month") rs = monthStart(rs);
    const minEnd = addDays(rs, scale === "week" ? 26 * 7 : 365);
    const re = addDays(maxDate(...all, today, minEnd)!, scale === "week" ? 28 : 45);
    const fill = Math.ceil((boxW - LEFT) / ppd);
    return { rangeStart: rs, days: Math.max(diffDays(rs, re) + 1, fill) };
  }, [stages, projectStart, scale, today, boxW, ppd]);

  const width = Math.ceil(days * ppd);
  const rangeEnd = addDays(rangeStart, days - 1);
  const x = (d: string) => diffDays(rangeStart, d) * ppd;
  const dayAt = (px: number) => addDays(rangeStart, Math.floor(px / ppd));

  // 처음 열 때 오늘 근처로 스크롤
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x(today) - 240);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, rangeStart]);

  const months = useMemo(() => {
    const out: { label: string; left: number; w: number }[] = [];
    for (let m = monthStart(rangeStart); m <= rangeEnd; m = nextMonth(m)) {
      const a = m < rangeStart ? rangeStart : m;
      const nm = nextMonth(m);
      const b = nm > rangeEnd ? addDays(rangeEnd, 1) : nm;
      const [y, mo] = m.split("-");
      const showYear = out.length === 0 || mo === "01";
      out.push({ label: showYear ? `${y}.${Number(mo)}월` : `${Number(mo)}월`, left: x(a), w: diffDays(a, b) * ppd });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeStart, rangeEnd, ppd]);

  const weeks = useMemo(() => {
    if (scale !== "week") return [];
    const out: { label: string; left: number; date: string; current: boolean }[] = [];
    for (let d = rangeStart; d <= rangeEnd; d = addDays(d, 7)) {
      out.push({
        label: projectStart ? String(weekNumber(projectStart, d)) : short(d),
        left: x(d),
        date: d,
        current: today >= d && today < addDays(d, 7),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, rangeStart, rangeEnd, projectStart, today]);

  function begin(e: React.PointerEvent, s: Stage, mode: DragMode) {
    if (!canEdit || e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (mode === "create") {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const d = dayAt(e.clientX - rect.left);
      setDrag({ id: s.id, mode, x0: e.clientX, start0: d, end0: d, start: d, end: d, moved: false });
      return;
    }
    setDrag({
      id: s.id,
      mode,
      x0: e.clientX,
      start0: s.plan_start!,
      end0: s.plan_end!,
      start: s.plan_start!,
      end: s.plan_end!,
      moved: false,
    });
  }

  function move(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.x0) / ppd);
    let { start, end } = drag;
    if (drag.mode === "move") {
      start = addDays(drag.start0, delta);
      end = addDays(drag.end0, delta);
    } else if (drag.mode === "start") {
      start = addDays(drag.start0, delta);
      if (start > drag.end0) start = drag.end0;
    } else if (drag.mode === "end") {
      end = addDays(drag.end0, delta);
      if (end < drag.start0) end = drag.start0;
    } else {
      const d = addDays(drag.start0, delta);
      start = d < drag.start0 ? d : drag.start0;
      end = d < drag.start0 ? drag.start0 : d;
    }
    setDrag({ ...drag, start, end, moved: drag.moved || Math.abs(e.clientX - drag.x0) > 3 });
  }

  function end() {
    const d = dragRef.current;
    if (!d) return;
    setDrag(null);
    if (!d.moved) {
      onSelect(d.id);
      return;
    }
    if (d.mode === "create") {
      // 클릭만 했으면 1주짜리로
      const e = d.end === d.start ? addDays(d.start, 6) : d.end;
      onDates(d.id, d.start, e);
    } else if (d.start !== d.start0 || d.end !== d.end0) {
      onDates(d.id, d.start, d.end);
    }
  }

  // 튜토리얼이 가리킬 막대: 진행 중이거나 다음에 할 단계
  const planned = stages.filter((s) => s.plan_start && s.plan_end && !s.skipped);
  const firstBarId = (planned.find((s) => !s.actual_end && s.plan_end! >= today) ?? planned.find((s) => !s.actual_end) ?? planned[0])?.id;
  const todayX = today >= rangeStart && today <= rangeEnd ? x(today) + ppd / 2 : null;

  // 그릴 줄 목록 + 각 줄의 세로 위치 (선후 관계 화살표용)
  const items: Row[] = rows ?? stages.map((s, i) => ({ kind: "stage" as const, stage: s, depth: 0, no: i + 1 }));
  const headH = scale === "week" ? 52 : 36;
  const rowY = new Map<string, number>();
  {
    let y = headH;
    items.forEach((r, k) => {
      if (r.kind === "group") {
        y += GROUP_ROW;
        return;
      }
      const prev = k > 0 ? items[k - 1] : null;
      if (!rows && groupByDept && (!prev || (prev.kind === "stage" && prev.stage.department !== r.stage.department))) y += DEPT_ROW;
      rowY.set(r.stage.id, y + ROW / 2 - 5);
      y += ROW;
    });
  }
  const byId = new Map(stages.map((s) => [s.id, s]));
  const arrows = (deps ?? [])
    .map((d) => {
      const a = byId.get(d.pred_id);
      const b = byId.get(d.succ_id);
      const ya = rowY.get(d.pred_id);
      const yb = rowY.get(d.succ_id);
      if (!a || !b || ya === undefined || yb === undefined) return null;
      const ae = drag?.id === a.id ? drag.end : a.actual_end ?? effectiveEnd(a);
      const bs = drag?.id === b.id ? drag.start : b.plan_start;
      if (!ae || !bs) return null;
      const x1 = x(ae) + ppd;
      const x2 = x(bs);
      const late = ae >= bs;
      let path: string;
      if (x2 - x1 >= 14) {
        path = `M${x1},${ya} H${x1 + 6} V${yb} H${x2 - 2}`;
      } else {
        const mid = yb > ya ? yb - ROW / 2 + 4 : yb + ROW / 2 - 4;
        path = `M${x1},${ya} H${x1 + 6} V${mid} H${x2 - 10} V${yb} H${x2 - 2}`;
      }
      return { key: d.pred_id + d.succ_id, path, late, title: `${a.name} → ${b.name}${late ? " (겹침: 앞 단계가 끝나기 전에 시작)" : ""}` };
    })
    .filter(Boolean) as { key: string; path: string; late: boolean; title: string }[];

  return (
    <div
      ref={scroller}
      className="scroll-thin relative max-h-[calc(100vh-250px)] min-h-[300px] overflow-auto"
      style={{ userSelect: drag ? "none" : undefined }}
    >
      <div style={{ width: LEFT + width }} className="relative">
        {/* 헤더 */}
        <div className="sticky top-0 z-20 flex border-b border-black/[0.08] bg-white">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-end border-r border-black/[0.08] bg-white px-3 pb-1.5 text-xs font-medium text-slate-500"
            style={{ width: LEFT, height: scale === "week" ? 52 : 36 }}
            data-gantt-left
          >
            단계
          </div>
          <div className="relative" style={{ width, height: scale === "week" ? 52 : 36 }}>
            {months.map((m) => (
              <div
                key={m.label + m.left}
                className="absolute top-0 flex h-[26px] items-center border-l border-black/[0.08] px-1.5 text-xs font-medium text-slate-600"
                style={{ left: m.left, width: m.w }}
              >
                <span className="truncate">{m.label}</span>
              </div>
            ))}
            {scale === "week" &&
              weeks.map((w) => (
                <div
                  key={w.date}
                  title={`${projectStart ? w.label + "주차 · " : ""}${short(w.date)}~${short(addDays(w.date, 6))}`}
                  className={`absolute top-[26px] flex h-[26px] items-center justify-center border-l border-black/[0.05] text-[11px] tabular-nums ${
                    w.current ? "bg-brand-50 font-semibold text-brand-600" : "text-slate-400"
                  }`}
                  style={{ left: w.left, width: 7 * ppd }}
                >
                  {w.label}
                </div>
              ))}
          </div>
        </div>

        {/* 배경 격자 + 오늘 선 */}
        <div className="pointer-events-none absolute bottom-0 z-0" style={{ left: LEFT, width, top: scale === "week" ? 52 : 36 }}>
          {scale === "week"
            ? weeks.map((w) => (
                <div
                  key={w.date}
                  className={`absolute bottom-0 top-0 border-l ${w.current ? "border-brand-100 bg-brand-50/40" : "border-black/[0.035]"}`}
                  style={{ left: w.left, width: 7 * ppd }}
                />
              ))
            : months.map((m) => (
                <div key={m.left} className="absolute bottom-0 top-0 border-l border-black/[0.05]" style={{ left: m.left }} />
              ))}
          {todayX !== null && <div className="absolute bottom-0 top-0 w-px bg-brand-500" style={{ left: todayX }} />}
        </div>

        {/* 선후 관계 화살표 */}
        {arrows.length > 0 && (
          <svg className="pointer-events-none absolute top-0 z-[5]" style={{ left: LEFT, width, height: "100%" }} aria-hidden>
            <defs>
              <marker id="npd-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="#94a3b8" />
              </marker>
              <marker id="npd-arrow-late" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6 z" fill="#f43f5e" />
              </marker>
            </defs>
            {arrows.map((a) => (
              <path
                key={a.key}
                d={a.path}
                fill="none"
                stroke={a.late ? "#f43f5e" : "#94a3b8"}
                strokeWidth={1.25}
                strokeDasharray={a.late ? "3 2" : undefined}
                markerEnd={`url(#${a.late ? "npd-arrow-late" : "npd-arrow"})`}
              >
                <title>{a.title}</title>
              </path>
            ))}
          </svg>
        )}

        {/* 행 */}
        {items.map((row, k) => {
          if (row.kind === "group") {
            const g = row.group;
            const sp = groupSpan(row.stages);
            return (
              <div key={`g-${g.id}`} className={`group/g relative flex border-b border-black/[0.06] bg-slate-50 ${menu === g.id ? "z-30" : "z-10"}`} style={{ height: GROUP_ROW }}>
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-black/[0.08] bg-slate-50 pr-2 text-xs font-semibold text-slate-700"
                  style={{ width: LEFT, paddingLeft: 8 + row.depth * 14 }}
                >
                  <button className="grid h-5 w-5 place-items-center rounded text-slate-500 hover:bg-black/[0.06]" onClick={() => onToggleGroup?.(g.id)} title={row.collapsed ? "펼치기" : "접기"}>
                    {row.collapsed ? "▸" : "▾"}
                  </button>
                  <span className="min-w-0 flex-1 truncate" title={g.name}>
                    {g.name}
                  </span>
                  <span className="shrink-0 text-[11px] font-normal tabular-nums text-slate-400">
                    {sp.total ? `${sp.done}/${sp.total}` : "비어 있음"}
                  </span>
                  {canEdit && onGroupAction && (
                    <span className="relative">
                      <button
                        className="grid h-5 w-5 place-items-center rounded font-normal text-slate-400 opacity-0 hover:bg-black/[0.06] hover:text-ink group-hover/g:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenu(menu === g.id ? null : g.id);
                        }}
                        title="그룹 메뉴"
                      >
                        ⋯
                      </button>
                      {menu === g.id && (
                        <div className="absolute left-0 top-6 z-40 w-40 rounded-lg border border-black/10 bg-white p-1 text-xs font-normal shadow-lg">
                          {(
                            [
                              ["stage", "+ 이 그룹에 단계"],
                              ["sub", "+ 하위 그룹"],
                              ["rename", "이름 바꾸기"],
                              ["up", "위로"],
                              ["down", "아래로"],
                              ["delete", "그룹 삭제 (안의 항목은 남김)"],
                            ] as const
                          ).map(([a, l]) => (
                            <button
                              key={a}
                              className={`block w-full rounded px-2 py-1.5 text-left hover:bg-slate-50 ${a === "delete" ? "text-rose-600" : ""}`}
                              onClick={() => {
                                setMenu(null);
                                onGroupAction(g, a);
                              }}
                            >
                              {l}
                            </button>
                          ))}
                        </div>
                      )}
                    </span>
                  )}
                </div>
                <div className="relative" style={{ width }}>
                  {sp.start && sp.end && (
                    <div
                      className="absolute top-[11px] h-[10px] overflow-hidden rounded-sm bg-slate-300"
                      style={{ left: x(sp.start), width: Math.max(ppd, (diffDays(sp.start, sp.end) + 1) * ppd) }}
                      title={`${g.name}\n${short(sp.start)} ~ ${short(sp.end)} · 진행률 ${sp.progress}%`}
                    >
                      <div className="h-full bg-slate-600" style={{ width: `${sp.progress}%` }} />
                    </div>
                  )}
                </div>
              </div>
            );
          }
          const s = row.stage;
          const i = row.no - 1;
          const prevRow = k > 0 ? items[k - 1] : null;
          const st = stageFinalStatus(s, today);
          const meta = st ? STATUS_META[st] : null;
          const isDrag = drag?.id === s.id;
          const ps = isDrag ? drag.start : s.plan_start;
          const pe = isDrag ? drag.end : s.plan_end;
          const selected = selectedId === s.id;
          const actualEnd = s.actual_end ?? (s.actual_start ? today : null);
          const dc = colorOf ? colorOf(s.department) : null;
          // 캘린더가 계획일을 정하는 단계는 끌어서 바꾸지 않음
          const locked = !!s.cal_linked && s.cal_follow !== false;
          const byDept = colorBy === "dept" && dc;
          const newGroup = !rows && groupByDept && (!prevRow || (prevRow.kind === "stage" && prevRow.stage.department !== s.department));
          const cc = checkCount?.[s.id];
          return (
            <Fragment key={s.id}>
            {newGroup && (
              <div className="relative z-10 flex border-b border-black/[0.06]" style={{ height: DEPT_ROW, background: dc ? dc.light : "#f1f5f9" }}>
                <div
                  className="sticky left-0 flex items-center gap-1.5 px-3 text-xs font-semibold"
                  style={{ width: LEFT, color: dc?.text, background: dc ? dc.light : "#f1f5f9" }}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ background: dc?.solid }} />
                  {s.department ?? "부서 미지정"}
                  <span className="font-normal opacity-60">{stages.filter((x) => x.department === s.department).length}</span>
                </div>
              </div>
            )}
            <div
              className={`group relative z-10 flex border-b border-black/[0.05] ${selected ? "bg-brand-50/50" : "hover:bg-slate-50/60"}`}
              style={{ height: ROW }}
            >
              <button
                onClick={() => onSelect(s.id)}
                className={`sticky left-0 z-10 flex shrink-0 items-center gap-2 border-r border-black/[0.08] px-3 text-left ${
                  selected ? "bg-brand-50" : "bg-white group-hover:bg-slate-50"
                }`}
                style={{ width: LEFT, paddingLeft: 12 + row.depth * 14 }}
              >
                {dc && <span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: dc.solid }} />}
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">{i + 1}</span>
                <StatusDot status={st} />
                <span className="min-w-0 flex-1">
                  <span className={`flex items-center gap-1 text-sm ${s.skipped ? "text-slate-400 line-through" : ""}`}>
                    <span className="truncate">{s.name}</span>
                    {labelById &&
                      (s.label_ids ?? []).map((id) =>
                        labelById[id] ? (
                          <span key={id} className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: labelById[id].color ?? "#64748b" }} title={labelById[id].name} />
                        ) : null
                      )}
                  </span>
                  <span className="block truncate text-[11px] text-slate-400">
                    {subtitle ? (
                      subtitle(s)
                    ) : (
                      <>
                        {dc && s.department ? (
                          <span className="rounded px-1 py-px font-medium" style={{ background: dc.light, color: dc.text }}>
                            {s.department}
                            {s.dept_roles?.[s.department] && <span className="font-normal opacity-75"> · {s.dept_roles[s.department]}</span>}
                          </span>
                        ) : (
                          s.department ?? ""
                        )}
                        {(s.related_departments ?? []).length > 0 && (
                          <span className="ml-1 inline-flex items-center gap-0.5 text-slate-500" title={`연관부서: ${s.related_departments.map((d) => (s.dept_roles?.[d] ? `${d}(${s.dept_roles[d]})` : d)).join(", ")}`}>
                            +
                            {colorOf
                              ? s.related_departments.map((d) => (
                                  <span key={d} className="inline-block h-2 w-2 rounded-full" style={{ background: colorOf(d).solid }} />
                                ))
                              : null}
                            {s.related_departments.length === 1
                              ? `${s.related_departments[0]}${s.dept_roles?.[s.related_departments[0]] ? `·${s.dept_roles[s.related_departments[0]]}` : ""}`
                              : `${s.related_departments.length}개`}
                          </span>
                        )}
                        {s.plan_start && projectStart
                          ? ` · ${weekNumber(projectStart, s.plan_start)}~${weekNumber(projectStart, s.plan_end!)}주`
                          : ""}
                      </>
                    )}
                  </span>
                </span>
                {(() => {
                  const ds = toList(dept);
                  if (!ds.length) return null;
                  const k = rolesFor(s, ds);
                  if (!k) return null;
                  // 고른 부서 중 이 단계에 관련된 첫 부서의 역할
                  const d = ds.find((x) => s.department === x) ?? ds.find((x) => (s.related_departments ?? []).includes(x))!;
                  const label = roleLabel(s, d);
                  if (k === "owner" && label === "담당") return null;
                  return (
                    <span
                      className={`shrink-0 rounded px-1 text-[10px] font-medium ring-1 ring-inset ${
                        k === "related" ? "bg-violet-50 text-violet-700 ring-violet-200" : "bg-slate-50 text-slate-700 ring-slate-200"
                      }`}
                      title={ds.length > 1 ? `${d}의 역할` : undefined}
                    >
                      {label}
                    </span>
                  );
                })()}
                {s.cal_missing ? (
                  <span className="shrink-0 text-[11px]" title="연결된 캘린더 일정이 사라졌습니다">⚠️</span>
                ) : s.cal_linked ? (
                  <span className={`shrink-0 text-[11px] ${locked ? "" : "opacity-40"}`} title={locked ? "구글 캘린더 일정을 따름 (일정은 캘린더에서 변경)" : "캘린더 연결됨 (계획일은 NPD에서 직접 관리)"}>
                    📅
                  </span>
                ) : null}
                {cc && cc.total > 0 && (
                  <span
                    className={`shrink-0 rounded px-1 text-[10px] tabular-nums ${cc.done === cc.total ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                    title={`체크리스트 ${cc.done}/${cc.total}`}
                  >
                    ☑{cc.done}/{cc.total}
                  </span>
                )}
                {s.needs_check && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" title="확인 필요" />}
              </button>

              <div
                className={`relative ${s.skipped ? "opacity-45" : ""}`}
                style={{ width, cursor: canEdit && !s.plan_start && !s.skipped ? "crosshair" : undefined }}
                onPointerDown={(e) => {
                  if (!s.plan_start && !s.skipped) begin(e, s, "create");
                }}
                onPointerMove={move}
                onPointerUp={end}
                onClick={() => !s.plan_start && !canEdit && onSelect(s.id)}
              >
                {!s.plan_start && !isDrag && canEdit && !s.skipped && (
                  <span className="pointer-events-none absolute left-2 top-1/2 hidden -translate-y-1/2 text-[11px] text-slate-400 group-hover:block">
                    드래그해서 일정 그리기
                  </span>
                )}

                {/* 예상 완료 지연 구간 */}
                {s.plan_end && s.expected_end && s.expected_end > s.plan_end && !isDrag && (
                  <div
                    className="absolute top-[9px] h-[16px] rounded-r-md border border-dashed border-rose-400 bg-rose-50"
                    style={{ left: x(addDays(s.plan_end, 1)), width: diffDays(s.plan_end, s.expected_end) * ppd }}
                    title={`예상 완료 ${short(s.expected_end)}`}
                  />
                )}

                {/* 계획 막대 */}
                {ps && pe && (
                  <div
                    data-tour={s.id === firstBarId ? "gantt-bar" : undefined}
                    className={`absolute top-[9px] h-[16px] overflow-hidden rounded-md ${
                      byDept ? "" : s.skipped ? "bg-slate-200" : "bg-slate-200/80"
                    } ${canEdit && !s.skipped && !locked ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
                      isDrag ? "ring-2 ring-brand-500" : selected ? "ring-2 ring-ink/70" : ""
                    }`}
                    style={{
                      left: x(ps),
                      width: Math.max(ppd, (diffDays(ps, pe) + 1) * ppd),
                      ...(byDept ? { background: dc.light, boxShadow: `inset 0 0 0 1px ${dc.solid}55` } : {}),
                    }}
                    onPointerDown={(e) => (s.skipped || locked ? undefined : begin(e, s, "move"))}
                    onPointerMove={move}
                    onPointerUp={end}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!canEdit || s.skipped || locked) onSelect(s.id);
                    }}
                    title={`${s.name}\n계획 ${short(ps)} ~ ${short(pe)}${s.progress ? `\n진행률 ${s.progress}%` : ""}${locked ? "\n📅 구글 캘린더 일정을 따름" : ""}`}
                  >
                    <div
                      className={`h-full ${byDept ? "" : meta ? meta.bar : "bg-slate-400"} opacity-90`}
                      style={{ width: `${s.actual_end ? 100 : s.progress}%`, ...(byDept ? { background: dc.solid } : {}) }}
                    />
                    {canEdit && !s.skipped && !locked && (
                      <>
                        <span
                          className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-black/15"
                          onPointerDown={(e) => begin(e, s, "start")}
                        />
                        <span
                          className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-black/15"
                          onPointerDown={(e) => begin(e, s, "end")}
                        />
                      </>
                    )}
                  </div>
                )}

                {/* 실제 진행 선 */}
                {s.actual_start && actualEnd && !s.skipped && (
                  <div
                    className="absolute top-[29px] h-[4px] rounded-full bg-ink/70"
                    style={{ left: x(s.actual_start), width: Math.max(ppd, (diffDays(s.actual_start, actualEnd) + 1) * ppd) }}
                    title={`실제 ${short(s.actual_start)} ~ ${s.actual_end ? short(s.actual_end) : "진행 중"}`}
                  />
                )}

                {/* 드래그 중 날짜 표시 */}
                {isDrag && (
                  <div
                    className="pointer-events-none absolute -top-1 z-20 -translate-y-full whitespace-nowrap rounded-md bg-ink px-2 py-1 text-[11px] text-white shadow"
                    style={{ left: x(drag.start) }}
                  >
                    {short(drag.start)} ~ {short(drag.end)} · {diffDays(drag.start, drag.end) + 1}일
                    {projectStart && ` · ${weekNumber(projectStart, drag.start)}주차`}
                  </div>
                )}
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
