// 단계 트리: 그룹(무한 깊이) + 단계 아래 하위 단계(무한 깊이) → 화면에 그릴 줄 목록
import { maxDate, minDate } from "./dates";
import type { Stage, StageGroup } from "./types";

export type Row =
  | { kind: "group"; group: StageGroup; depth: number; stages: Stage[]; collapsed: boolean; childCount: number }
  | { kind: "stage"; stage: Stage; depth: number; no: number; children: Stage[]; collapsed: boolean };

type Item = { kind: "group"; g: StageGroup } | { kind: "stage"; s: Stage };

/** 부모 자리: "root" | "g:그룹id" | "s:단계id" */
export type Container = string;
export const ROOT = "root";

export function parentKey(x: { kind: "stage"; s: Stage } | { kind: "group"; g: StageGroup }): Container {
  if (x.kind === "stage") return x.s.parent_id ? `s:${x.s.parent_id}` : x.s.group_id ? `g:${x.s.group_id}` : ROOT;
  return x.g.parent_id ? `g:${x.g.parent_id}` : ROOT;
}
const groupKey = (gid: string | null) => (gid ? `g:${gid}` : ROOT);

/** 같은 부모 안의 그룹·단계를 순서대로 */
function itemsIn(key: Container, stages: Stage[], groups: StageGroup[]): Item[] {
  const items: Item[] = [
    ...(key.startsWith("s:") ? [] : groups.filter((g) => parentKey({ kind: "group", g }) === key).map((g) => ({ kind: "group" as const, g }))),
    ...stages.filter((s) => parentKey({ kind: "stage", s }) === key).map((s) => ({ kind: "stage" as const, s })),
  ];
  const ord = (x: Item) => (x.kind === "group" ? x.g.sort_order : x.s.sort_order);
  return items.sort((a, b) => ord(a) - ord(b) || (a.kind === b.kind ? 0 : a.kind === "group" ? -1 : 1));
}

/** (예전 호출용) 그룹 id 기준 */
export function siblings(parentGroupId: string | null, stages: Stage[], groups: StageGroup[]): Item[] {
  return itemsIn(groupKey(parentGroupId), stages, groups);
}

/** 부모가 없어진(지워진) 그룹·단계는 위로, 순환은 끊음 */
export function normalize(stages: Stage[], groups: StageGroup[]) {
  const gids = new Set(groups.map((g) => g.id));
  const gParent = new Map(groups.map((g) => [g.id, g.parent_id && gids.has(g.parent_id) ? g.parent_id : null]));
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let p = gParent.get(g.id) ?? null;
    while (p) {
      if (seen.has(p)) {
        gParent.set(g.id, null);
        break;
      }
      seen.add(p);
      p = gParent.get(p) ?? null;
    }
  }
  const sids = new Set(stages.map((s) => s.id));
  const sParent = new Map(stages.map((s) => [s.id, s.parent_id && sids.has(s.parent_id) ? s.parent_id : null]));
  for (const s of stages) {
    const seen = new Set<string>([s.id]);
    let p = sParent.get(s.id) ?? null;
    while (p) {
      if (seen.has(p)) {
        sParent.set(s.id, null);
        break;
      }
      seen.add(p);
      p = sParent.get(p) ?? null;
    }
  }
  return {
    stages: stages.map((s) => {
      const parent_id = sParent.get(s.id) ?? null;
      const group_id = s.group_id && gids.has(s.group_id) ? s.group_id : null;
      return parent_id === (s.parent_id ?? null) && group_id === (s.group_id ?? null) ? s : { ...s, parent_id, group_id };
    }),
    groups: groups.map((g) => ({ ...g, parent_id: gParent.get(g.id) ?? null })),
  };
}

/** 하위 단계까지 따라 올라가서 실제로 속한 그룹 */
export function effectiveGroup(s: Stage, stages: Stage[]): string | null {
  const byId = new Map(stages.map((x) => [x.id, x]));
  let cur: Stage | undefined = s;
  let guard = 0;
  while (cur?.parent_id && guard++ < 100) {
    const p = byId.get(cur.parent_id);
    if (!p) break;
    cur = p;
  }
  return cur?.group_id ?? null;
}

