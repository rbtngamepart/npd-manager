// 선후 관계: 앞 단계가 늦어지면 뒤 단계를 얼마나 미룰지 계산
import { addDays, diffDays, maxDate } from "./dates";
import type { Stage, StageDep } from "./types";

/** 단계가 실제로 끝나는(끝날) 날 */
export function effectiveEnd(s: Pick<Stage, "actual_end" | "plan_end" | "expected_end">): string | null {
  return s.actual_end ?? maxDate(s.plan_end, s.expected_end);
}

export function succsOf(id: string, deps: StageDep[]): string[] {
  return deps.filter((d) => d.pred_id === id).map((d) => d.succ_id);
}
export function predsOf(id: string, deps: StageDep[]): string[] {
  return deps.filter((d) => d.succ_id === id).map((d) => d.pred_id);
}

/** pred → succ 를 추가하면 순환이 생기는지 (succ에서 출발해 pred에 닿으면 순환) */
export function wouldCycle(deps: StageDep[], pred: string, succ: string): boolean {
  if (pred === succ) return true;
  const seen = new Set<string>();
  const stack = [succ];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === pred) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...succsOf(n, deps));
  }
  return false;
}

export interface ShiftItem {
  stage: Stage;
  days: number;
  plan_start: string;
  plan_end: string;
  expected_end: string | null;
  /** 구글 캘린더 일정을 따르는 단계 (NPD에서 못 바꿈) */
  locked: boolean;
  /** 어느 앞 단계 때문에 */
  via: string;
}

export type ShiftMode = "keep" | "needed";

/**
 * changed 단계가 before → after 로 바뀌었을 때 뒤 단계들 이동안.
 * keep: 간격을 그대로 두고 모두 같은 날 수만큼
 * needed: 겹치게 되는 단계만 필요한 만큼
 */
export function planShift(stages: Stage[], deps: StageDep[], before: Stage, after: Stage, mode: ShiftMode): { delay: number; items: ShiftItem[] } {
  const e0 = effectiveEnd(before);
  const e1 = effectiveEnd(after);
  if (!e0 || !e1) return { delay: 0, items: [] };
  const delay = diffDays(e0, e1);
  if (delay <= 0 || !succsOf(after.id, deps).length) return { delay: Math.max(0, delay), items: [] };

  const byId = new Map(stages.map((s) => [s.id, s]));
  byId.set(after.id, after);
  const shift = new Map<string, { days: number; via: string }>();
  const endOf = (id: string): string | null => {
    const s = byId.get(id)!;
    if (id === after.id) return e1;
    const d = shift.get(id)?.days ?? 0;
    const e = effectiveEnd(s);
    return e && !s.actual_end ? addDays(e, d) : e;
  };
  const movable = (s: Stage | undefined): s is Stage => !!s && !s.actual_end && !!s.plan_start && !!s.plan_end && !s.skipped;

  let queue = [after.id];
  let guard = 0;
  while (queue.length && guard++ < 10_000) {
    const next: string[] = [];
    for (const p of queue) {
      for (const sid of succsOf(p, deps)) {
        const s = byId.get(sid);
        if (!movable(s) || sid === after.id) continue;
        let need: number;
        if (mode === "keep") {
          need = delay;
        } else {
          const pe = endOf(p);
          if (!pe) continue;
          need = Math.max(0, diffDays(s.plan_start!, addDays(pe, 1)));
        }
        const cur = shift.get(sid)?.days ?? 0;
        if (need > cur) {
          shift.set(sid, { days: need, via: p });
          next.push(sid);
        }
      }
    }
    queue = next;
  }

  const items: ShiftItem[] = [];
  for (const [sid, { days, via }] of shift) {
    const s = byId.get(sid)!;
    if (days <= 0) continue;
    items.push({
      stage: s,
      days,
      plan_start: addDays(s.plan_start!, days),
      plan_end: addDays(s.plan_end!, days),
      expected_end: s.expected_end ? addDays(s.expected_end, days) : null,
      locked: !!s.cal_linked && s.cal_follow !== false,
      via: byId.get(via)?.name ?? "",
    });
  }
  items.sort((a, b) => a.plan_start.localeCompare(b.plan_start) || a.stage.sort_order - b.stage.sort_order);
  return { delay, items };
}
