"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { addDays, diffDays, maxDate, minDate, monthStart, nextMonth, short, weekNumber } from "@/lib/dates";
import { STATUS_META, stageFinalStatus } from "@/lib/status";
import type { Stage, StageDep, StageGroup, StageLabel } from "@/lib/types";
import { groupSpan, type DropZone, type Row } from "@/lib/groups";
import { effectiveEnd } from "@/lib/deps";
import { StatusDot } from "./ui";
import { roleLabel, rolesFor, toList } from "@/lib/departments";
import type { DeptColorFn } from "@/lib/deptColors";
import { Fragment } from "react";

type Scale = "week" | "month";

// ---- 확대·축소 ---------------------------------------------------------------
export type Tier = "day" | "week" | "month" | "quarter" | "half" | "year";
/** 단위별 기본 배율 (하루당 px) */
export const ZOOM_PRESETS: { tier: Tier; label: string; ppd: number }[] = [
  { tier: "day", label: "일", ppd: 30 },
  { tier: "week", label: "주", ppd: 6 },
  { tier: "month", label: "월", ppd: 3.2 },
  { tier: "quarter", label: "분기", ppd: 1.3 },
  { tier: "half", label: "반기", ppd: 0.7 },
  { tier: "year", label: "연", ppd: 0.38 },
];
export const PPD_MIN = 0.22;
export const PPD_MAX = 60;
export const clampPpd = (n: number) => Math.min(PPD_MAX, Math.max(PPD_MIN, n));
export function tierOf(ppd: number): Tier {
  return ppd >= 14 ? "day" : ppd >= 4.2 ? "week" : ppd >= 1.9 ? "month" : ppd >= 0.95 ? "quarter" : ppd >= 0.5 ? "half" : "year";
}
/** 예전 주/월 버튼 값 → 배율 */
export const scaleToPpd = (sc: Scale) => (sc === "week" ? 6 : 3.2);