/** 단계 아래 모든 하위 단계 */
export function stageDescendants(id: string, stages: Stage[]): Stage[] {
  const out: Stage[] = [];
  const seen = new Set([id]);
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const s of stages) {
      if (s.parent_id && frontier.includes(s.parent_id) && !seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
        next.push(s.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** 상위 단계 경로: "공모전 진행 › 접수" */
export function stagePath(s: Stage, stages: Stage[]): string {
  const byId = new Map(stages.map((x) => [x.id, x]));
  const names: string[] = [];
  let p = s.parent_id ? byId.get(s.parent_id) : undefined;
  let guard = 0;
  while (p && guard++ < 50) {
    names.unshift(p.name);
    p = p.parent_id ? byId.get(p.parent_id) : undefined;
  }
  return names.join(" › ");
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
 * visible: 보여줄 단계(필터 적용 후). 상위 단계는 하위 단계가 보이면 같이 보임.
 * collapsed: 접은 그룹·단계 id
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
  const descOf = new Map<string, Stage[]>();
  const desc = (id: string) => {
    let d = descOf.get(id);
    if (!d) descOf.set(id, (d = stageDescendants(id, stages)));
    return d;
  };
  const stageShown = (s: Stage) => visible.has(s.id) || desc(s.id).some((x) => visible.has(x.id));
  const inGroup = (gid: string): Stage[] => {
    const ids = descendantGroupIds(gid, groups);
    return stages.filter((s) => {
      const g = effectiveGroup(s, stages);
      return g && ids.has(g) && visible.has(s.id);
    });
  };
  const walk = (key: Container, depth: number, hidden: boolean) => {
    for (const it of itemsIn(key, stages, groups)) {
      if (it.kind === "stage") {
        if (!stageShown(it.s)) continue;
        no++;
        const kids = desc(it.s.id).filter((x) => visible.has(x.id));
        const isCol = collapsed.has(it.s.id);
        if (!hidden) rows.push({ kind: "stage", stage: it.s, depth, no, children: kids, collapsed: isCol });
        walk(`s:${it.s.id}`, depth + 1, hidden || isCol);
      } else {
        const inside = inGroup(it.g.id);
        if (!inside.length && !showEmptyGroups) continue;
        const isCol = collapsed.has(it.g.id);
        if (!hidden) {
          rows.push({
            kind: "group",
            group: it.g,
            depth,
            stages: inside,
            collapsed: isCol,
            childCount: itemsIn(`g:${it.g.id}`, stages, groups).length,
          });
        }
        walk(`g:${it.g.id}`, depth + 1, hidden || isCol);
      }
    }
  };
  walk(ROOT, 0, false);
  return rows;
}

/** 그룹·상위 단계 요약: 계획 기간·진행률 */
export function groupSpan(stages: Stage[]) {
  const live = stages.filter((s) => !s.skipped);
  const start = minDate(...live.map((s) => s.plan_start));
  const end = maxDate(...live.map((s) => s.plan_end));
  const done = live.filter((s) => s.actual_end).length;
  const progress = live.length ? Math.round(live.reduce((a, s) => a + (s.actual_end ? 100 : s.progress), 0) / live.length) : 0;
  return { start, end, done, total: live.length, progress };
}

export interface OrderPatch {
  stages: { id: string; sort_order: number; parent_id?: string | null; group_id?: string | null }[];
  groups: { id: string; sort_order: number; parent_id?: string | null }[];
}

function renumber(list: Item[], moved?: { kind: "group" | "stage"; id: string; parent: Container; stages: Stage[] }): OrderPatch {
  const out: OrderPatch = { stages: [], groups: [] };
  list.forEach((x, k) => {
    const isMoved = moved && (x.kind === "stage" ? x.s.id : x.g.id) === moved.id && x.kind === moved.kind;
    if (x.kind === "stage") {
      if (isMoved) {
        const p = moved!.parent;
        const parent_id = p.startsWith("s:") ? p.slice(2) : null;
        const group_id = p.startsWith("g:") ? p.slice(2) : parent_id ? effectiveGroup(moved!.stages.find((s) => s.id === parent_id)!, moved!.stages) : null;
        out.stages.push({ id: x.s.id, sort_order: k, parent_id, group_id });
      } else if (x.s.sort_order !== k) out.stages.push({ id: x.s.id, sort_order: k });
    } else {
      if (isMoved) out.groups.push({ id: x.g.id, sort_order: k, parent_id: moved!.parent.startsWith("g:") ? moved!.parent.slice(2) : null });
      else if (x.g.sort_order !== k) out.groups.push({ id: x.g.id, sort_order: k });
    }
  });
  return out;
}

/** 위/아래로 옮기기: 같은 부모 안에서 바로 옆 항목과 자리 바꿈 */
export function moveWithinParent(target: { kind: "group" | "stage"; id: string }, dir: -1 | 1, stages: Stage[], groups: StageGroup[]): OrderPatch | null {
  const { stages: ss, groups: gs } = normalize(stages, groups);
  const self = target.kind === "stage" ? ss.find((s) => s.id === target.id) : gs.find((g) => g.id === target.id);
  if (!self) return null;
  const key = target.kind === "stage" ? parentKey({ kind: "stage", s: self as Stage }) : parentKey({ kind: "group", g: self as StageGroup });
  const sib = itemsIn(key, ss, gs);
  const i = sib.findIndex((x) => (x.kind === "stage" ? x.s.id : x.g.id) === target.id && x.kind === target.kind);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sib.length) return null;
  [sib[i], sib[j]] = [sib[j], sib[i]];
  return renumber(sib);
}

export type DropZone = "before" | "after" | "inside";

/**
 * 끌어서 놓기: drag 항목을 target 의 앞/뒤/안으로.
 * 단계 안에는 단계만, 그룹 안에는 그룹·단계 모두. 자기 아래로는 못 넣음. 안 되면 null
 */
export function dropPlan(
  drag: { kind: "group" | "stage"; id: string },
  target: { kind: "group" | "stage"; id: string },
  zone: DropZone,
  stages: Stage[],
  groups: StageGroup[]
): OrderPatch | null {
  if (drag.kind === target.kind && drag.id === target.id) return null;
  const { stages: ss, groups: gs } = normalize(stages, groups);
  const tItem: Item | null =
    target.kind === "stage"
      ? (() => {
          const s = ss.find((x) => x.id === target.id);
          return s ? { kind: "stage" as const, s } : null;
        })()
      : (() => {
          const g = gs.find((x) => x.id === target.id);
          return g ? { kind: "group" as const, g } : null;
        })();
  if (!tItem) return null;
  const container: Container = zone === "inside" ? `${target.kind === "stage" ? "s" : "g"}:${target.id}` : parentKey(tItem);

  // 그룹은 단계 안에 못 들어감
  if (drag.kind === "group" && container.startsWith("s:")) return null;
  // 자기 자신·자기 아래로는 못 들어감
  if (drag.kind === "stage") {
    const below = new Set([drag.id, ...stageDescendants(drag.id, ss).map((s) => s.id)]);
    if (container.startsWith("s:") && below.has(container.slice(2))) return null;
  } else {
    const below = descendantGroupIds(drag.id, gs);
    if (container.startsWith("g:") && below.has(container.slice(2))) return null;
  }

  const list = itemsIn(container, ss, gs).filter((x) => !(x.kind === drag.kind && (x.kind === "stage" ? x.s.id : x.g.id) === drag.id));
  const dragItem: Item | null =
    drag.kind === "stage"
      ? (() => {
          const s = ss.find((x) => x.id === drag.id);
          return s ? { kind: "stage" as const, s } : null;
        })()
      : (() => {
          const g = gs.find((x) => x.id === drag.id);
          return g ? { kind: "group" as const, g } : null;
        })();
  if (!dragItem) return null;
  let at = list.length;
  if (zone !== "inside") {
    const ti = list.findIndex((x) => x.kind === target.kind && (x.kind === "stage" ? x.s.id : x.g.id) === target.id);
    at = ti < 0 ? list.length : zone === "before" ? ti : ti + 1;
  }
  list.splice(at, 0, dragItem);
  return renumber(list, { kind: drag.kind, id: drag.id, parent: container, stages: ss });
}

/** 부모 안 맨 끝 순서 번호 (그룹 id 또는 null) */
export function nextOrder(parentGroupId: string | null, stages: Stage[], groups: StageGroup[]): number {
  const n = normalize(stages, groups);
  const sib = itemsIn(groupKey(parentGroupId), n.stages, n.groups);
  return sib.reduce((m, x) => Math.max(m, x.kind === "stage" ? x.s.sort_order : x.g.sort_order), -1) + 1;
}
