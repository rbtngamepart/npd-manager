// 단계 그룹(무한 깊이) → 화면에 그릴 줄 목록
import { maxDate, minDate } from "./dates";
import type { Stage, StageGroup } from "./types";

export type Row =
  | { kind: "group"; group: StageGroup; depth: number; stages: Stage[]; collapsed: boolean; childCount: number }
  | { kind: "stage"; stage: Stage; depth: number; no: number };

type Item = { kind: "group"; g: StageGroup } | { kind: "stage"; s: Stage };

/** 같은 부모 안의 그룹·단계를 순서대로 */
export function siblings(parentId: string | null, stages: Stage[], groups: StageGroup[]): Item[] {
  const items: Item[] = [
    ...groups.filter((g) => (g.parent_id ?? null) === parentId).map((g) => ({ kind: "group" as const, g })),
    ...stages.filter((s) => (s.group_id ?? null) === parentId).map((s) => ({ kind: "stage" as const, s })),
  ];
  const ord = (x: Item) => (x.kind === "group" ? x.g.sort_order : x.s.sort_order);
  return items.sort((a, b) => ord(a) - ord(b) || (a.kind === b.kind ? 0 : a.kind === "group" ? -1 : 1));
}

/** 부모가 없어진(지워진) 그룹·단계는 맨 위로 */
export function normalize(stages: Stage[], groups: StageGroup[]) {
  const ids = new Set(groups.map((g) => g.id));
  // 순환(자기 자신의 하위로 들어간 그룹) 방지
  const parentOf = new Map(groups.map((g) => [g.id, g.parent_id && ids.has(g.parent_id) ? g.parent_id : null]));
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let p = parentOf.get(g.id) ?? null;
    while (p) {
      if (seen.has(p)) {
        parentOf.set(g.id, null);
        break;
      }
      seen.add(p);
      p = parentOf.get(p) ?? null;
    }
  }
  return {
    stages: stages.map((s) => (s.group_id && !ids.has(s.group_id) ? { ...s, group_id: null } : s)),
    groups: groups.map((g) => ({ ...g, parent_id: parentOf.get(g.id) ?? null })),
  };
}

/** 그룹과 그 아래 모든 그룹 id */
export function descendantGroupIds(groupId: string, groups: StageGroup[]): Set<string> {
  const out = new Set<string>([groupId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const g of groups) {
      if (g.parent_id && out.has(g.parent_id) && !out.has(g.id)) {
        out.add(g.id);
        grew = true;
      }
    }
  }
  return out;
}

/** 그룹 경로 이름: "개발 › 디자인" */
export function groupPath(groupId: string | null | undefined, groups: StageGroup[]): string {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const names: string[] = [];
  let g = groupId ? byId.get(groupId) : undefined;
  let guard = 0;
  while (g && guard++ < 50) {
    names.unshift(g.name);
    g = g.parent_id ? byId.get(g.parent_id) : undefined;
  }
  return names.join(" › ");
}

/** 들여쓰기된 그룹 선택지 */
export function groupOptions(groups: StageGroup[]): { id: string; name: string; depth: number }[] {
  const { groups: gs } = normalize([], groups);
  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    gs.filter((g) => g.parent_id === parent)
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((g) => {
        out.push({ id: g.id, name: g.name, depth });
        walk(g.id, depth + 1);
      });
  };
  walk(null, 0);
  return out;
}

/**
 * 줄 목록 만들기.
 * visible: 보여줄 단계(필터 적용 후). 필터 중에는 보여줄 단계가 없는 그룹은 숨김.
 */
export function buildRows(
  allStages: Stage[],
  allGroups: StageGroup[],
  visible: Set<string>,
  collapsed: Set<string>,
  showEmptyGroups: boolean
): Row[] {
  const { stages, groups } = normalize(allStages, allGroups);
  const rows: Row[] = [];
  let no = 0;
  const under = (gid: string): Stage[] => {
    const ids = descendantGroupIds(gid, groups);
    return stages.filter((s) => s.group_id && ids.has(s.group_id) && visible.has(s.id));
  };
  const walk = (parent: string | null, depth: number, hidden: boolean) => {
    for (const it of siblings(parent, stages, groups)) {
      if (it.kind === "stage") {
        if (!visible.has(it.s.id)) continue;
        no++;
        if (!hidden) rows.push({ kind: "stage", stage: it.s, depth, no });
      } else {
        const inside = under(it.g.id);
        if (!inside.length && !showEmptyGroups) continue;
        const isCol = collapsed.has(it.g.id);
        if (!hidden) {
          rows.push({
            kind: "group",
            group: it.g,
            depth,
            stages: inside,
            collapsed: isCol,
            childCount: siblings(it.g.id, stages, groups).length,
          });
        }
        walk(it.g.id, depth + 1, hidden || isCol);
      }
    }
  };
  walk(null, 0, false);
  return rows;
}

/** 그룹 요약: 계획 기간·진행률 */
export function groupSpan(stages: Stage[]) {
  const live = stages.filter((s) => !s.skipped);
  const start = minDate(...live.map((s) => s.plan_start));
  const end = maxDate(...live.map((s) => s.plan_end));
  const done = live.filter((s) => s.actual_end).length;
  const progress = live.length ? Math.round(live.reduce((a, s) => a + (s.actual_end ? 100 : s.progress), 0) / live.length) : 0;
  return { start, end, done, total: live.length, progress };
}

/** 위/아래로 옮기기: 같은 부모 안에서 바로 옆 항목과 자리 바꿈. 바꿔야 할 sort_order 목록을 돌려줌 */
export function moveWithinParent(
  target: { kind: "group" | "stage"; id: string },
  dir: -1 | 1,
  stages: Stage[],
  groups: StageGroup[]
): { stages: { id: string; sort_order: number }[]; groups: { id: string; sort_order: number }[] } | null {
  const { stages: ss, groups: gs } = normalize(stages, groups);
  const parent =
    target.kind === "stage" ? ss.find((s) => s.id === target.id)?.group_id ?? null : gs.find((g) => g.id === target.id)?.parent_id ?? null;
  const sib = siblings(parent, ss, gs);
  const i = sib.findIndex((x) => (x.kind === "stage" ? x.s.id : x.g.id) === target.id && x.kind === target.kind);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sib.length) return null;
  [sib[i], sib[j]] = [sib[j], sib[i]];
  const out = { stages: [] as { id: string; sort_order: number }[], groups: [] as { id: string; sort_order: number }[] };
  sib.forEach((x, k) => {
    if (x.kind === "stage" && x.s.sort_order !== k) out.stages.push({ id: x.s.id, sort_order: k });
    if (x.kind === "group" && x.g.sort_order !== k) out.groups.push({ id: x.g.id, sort_order: k });
  });
  return out;
}

/** 부모 안 맨 끝 순서 번호 */
export function nextOrder(parentId: string | null, stages: Stage[], groups: StageGroup[]): number {
  const n = normalize(stages, groups);
  const sib = siblings(parentId, n.stages, n.groups);
  return sib.reduce((m, x) => Math.max(m, x.kind === "stage" ? x.s.sort_order : x.g.sort_order), -1) + 1;
}
