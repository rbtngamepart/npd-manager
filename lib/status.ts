import type { Light, Project, Stage } from "./types";
import { diffDays, maxDate, minDate } from "./dates";

/**
 * 자동 상태
 *  - done    : 실제 완료일 입력됨
 *  - waiting : 아직 계획 시작 전
 *  - red     : 계획 종료일이 지났는데 미완료
 *  - yellow  : 예상 완료일이 계획 종료일보다 늦음 / 계획 시작일이 지났는데 실제 시작 안 함
 *  - green   : 그 외 정상
 *  - null    : 계획 일정이 없음 (시트의 '공란')
 */
export type AutoStatus = Light | "done" | "waiting" | null;

export function stageAutoStatus(s: Stage, today: string): AutoStatus {
  if (s.skipped) return null;
  if (s.actual_end) return "done";
  if (!s.plan_start || !s.plan_end) return null;
  if (today > s.plan_end) return "red";
  if (s.expected_end && s.expected_end > s.plan_end) return "yellow";
  if (today >= s.plan_start && !s.actual_start) return "yellow";
  if (today < s.plan_start && !s.actual_start) return "waiting";
  return "green";
}

/** 최종 상태 = PM 판단이 있으면 PM 판단, 없으면 자동 상태 */
export function stageFinalStatus(s: Stage, today: string): AutoStatus {
  if (s.skipped) return null;
  if (s.actual_end && !s.pm_status) return "done";
  return s.pm_status ?? stageAutoStatus(s, today);
}

const RANK: Record<string, number> = { red: 4, yellow: 3, green: 2, waiting: 1, done: 0 };

export function worst(statuses: AutoStatus[]): AutoStatus {
  const v = statuses.filter(Boolean) as Exclude<AutoStatus, null>[];
  if (!v.length) return null;
  if (v.every((x) => x === "done")) return "done";
  const active = v.filter((x) => x !== "done");
  return active.reduce((a, b) => (RANK[b] > RANK[a] ? b : a));
}

export function stageWeight(s: Stage): number {
  if (s.plan_start && s.plan_end) return Math.max(1, diffDays(s.plan_start, s.plan_end) + 1);
  return 7;
}

export interface ProjectSummary {
  start: string | null;
  planEnd: string | null;
  forecastEnd: string | null;
  actualEnd: string | null;
  progress: number;
  auto: AutoStatus;
  final: AutoStatus;
  counts: { total: number; done: number; red: number; yellow: number; check: number };
  current: Stage[];
}

export function summarize(p: Project, stages: Stage[], today: string): ProjectSummary {
  const active = stages.filter((s) => !s.skipped);
  const totalW = active.reduce((a, s) => a + stageWeight(s), 0);
  const progress = totalW
    ? Math.round(active.reduce((a, s) => a + stageWeight(s) * (s.actual_end ? 100 : s.progress), 0) / totalW)
    : 0;
  const finals = active.map((s) => stageFinalStatus(s, today));
  const autos = active.map((s) => stageAutoStatus(s, today));
  const allDone = active.length > 0 && active.every((s) => s.actual_end);
  const auto = worst(autos);
  const current = active.filter(
    (s) => !s.actual_end && ((s.plan_start && s.plan_start <= today) || s.actual_start)
  );
  return {
    start: p.start_date ?? minDate(...active.map((s) => s.plan_start)),
    planEnd: maxDate(...active.map((s) => s.plan_end)),
    forecastEnd: maxDate(...active.map((s) => s.actual_end ?? s.expected_end ?? s.plan_end)),
    actualEnd: allDone ? maxDate(...active.map((s) => s.actual_end)) : null,
    progress,
    auto,
    final: p.pm_status ?? (allDone ? "done" : worst(finals)),
    counts: {
      total: active.length,
      done: active.filter((s) => s.actual_end).length,
      red: finals.filter((x) => x === "red").length,
      yellow: finals.filter((x) => x === "yellow").length,
      check: active.filter((s) => s.needs_check).length,
    },
    current,
  };
}

export const STATUS_META: Record<string, { label: string; dot: string; chip: string; bar: string }> = {
  green: { label: "정상", dot: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", bar: "bg-emerald-500" },
  yellow: { label: "주의", dot: "bg-amber-400", chip: "bg-amber-50 text-amber-800 ring-amber-200", bar: "bg-amber-400" },
  red: { label: "차질", dot: "bg-rose-500", chip: "bg-rose-50 text-rose-700 ring-rose-200", bar: "bg-rose-500" },
  done: { label: "완료", dot: "bg-slate-400", chip: "bg-slate-100 text-slate-600 ring-slate-200", bar: "bg-slate-400" },
  waiting: { label: "대기", dot: "bg-sky-300", chip: "bg-sky-50 text-sky-700 ring-sky-200", bar: "bg-sky-300" },
};

export const LIGHT_EMOJI: Record<Light, string> = { green: "🟢", yellow: "🟡", red: "🔴" };

export function emojiToLight(raw: string | undefined | null): Light | null {
  if (!raw) return null;
  if (raw.includes("🟢") || /정상/.test(raw)) return "green";
  if (raw.includes("🟡") || /주의|협의/.test(raw)) return "yellow";
  if (raw.includes("🔴") || /차질|의사결정/.test(raw)) return "red";
  return null;
}
