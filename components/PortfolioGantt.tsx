"use client";

// 대시보드: 전체 프로젝트 간트 — 프로젝트마다 한 줄, ▸를 누르면 단계(최상위)까지
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, diffDays, full, maxDate, minDate, monthStart, nextMonth, short } from "@/lib/dates";
import { STATUS_META, stageFinalStatus, type AutoStatus, type ProjectSummary } from "@/lib/status";
import type { Project, Stage } from "@/lib/types";
import { StatusDot } from "./ui";

export interface PortfolioRow {
  p: Project;
  sum: ProjectSummary;
  stages: Stage[];
}

type Scale = "week" | "month" | "quarter";
const PX: Record<Scale, number> = { week: 7, month: 2.6, quarter: 1.1 };
const SCALE_LABEL: Record<Scale, string> = { week: "주", month: "월", quarter: "분기" };
const LEFT = 280;
const ROW = 40;
const SUB = 28;

function load<T extends string>(key: string, ok: readonly T[], def: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && ok.includes(v) ? v : def;
  } catch {
    return def;
  }
}
function store(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 무시 */
  }
}

function barTone(st: AutoStatus) {
  return STATUS_META[st ?? "waiting"] ?? STATUS_META.waiting;
}

export function PortfolioGantt({ rows, today }: { rows: PortfolioRow[]; today: string }) {
  const [scale, setScaleState] = useState<Scale>("month");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setScaleState(load("npd-pg-scale", ["week", "month", "quarter"] as const, "month"));
    try {
      const o = JSON.parse(localStorage.getItem("npd-pg-open") ?? "[]");
      if (Array.isArray(o)) setOpen(new Set(o));
    } catch {
      /* 무시 */
    }
  }, []);
  const setScale = (s: Scale) => {
    setScaleState(s);
    store("npd-pg-scale", s);
  };
  const toggle = (id: string) =>
    setOpen((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      store("npd-pg-open", JSON.stringify([...n]));
      return n;
    });
  const setAll = (on: boolean) => {
    const n = new Set(on ? rows.map((r) => r.p.id) : []);
    store("npd-pg-open", JSON.stringify([...n]));
    setOpen(n);
  };

  const px = PX[scale];
  // 화면 너비만큼은 채우도록 (짧은 기간이어도 오른쪽이 비지 않게)
  const [boxW, setBoxW] = useState(0);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 보이는 기간: 가장 이른 시작 ~ 가장 늦은 (예상) 완료, 오늘 포함
  const range = useMemo(() => {
    const starts = rows.map((r) => r.sum.start);
    const ends = rows.map((r) => maxDate(r.sum.planEnd, r.sum.forecastEnd, r.sum.actualEnd));
    const s0 = minDate(...starts, today) ?? today;
    const e0 = maxDate(...ends, today) ?? today;
    const start = monthStart(addDays(s0, -7));
    let end = addDays(nextMonth(monthStart(addDays(e0, 21))), -1); // 끝 날짜 글자가 잘리지 않게 여유
    const minDays = Math.ceil((boxW - LEFT) / px);
    while (diffDays(start, end) + 1 < minDays) end = addDays(nextMonth(monthStart(addDays(end, 1))), -1);
    return { start, end, days: diffDays(start, end) + 1 };
  }, [rows, today, boxW, px]);

  const x = (d: string) => diffDays(range.start, d) * px;
  const width = range.days * px;

  const months = useMemo(() => {
    const out: { d: string; label: string }[] = [];
    for (let m = range.start; m <= range.end; m = nextMonth(m)) {
      const [y, mo] = m.split("-").map(Number);
      out.push({ d: m, label: scale === "quarter" ? (mo % 3 === 1 ? `${String(y).slice(2)}.${mo}` : "") : mo === 1 || m === range.start ? `${y}.${mo}` : `${mo}월` });
    }
    return out;
  }, [range, scale]);

  // 주 보기: 월요일마다 눈금
  const weeks = useMemo(() => {
    if (scale !== "week") return [];
    const out: string[] = [];
    const first = new Date(range.start + "T00:00:00");
    const off = (8 - first.getDay()) % 7; // 다음 월요일
    for (let d = addDays(range.start, off); d <= range.end; d = addDays(d, 7)) out.push(d);
    return out;
  }, [range, scale]);

  // 처음과 배율을 바꿀 때: 오늘이 왼쪽 1/4쯤 오도록
  const goToday = () => {
    const el = scroller.current;
    if (!el) return;
    el.scrollLeft = Math.max(0, x(today) - (el.clientWidth - LEFT) / 4);
  };
  useEffect(goToday, [scale, range.start]); // eslint-disable-line react-hooks/exhaustive-deps

  const bodyRows: React.ReactNode[] = [];
  rows.forEach(({ p, sum, stages }) => {
    const isOpen = open.has(p.id);
    const top = stages.filter((s) => !s.parent_id && !s.skipped).sort((a, b) => a.sort_order - b.sort_order);
    const tone = barTone(sum.final);
    const s = sum.start;
    const pe = sum.planEnd;
    const fe = sum.actualEnd ?? sum.forecastEnd;
    const delay = pe && fe ? diffDays(pe, fe) : 0;
    bodyRows.push(
      <div key={p.id} className={`group flex border-b border-black/[0.05] hover:bg-slate-50/70 ${p.archived ? "opacity-50" : ""}`} style={{ height: ROW }}>
        <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-black/[0.06] bg-white px-2 group-hover:bg-slate-50" style={{ width: LEFT }}>
          <button
            className={`grid h-6 w-6 shrink-0 place-items-center rounded text-[10px] text-slate-400 hover:bg-black/[0.06] ${top.length ? "" : "invisible"}`}
            onClick={() => toggle(p.id)}
            title={isOpen ? "단계 접기" : "단계 펼치기"}
          >
            {isOpen ? "▾" : "▸"}
          </button>
          <StatusDot status={sum.final} />
          <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-600" title={p.name}>
            {p.name}
          </Link>
          <span className="shrink-0 text-[11px] tabular-nums text-slate-400">{sum.progress}%</span>
        </div>
        <div className="relative shrink-0" style={{ width }}>
          {s && pe && (
            <Link
              href={`/projects/${p.id}`}
              className="absolute top-1/2 block h-5 -translate-y-1/2 overflow-hidden rounded-md ring-1 ring-inset ring-black/10"
              style={{ left: x(s), width: Math.max(4, x(pe) - x(s) + px) }}
              title={`${p.name}\n계획 ${full(s)} ~ ${full(pe)}${delay > 0 ? `\n예상 ${full(fe)} (+${delay}일)` : ""}\n진행률 ${sum.progress}% · ${sum.counts.done}/${sum.counts.total} 단계`}
            >
              <span className={`absolute inset-0 opacity-25 ${tone.bar}`} />
              <span className={`absolute inset-y-0 left-0 ${tone.bar}`} style={{ width: `${sum.progress}%` }} />
            </Link>
          )}
          {s && pe && fe && delay > 0 && (
            <span
              className="absolute top-1/2 h-5 -translate-y-1/2 rounded-r-md border-2 border-l-0 border-dashed border-rose-400 bg-rose-50/60"
              style={{ left: x(pe) + px, width: Math.max(4, x(fe) - x(pe)) }}
              title={`예상 완료 ${full(fe)} (계획보다 ${delay}일 늦음)`}
            />
          )}
          {s && pe && (
            <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap pl-1.5 text-[11px] text-slate-500" style={{ left: x(delay > 0 && fe ? fe : pe) + px + 2 }}>
              {short(delay > 0 && fe ? fe : pe)}
              {delay > 0 && <b className="ml-1 font-medium text-rose-600">+{delay}일</b>}
            </span>
          )}
          {!s && <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-300">일정 없음</span>}
        </div>
      </div>
    );
    if (isOpen) {
      top.forEach((st) => {
        const stStatus = stageFinalStatus(st, today);
        const t2 = barTone(stStatus);
        const a = st.plan_start;
        const b = st.plan_end;
        const late = b ? (st.actual_end ?? st.expected_end) : null;
        const lateDays = b && late ? diffDays(b, late) : 0;
        bodyRows.push(
          <div key={st.id} className="group flex border-b border-black/[0.03] bg-slate-50/30 hover:bg-slate-50" style={{ height: SUB }}>
            <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-black/[0.06] bg-slate-50 pl-10 pr-2" style={{ width: LEFT }}>
              <StatusDot status={stStatus} />
              <Link href={`/projects/${p.id}?stage=${st.id}`} className="min-w-0 flex-1 truncate text-xs text-slate-600 hover:text-brand-600" title={st.name}>
                {st.name}
              </Link>
              {st.department && <span className="max-w-[72px] shrink-0 truncate text-[10px] text-slate-400">{st.department}</span>}
            </div>
            <div className="relative shrink-0" style={{ width }}>
              {a && b ? (
                <>
                  <Link
                    href={`/projects/${p.id}?stage=${st.id}`}
                    className="absolute top-1/2 block h-3 -translate-y-1/2 overflow-hidden rounded"
                    style={{ left: x(a), width: Math.max(3, x(b) - x(a) + px) }}
                    title={`${st.name}\n계획 ${full(a)} ~ ${full(b)}${lateDays > 0 ? `\n${st.actual_end ? "실제" : "예상"} ${full(late)} (+${lateDays}일)` : ""}\n진행률 ${st.actual_end ? 100 : st.progress}%`}
                  >
                    <span className={`absolute inset-0 opacity-30 ${t2.bar}`} />
                    <span className={`absolute inset-y-0 left-0 ${t2.bar}`} style={{ width: `${st.actual_end ? 100 : st.progress}%` }} />
                  </Link>
                  {lateDays > 0 && (
                    <span
                      className="absolute top-1/2 h-3 -translate-y-1/2 rounded-r border border-l-0 border-dashed border-rose-400"
                      style={{ left: x(b) + px, width: Math.max(3, x(late!) - x(b)) }}
                    />
                  )}
                </>
              ) : null}
            </div>
          </div>
        );
      });
    }
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.06] px-4 py-2">
        <div className="inline-flex rounded-lg bg-black/[0.04] p-0.5 text-xs">
          {(["week", "month", "quarter"] as Scale[]).map((s) => (
            <button key={s} onClick={() => setScale(s)} className={`rounded-md px-2.5 py-1 ${scale === s ? "bg-white font-medium shadow-sm" : "text-slate-500"}`}>
              {SCALE_LABEL[s]}
            </button>
          ))}
        </div>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={goToday}>
          오늘로
        </button>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setAll(open.size < rows.length)}>
          {open.size < rows.length ? "단계 모두 펼치기" : "단계 모두 접기"}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
          {(["green", "yellow", "red", "waiting", "done"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span className={`h-2 w-3 rounded-sm ${STATUS_META[k].bar}`} />
              {STATUS_META[k].label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="h-2 w-3 rounded-sm border border-dashed border-rose-400" />
            예상 지연
          </span>
          <span className="flex items-center gap-1">
            <span className="h-3 w-px bg-brand-500" />
            오늘
          </span>
        </div>
      </div>

      <div ref={scroller} className="scroll-thin max-h-[calc(100vh-260px)] min-h-[240px] overflow-auto">
        <div className="relative" style={{ width: LEFT + width }}>
          {/* 머리: 월 */}
          <div className="sticky top-0 z-20 flex h-11 border-b border-black/[0.08] bg-white">
            <div className="sticky left-0 z-30 flex shrink-0 items-center border-r border-black/[0.06] bg-white px-3 text-[11px] font-medium text-slate-500" style={{ width: LEFT }}>
              프로젝트 ({rows.length})
            </div>
            <div className="relative shrink-0" style={{ width }}>
              {months.map((m) => (
                <span key={m.d} className="absolute top-0 h-full border-l border-black/[0.08] pl-1.5 pt-1 text-[11px] text-slate-500" style={{ left: x(m.d) }}>
                  {m.label}
                </span>
              ))}
              <span className="absolute bottom-1 -translate-x-1/2 rounded bg-brand-500 px-1 text-[10px] font-medium text-white" style={{ left: x(today) + px / 2 }}>
                {short(today)}
              </span>
            </div>
          </div>

          {/* 배경 눈금 + 오늘 선 */}
          <div className="pointer-events-none absolute bottom-0 top-11" style={{ left: LEFT, width }}>
            {weeks.map((d) => (
              <span key={d} className="absolute inset-y-0 border-l border-black/[0.03]" style={{ left: x(d) }} />
            ))}
            {months.map((m) => (
              <span key={m.d} className="absolute inset-y-0 border-l border-black/[0.07]" style={{ left: x(m.d) }} />
            ))}
            <span className="absolute inset-y-0 z-[5] w-px bg-brand-500/70" style={{ left: x(today) + px / 2 }} />
          </div>

          {bodyRows}
        </div>
      </div>
    </div>
  );
}