/** 확대·축소 버튼 (페이지 도구 줄에 둠) */
export function ZoomControl({ ppd, onChange, onFit }: { ppd: number; onChange: (n: number) => void; onFit?: () => void }) {
  const t = tierOf(ppd);
  return (
    <div className="flex items-center gap-1" data-tour="gantt-zoom">
      <button className="btn-ghost h-7 w-7 px-0 text-sm" onClick={() => onChange(clampPpd(ppd / 1.5))} title="축소 (Shift+휠 아래로)" disabled={ppd <= PPD_MIN}>
        −
      </button>
      <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs">
        {ZOOM_PRESETS.map((z) => (
          <button key={z.tier} onClick={() => onChange(z.ppd)} className={`rounded-md px-2 py-1 ${t === z.tier ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
            {z.label}
          </button>
        ))}
      </div>
      <button className="btn-ghost h-7 w-7 px-0 text-sm" onClick={() => onChange(clampPpd(ppd * 1.5))} title="확대 (Shift+휠 위로)" disabled={ppd >= PPD_MAX}>
        +
      </button>
      {onFit && (
        <button className="btn-ghost h-7 px-2 text-xs" onClick={onFit} title="모든 단계가 한 화면에 들어오게">
          전체
        </button>
      )}
    </div>
  );
}

/** 간트 배율 (하루당 px), 화면별로 기억 */
export function useGanttZoom(key: string, def: number) {
  const [ppd, setPpdState] = useState(def);
  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(key));
      if (v > 0) setPpdState(clampPpd(v));
    } catch {
      /* 무시 */
    }
  }, [key]);
  const setPpd = (n: number) => {
    const v = clampPpd(n);
    setPpdState(v);
    try {
      localStorage.setItem(key, String(v));
    } catch {
      /* 무시 */
    }
  };
  const [fitKey, setFitKey] = useState(0);
  return { ppd, setPpd, fitKey, fit: () => setFitKey((k) => k + 1) };
}

/** 단위 칸 만들기 [start, end) */
type Unit = { start: string; end: string; label: string; short: string; weekend?: boolean; current?: boolean };
function unitsOf(kind: Tier, from: string, to: string, today: string, projectStart: string | null, withYear: boolean): Unit[] {
  const out: Unit[] = [];
  const [fy, fm] = from.split("-").map(Number);
  const iso = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
  if (kind === "day") {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const dt = new Date(d + "T00:00:00");
      const wd = dt.getDay();
      out.push({ start: d, end: addDays(d, 1), label: String(dt.getDate()), short: String(dt.getDate()), weekend: wd === 0 || wd === 6, current: d === today });
    }
  } else if (kind === "week") {
    for (let d = from; d <= to; d = addDays(d, 7)) {
      const lab = projectStart ? String(weekNumber(projectStart, d)) : short(d);
      out.push({ start: d, end: addDays(d, 7), label: lab, short: lab, current: today >= d && today < addDays(d, 7) });
    }
  } else if (kind === "month") {
    for (let m = monthStart(from); m <= to; m = nextMonth(m)) {
      const [y, mo] = m.split("-").map(Number);
      const first = out.length === 0 || mo === 1;
      out.push({ start: m, end: nextMonth(m), label: withYear && first ? `${y}.${mo}월` : `${mo}월`, short: withYear && first ? `${String(y).slice(2)}.${mo}` : String(mo), current: today >= m && today < nextMonth(m) });
    }
  } else {
    const step = kind === "quarter" ? 3 : kind === "half" ? 6 : 12;
    let y = fy;
    let m = Math.floor((fm - 1) / step) * step + 1;
    for (;;) {
      const st = iso(y, m);
      if (st > to) break;
      let ny = y;
      let nm = m + step;
      if (nm > 12) {
        nm -= 12;
        ny += 1;
      }
      const en = iso(ny, nm);
      const idx = Math.floor((m - 1) / step) + 1;
      const label = kind === "quarter" ? `${idx}분기` : kind === "half" ? (idx === 1 ? "상반기" : "하반기") : `${y}년`;
      const sh = kind === "quarter" ? `Q${idx}` : kind === "half" ? (idx === 1 ? "상" : "하") : String(y);
      out.push({ start: st, end: en, label, short: sh, current: today >= st && today < en });
      y = ny;
      m = nm;
    }
  }
  return out;
}
const TIER_ROWS: Record<Tier, [Tier | null, Tier]> = {
  day: ["month", "day"],
  week: ["month", "week"],
  month: ["year", "month"],
  quarter: ["year", "quarter"],
  half: ["year", "half"],
  year: [null, "year"],
};
type DragMode = "move" | "start" | "end" | "create";

interface Drag {
  id: string;
  mode: DragMode;
  /** 여러 개를 고른 채 끌면 함께 이동 */
  group?: boolean;
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
export type TreeRef = { kind: "group" | "stage"; id: string };

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
  onTreeDrop,
  onDragBlocked,
  headerActions,
  onStageContext,
  onGroupContext,
  onBlankContext,
  ppd: ppdProp,
  onPpd,
  fitKey,
  multi,
  onSelectEx,
  onMoveMany,
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
  /** 단계 이름을 끌어서 다른 단계·그룹 위(안)/앞/뒤에 놓기 */
  onTreeDrop?: (drag: TreeRef, target: TreeRef, zone: DropZone) => void;
  /** 지금은 끌어서 옮길 수 없을 때 (이유 안내용) */
  onDragBlocked?: () => void;
  /** '단계' 머리 칸 오른쪽 버튼 (패널을 펼쳐도 보이는 자리) */
  headerActions?: React.ReactNode;
  /** 오른쪽 클릭 메뉴 */
  onStageContext?: (e: React.MouseEvent, s: Stage) => void;
  onGroupContext?: (e: React.MouseEvent, g: StageGroup) => void;
  onBlankContext?: (e: React.MouseEvent) => void;
  /** 확대·축소 배율 (하루당 px). 주면 scale 대신 씀 */
  ppd?: number;
  onPpd?: (n: number) => void;
  /** 바뀌면 모든 단계가 한 화면에 들어오게 맞춤 */
  fitKey?: number;
  /** 여러 단계 선택 (Ctrl·Shift+클릭) */
  multi?: Set<string>;
  onSelectEx?: (id: string, mods: { ctrl: boolean; shift: boolean }) => void;
  /** 고른 단계들을 같은 날수만큼 옮기기 */
  onMoveMany?: (ids: string[], days: number) => void;
}) {
  const [dragItem, setDragItem] = useState<TreeRef | null>(null);
  const [over, setOver] = useState<(TreeRef & { zone: DropZone }) | null>(null);
  const dnd = !!onTreeDrop && canEdit && !!rows;
  const dragProps = (ref: TreeRef) =>
    !dnd
      ? canEdit && onDragBlocked
        ? {
            draggable: true,
            onDragStart: (e: React.DragEvent) => {
              e.preventDefault();
              onDragBlocked();
            },
          }
        : {}
      : {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", ref.id);
            setDragItem(ref);
          },
          onDragEnd: () => {
            setDragItem(null);
            setOver(null);
          },
        };
  const dropProps = (ref: TreeRef) =>
    dnd && dragItem
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (dragItem.id === ref.id && dragItem.kind === ref.kind) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const f = (e.clientY - r.top) / r.height;
            // 그룹은 단계 안에 못 들어감
            const canInside = !(dragItem.kind === "group" && ref.kind === "stage");
            const zone: DropZone = f < 0.3 ? "before" : f > 0.7 || !canInside ? "after" : "inside";
            if (over?.id !== ref.id || over.zone !== zone || over.kind !== ref.kind) setOver({ ...ref, zone });
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const z = over && over.id === ref.id ? over.zone : "inside";
            const d = dragItem;
            setDragItem(null);
            setOver(null);
            if (d) onTreeDrop!(d, ref, z);
          },
        }
      : {};
  const dropCls = (ref: TreeRef) => {
    if (!over || over.id !== ref.id || over.kind !== ref.kind) return "";
    return over.zone === "inside"
      ? "!bg-brand-50 ring-2 ring-inset ring-brand-500"
      : over.zone === "before"
        ? "shadow-[inset_0_3px_0_0_var(--color-brand-500)]"
        : "shadow-[inset_0_-3px_0_0_var(--color-brand-500)]";
  };
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  const ppd = ppdProp ?? scaleToPpd(scale); // px per day
  const tier = tierOf(ppd);
  const many = !!multi && multi.size > 1;
  const pick = (id: string, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e && onSelectEx && (e.ctrlKey || e.metaKey || e.shiftKey)) onSelectEx(id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
    else onSelect(id);
  };
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
    // 주 단위 이상 확대면 프로젝트 시작일 기준(주차가 맞게), 더 축소하면 달 첫날부터
    if (tier !== "day" && tier !== "week") rs = monthStart(addDays(rs, tier === "month" ? 0 : -15));
    else if (tier === "day") rs = addDays(rs, -7);
    const minEnd = addDays(rs, tier === "week" || tier === "day" ? 26 * 7 : 365);
    const re = addDays(maxDate(...all, today, minEnd)!, tier === "day" ? 21 : tier === "week" ? 28 : Math.round(60 / Math.min(1, ppd / 3.2)));
    const fill = Math.ceil((boxW - LEFT) / ppd);
    return { rangeStart: rs, days: Math.max(diffDays(rs, re) + 1, fill) };
  }, [stages, projectStart, tier, today, boxW, ppd]);

  const width = Math.ceil(days * ppd);
  const rangeEnd = addDays(rangeStart, days - 1);
  const x = (d: string) => diffDays(rangeStart, d) * ppd;
  const dayAt = (px: number) => addDays(rangeStart, Math.floor(px / ppd));

  // 확대·축소할 때 기준 날짜가 화면의 같은 자리에 오도록
  const anchor = useRef<{ date: string; frac: number; sx: number } | null>(null);
  const firstScroll = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const a = anchor.current;
    if (a) {
      el.scrollLeft = Math.max(0, LEFT + (diffDays(rangeStart, a.date) + a.frac) * ppd - a.sx);
      anchor.current = null;
    } else if (firstScroll.current) {
      el.scrollLeft = Math.max(0, x(today) - 240);
    }
    firstScroll.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ppd, rangeStart]);

  /** 화면 x(스크롤 상자 기준) → 그 자리의 날짜 */
  const dateAtScreen = (sx: number) => {
    const el = scroller.current!;
    const px = el.scrollLeft + sx - LEFT;
    const dd = px / ppd;
    return { date: addDays(rangeStart, Math.floor(dd)), frac: dd - Math.floor(dd) };
  };
  const zoomTo = (next: number, sx?: number) => {
    const el = scroller.current;
    if (!el || !onPpd) return;
    const n = clampPpd(next);
    if (Math.abs(n - ppd) < 0.001) return;
    const at = sx ?? LEFT + (el.clientWidth - LEFT) / 2;
    anchor.current = { ...dateAtScreen(at), sx: at };
    onPpd(n);
  };
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;

  // 버튼으로 배율이 바뀌면 화면 가운데 기준
  const lastPpd = useRef(ppd);
  useLayoutEffect(() => {
    lastPpd.current = ppd;
  }, [ppd]);

  // Shift+휠: 마우스 자리 기준으로 확대·축소
  useEffect(() => {
    const el = scroller.current;
    if (!el || !onPpd) return;
    const on = (e: WheelEvent) => {
      if (!e.shiftKey) return;
      const r = el.getBoundingClientRect();
      const sx = e.clientX - r.left;
      if (sx < LEFT) return;
      e.preventDefault();
      const d = e.deltaY || e.deltaX;
      if (!d) return;
      zoomRef.current(lastPpd.current * (d < 0 ? 1.18 : 1 / 1.18), sx);
    };
    el.addEventListener("wheel", on, { passive: false });
    return () => el.removeEventListener("wheel", on);
  }, [onPpd]);

  // 전체 보기
  useEffect(() => {
    if (!fitKey || !onPpd) return;
    const el = scroller.current;
    const all = stages.flatMap((s) => [s.plan_start, s.plan_end, s.actual_end, s.expected_end]).filter(Boolean) as string[];
    if (!el || !all.length) return;
    const a = minDate(...all)!;
    const b = maxDate(...all)!;
    const span = diffDays(a, b) + 1;
    const n = clampPpd(((el.clientWidth - LEFT) * 0.94) / span);
    anchor.current = { date: a, frac: 0, sx: LEFT + (el.clientWidth - LEFT) * 0.03 };
    onPpd(n);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // Shift+끌기: 고른 날짜 구간이 화면에 꽉 차게 (Shift+클릭은 2배 확대)
  const [band, setBand] = useState<{ x0: number; x1: number } | null>(null);
  const bandRef = useRef<{ x0: number; x1: number; id: number } | null>(null);
  const onBandDown = (e: React.PointerEvent) => {
    if (!e.shiftKey || e.button !== 0 || !onPpd) return;
    if ((e.target as Element).closest?.("[data-stage-bar]")) return; // 막대 Shift+클릭은 여러 개 선택
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    const sx = e.clientX - r.left;
    if (sx < LEFT) return;
    e.preventDefault();
    e.stopPropagation();
    el.setPointerCapture(e.pointerId);
    const cx = el.scrollLeft + sx - LEFT;
    bandRef.current = { x0: cx, x1: cx, id: e.pointerId };
    setBand({ x0: cx, x1: cx });
  };
  const onBandMove = (e: React.PointerEvent) => {
    const b = bandRef.current;
    if (!b || b.id !== e.pointerId) return;
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    const cx = Math.max(0, Math.min(width, el.scrollLeft + e.clientX - r.left - LEFT));
    b.x1 = cx;
    setBand({ x0: b.x0, x1: cx });
  };
  const onBandUp = (e: React.PointerEvent) => {
    const b = bandRef.current;
    if (!b || b.id !== e.pointerId) return;
    bandRef.current = null;
    setBand(null);
    const el = scroller.current!;
    const lo = Math.min(b.x0, b.x1);
    const hi = Math.max(b.x0, b.x1);
    if (hi - lo < 6) {
      // Shift+클릭: 그 자리 2배 확대
      zoomTo(ppd * 2, lo - el.scrollLeft + LEFT);
      return;
    }
    const d0 = lo / ppd;
    const span = Math.max(1, (hi - lo) / ppd);
    const n = clampPpd((el.clientWidth - LEFT) / span);
    anchor.current = { date: addDays(rangeStart, Math.floor(d0)), frac: d0 - Math.floor(d0), sx: LEFT };
    onPpd?.(n);
  };

  const [topKind, botKind] = TIER_ROWS[tier];
  const topUnits = useMemo(() => (topKind ? unitsOf(topKind, rangeStart, rangeEnd, today, projectStart, true) : []), [topKind, rangeStart, rangeEnd, today, projectStart]);
  const botUnits = useMemo(() => unitsOf(botKind, rangeStart, rangeEnd, today, projectStart, !topKind), [botKind, rangeStart, rangeEnd, today, projectStart, topKind]);
  const clipL = (u: Unit) => x(u.start < rangeStart ? rangeStart : u.start);
  const clipW = (u: Unit) => diffDays(u.start < rangeStart ? rangeStart : u.start, u.end > addDays(rangeEnd, 1) ? addDays(rangeEnd, 1) : u.end) * ppd;

  function begin(e: React.PointerEvent, s: Stage, mode: DragMode) {
    if (!canEdit || e.button !== 0 || e.shiftKey || e.ctrlKey || e.metaKey) return;
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
      group: mode === "move" && many && multi!.has(s.id) && !!onMoveMany,
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
      // 그냥 눌렀으면 그 단계만 고름 (여러 개 선택은 풀림)
      onSelect(d.id);
      return;
    }
    if (d.group) {
      const days = diffDays(d.start0, d.start);
      if (days) onMoveMany?.([...multi!], days);
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
  const items: Row[] = rows ?? stages.map((s, i) => ({ kind: "stage" as const, stage: s, depth: 0, no: i + 1, children: [], collapsed: false }));
  const headH = 52;
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
      const down = yb > ya;
      const edgeY = ya + (down ? 8 : -8); // 앞 막대의 아래(위) 가장자리
      const aStart = a.plan_start ? x(a.plan_start) : x1 - 16;
      // 막대 끝 조금 안쪽에서 바로 내려와 오른쪽으로 들어가는 자리
      const sx = Math.max(aStart + 3, Math.min(x1 - 6, x2 - 8));
      if (x2 - x1 >= 14) {
        // 사이가 떠 있으면: 끝에서 오른쪽으로 나가 내려가서 들어감
        path = `M${x1},${ya} H${x1 + 6} V${yb} H${x2 - 2}`;
      } else if (x2 - sx >= 6) {
        // 바로 이어지면: 앞 막대 끝에서 곧게 내려와 다음 막대로 (되돌아가는 꺾임 없음)
        path = `M${sx},${edgeY} V${yb} H${x2 - 2}`;
      } else if (!late) {
        // 앞 막대가 짧아(1일 등) 옆으로 들어갈 틈이 없으면: 계단처럼 앞으로만 내려가 다음 막대 위(아래) 가장자리로 들어감
        const be = drag?.id === b.id ? drag.end : b.plan_end;
        const bw = be ? (diffDays(bs, be) + 1) * ppd : ppd;
        const tx = x2 + Math.max(1, Math.min(8, bw / 2));
        const sx2 = Math.min(sx, (aStart + x1) / 2);
        const enter = down ? yb - 8 : yb + 8;
        const step = down ? enter - 8 : enter + 8;
        path = tx - sx2 < 2 ? `M${tx},${edgeY} V${enter - (down ? 1 : -1)}` : `M${sx2},${edgeY} V${step} H${tx} V${enter - (down ? 1 : -1)}`;
      } else {
        // 겹치면(앞 단계가 끝나기 전에 시작): 돌아서 들어감 — 빨간 점선으로 경고
        const mid = down ? yb - ROW / 2 + 4 : yb + ROW / 2 - 4;
        path = `M${x1},${ya} H${x1 + 6} V${mid} H${x2 - 10} V${yb} H${x2 - 2}`;
      }
      return { key: d.pred_id + d.succ_id, path, late, title: `${a.name} → ${b.name}${late ? " (겹침: 앞 단계가 끝나기 전에 시작)" : ""}` };
    })
    .filter(Boolean) as { key: string; path: string; late: boolean; title: string }[];

  return (
    <div
      ref={scroller}
      className="scroll-thin relative max-h-[calc(100vh-250px)] min-h-[300px] overflow-auto"
      style={{ userSelect: drag || band ? "none" : undefined }}
      onContextMenu={onBlankContext}
      onPointerDownCapture={onBandDown}
      onPointerMove={onBandMove}
      onPointerUp={onBandUp}
      onPointerCancel={() => ((bandRef.current = null), setBand(null))}
    >
      <div style={{ width: LEFT + width }} className="relative">
        {/* 헤더 */}
        <div className="sticky top-0 z-20 flex border-b border-black/[0.08] bg-white">
          <div
            className="sticky left-0 z-30 flex shrink-0 items-end border-r border-black/[0.08] bg-white px-3 pb-1.5 text-xs font-medium text-slate-500"
            style={{ width: LEFT, height: 52 }}
            data-gantt-left
          >
            <span>단계</span>
            {headerActions && <span className="ml-auto flex items-center gap-1 pb-0.5">{headerActions}</span>}
          </div>
          <div className="relative select-none" style={{ width, height: 52 }} title={onPpd ? "Shift+끌기: 그 구간 확대 · Shift+휠: 확대·축소" : undefined}>
            {topUnits.map((u) => {
              const w = clipW(u);
              return (
                <div key={"t" + u.start} className="absolute top-0 flex h-[26px] items-center border-l border-black/[0.08] px-1.5 text-xs font-medium text-slate-600" style={{ left: clipL(u), width: w }}>
                  <span className="sticky left-[288px] truncate">{w > u.label.length * 8 + 8 ? u.label : w > 26 ? u.short : ""}</span>
                </div>
              );
            })}
            {botUnits.map((u) => {
              const w = clipW(u);
              const text = w > u.label.length * 7.5 + 6 ? u.label : w > u.short.length * 7 + 4 ? u.short : "";
              return (
                <div
                  key={"b" + u.start}
                  title={botKind === "week" ? `${projectStart ? u.label + "주차 · " : ""}${short(u.start)}~${short(addDays(u.end, -1))}` : botKind === "day" ? u.start : undefined}
                  className={`absolute flex items-center justify-center border-l text-[11px] tabular-nums ${topKind ? "top-[26px] h-[26px]" : "top-0 h-[52px] text-xs"} ${
                    u.current ? "border-black/[0.05] bg-brand-50 font-semibold text-brand-600" : u.weekend ? "border-black/[0.05] bg-slate-50 text-slate-400" : "border-black/[0.05] text-slate-400"
                  }`}
                  style={{ left: clipL(u), width: w }}
                >
                  {text}
                </div>
              );
            })}
          </div>
        </div>

        {/* 배경 격자 + 오늘 선 */}
        <div className="pointer-events-none absolute bottom-0 z-0" style={{ left: LEFT, width, top: 52 }}>
          {botUnits.map((u) => (
            <div
              key={u.start}
              className={`absolute bottom-0 top-0 border-l ${u.current && botKind !== "year" ? "border-brand-100 bg-brand-50/40" : u.weekend ? "border-black/[0.03] bg-slate-50/70" : botKind === "day" ? "border-black/[0.03]" : "border-black/[0.045]"}`}
              style={{ left: clipL(u), width: clipW(u) }}
            />
          ))}
          {topKind && topUnits.map((u) => <div key={"tl" + u.start} className="absolute bottom-0 top-0 border-l border-black/[0.07]" style={{ left: clipL(u) }} />)}
          {band && <div className="absolute bottom-0 top-[-52px] z-20 border-x-2 border-brand-500 bg-brand-500/10" style={{ left: Math.min(band.x0, band.x1), width: Math.abs(band.x1 - band.x0) }} />}
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
              <div
                key={`g-${g.id}`}
                className={`group/g relative flex border-b border-black/[0.06] bg-slate-50 ${menu === g.id ? "z-30" : "z-10"} ${dropCls({ kind: "group", id: g.id })}`}
                style={{ height: GROUP_ROW }}
                {...dropProps({ kind: "group", id: g.id })}
                onContextMenu={onGroupContext ? (e) => onGroupContext(e, g) : undefined}
              >
                <div
                  className={`sticky left-0 z-10 flex shrink-0 select-none items-center gap-1.5 border-r border-black/[0.08] bg-slate-50 pr-2 text-xs font-semibold text-slate-700 ${dnd ? "cursor-grab active:cursor-grabbing" : ""} ${dragItem?.id === g.id ? "opacity-40" : ""}`}
                  style={{ width: LEFT, paddingLeft: 8 + row.depth * 14 }}
                  {...dragProps({ kind: "group", id: g.id })}
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
                      style={{ left: x(sp.start), width: Math.max(Math.max(ppd, 2), (diffDays(sp.start, sp.end) + 1) * ppd) }}
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
          const inMulti = !!multi?.has(s.id) && many;
          // 함께 끌리는 단계
          const groupDays = drag?.group && inMulti && !isDrag ? diffDays(drag.start0, drag.start) : 0;
          const ps = isDrag ? drag.start : s.plan_start && groupDays ? addDays(s.plan_start, groupDays) : s.plan_start;
          const pe = isDrag ? drag.end : s.plan_end && groupDays ? addDays(s.plan_end, groupDays) : s.plan_end;
          const selected = selectedId === s.id || inMulti;
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
              className={`group relative z-10 flex border-b border-black/[0.05] ${selected ? "bg-brand-50/50" : "hover:bg-slate-50/60"} ${dropCls({ kind: "stage", id: s.id })}`}
              style={{ height: ROW }}
              {...dropProps({ kind: "stage", id: s.id })}
              onContextMenu={onStageContext ? (e) => onStageContext(e, s) : undefined}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={(e) => pick(s.id, e)}
                onKeyDown={(e) => e.key === "Enter" && onSelect(s.id)}
                className={`sticky left-0 z-10 flex shrink-0 cursor-pointer select-none items-center gap-2 border-r border-black/[0.08] px-3 text-left ${
                  selected ? "bg-brand-50" : "bg-white group-hover:bg-slate-50"
                } ${dragItem?.id === s.id ? "opacity-40" : ""}`}
                style={{ width: LEFT, paddingLeft: 12 + row.depth * 14 }}
                title={dnd ? "끌어서 다른 단계 위에 놓으면 그 단계의 하위 단계가 됩니다 (위·아래 가장자리에 놓으면 순서 이동)" : undefined}
                {...dragProps({ kind: "stage", id: s.id })}
              >
                {dc && <span className="absolute inset-y-0 left-0 w-[4px]" style={{ background: dc.solid }} />}
                {row.kind === "stage" && row.children.length > 0 ? (
                  <button
                    className="-mr-1 grid h-5 w-4 shrink-0 place-items-center rounded text-[11px] text-slate-500 hover:bg-black/[0.06]"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleGroup?.(s.id);
                    }}
                    title={row.collapsed ? `하위 단계 ${row.children.length}개 펼치기` : "접기"}
                  >
                    {row.collapsed ? "▸" : "▾"}
                  </button>
                ) : rows ? (
                  <span className="-mr-1 w-4 shrink-0" />
                ) : null}
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
                {row.collapsed && row.children.length > 0 && (
                  <span className="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500" title="접힌 하위 단계">
                    +{row.children.length}
                  </span>
                )}
              </div>

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

                {/* 하위 단계 전체 기간 */}
                {row.children.length > 0 &&
                  (() => {
                    const sp = groupSpan([s, ...row.children]);
                    if (!sp.start || !sp.end) return null;
                    return (
                      <div
                        className="pointer-events-none absolute top-[3px] h-[3px] rounded-full bg-slate-500/70"
                        style={{ left: x(sp.start), width: Math.max(Math.max(ppd, 2), (diffDays(sp.start, sp.end) + 1) * ppd) }}
                        title={`하위 단계 포함 ${short(sp.start)} ~ ${short(sp.end)}`}
                      />
                    );
                  })()}
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
                    data-stage-bar
                    className={`absolute top-[9px] h-[16px] overflow-hidden rounded-md ${
                      byDept ? "" : s.skipped ? "bg-slate-200" : "bg-slate-200/80"
                    } ${canEdit && !s.skipped && !locked ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"} ${
                      isDrag || groupDays ? "ring-2 ring-brand-500" : inMulti ? "ring-2 ring-brand-500/80" : selected ? "ring-2 ring-ink/70" : ""
                    }`}
                    style={{
                      left: x(ps),
                      width: Math.max(Math.max(ppd, 2), (diffDays(ps, pe) + 1) * ppd),
                      ...(byDept ? { background: dc.light, boxShadow: `inset 0 0 0 1px ${dc.solid}55` } : {}),
                    }}
                    onPointerDown={(e) => (s.skipped || locked ? undefined : begin(e, s, "move"))}
                    onPointerMove={move}
                    onPointerUp={end}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (e.ctrlKey || e.metaKey || e.shiftKey) pick(s.id, e);
                      else if (!canEdit || s.skipped || locked) onSelect(s.id);
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
                    style={{ left: x(s.actual_start), width: Math.max(Math.max(ppd, 2), (diffDays(s.actual_start, actualEnd) + 1) * ppd) }}
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
