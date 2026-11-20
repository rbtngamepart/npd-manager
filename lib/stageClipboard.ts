// 단계 복사·붙여넣기: 단계 + 하위 단계 + 체크리스트 + 파일·링크
//   브라우저에 보관(다른 프로젝트·탭에서도 붙여넣기) + 시스템 클립보드에는 요약 글자
import type { Project, Stage, StageCheck, StageLink } from "./types";

export const CLIP_MIME = "application/x-npd-stages";
const KEY = "npd-stage-clip";
export const CLIP_EVENT = "npd-stage-clip";

export interface ClipStage {
  key: string;
  parent: string | null;
  fields: Partial<Stage>;
  checks: string[];
  links: { title: string | null; url: string }[];
}
export interface StageClip {
  v: 1;
  at: number;
  projectId: string;
  projectName: string;
  projectStart: string | null;
  summary: string;
  rootName: string;
  stages: ClipStage[];
}

/** 새 단계로 옮길 칸 (실적·진행률·판단·이슈는 빼고 '계획'만) */
const COPY_FIELDS: (keyof Stage)[] = [
  "name",
  "department",
  "related_departments",
  "dept_roles",
  "description",
  "description_html",
  "label_ids",
  "assignee",
  "skipped",
  "plan_start",
  "plan_end",
];

export function buildClip(root: Stage | Stage[], project: Project, stages: Stage[], checks: StageCheck[] | null, links: StageLink[] | null): StageClip {
  // 여러 개면: 고른 단계의 상위가 함께 골라졌으면 그 아래로 같이 복사되므로 뺌
  const picked = Array.isArray(root) ? root : [root];
  const ids = new Set(picked.map((s) => s.id));
  const byId = new Map(stages.map((s) => [s.id, s]));
  const hasPickedAncestor = (s: Stage) => {
    let p = s.parent_id ? byId.get(s.parent_id) : undefined;
    for (let i = 0; p && i < 50; i++) {
      if (ids.has(p.id)) return true;
      p = p.parent_id ? byId.get(p.parent_id) : undefined;
    }
    return false;
  };
  const roots = picked.filter((s) => !hasPickedAncestor(s));
  const kids: Record<string, Stage[]> = {};
  stages.forEach((s) => s.parent_id && (kids[s.parent_id] ??= []).push(s));
  const out: ClipStage[] = [];
  const walk = (s: Stage, parent: string | null, depth: number) => {
    const fields: Partial<Stage> = {};
    COPY_FIELDS.forEach((k) => {
      if (k in s) (fields as Record<string, unknown>)[k] = s[k];
    });
    out.push({
      key: s.id,
      parent,
      fields,
      checks: (checks ?? []).filter((c) => c.stage_id === s.id).sort((a, b) => a.sort_order - b.sort_order).map((c) => c.body),
      links: (links ?? []).filter((l) => l.stage_id === s.id).sort((a, b) => a.sort_order - b.sort_order).map((l) => ({ title: l.title, url: l.url })),
    });
    if (depth < 30) (kids[s.id] ?? []).sort((a, b) => a.sort_order - b.sort_order).forEach((k) => walk(k, s.id, depth + 1));
  };
  roots.forEach((r) => walk(r, null, 0));
  const first = roots[0];
  const extra = out.length - roots.length;
  const plan = roots.length === 1 && first.plan_start && first.plan_end ? ` · 계획 ${first.plan_start.slice(5).replace("-", "/")}~${first.plan_end.slice(5).replace("-", "/")}` : "";
  return {
    v: 1,
    at: Date.now(),
    projectId: project.id,
    projectName: project.name,
    projectStart: project.start_date,
    rootName: roots.length > 1 ? `${first.name} 외 ${roots.length - 1}개` : first.name,
    summary: `[NPD 단계] ${first.name}${roots.length > 1 ? ` 외 ${roots.length - 1}개` : ""}${extra ? ` (하위 ${extra}개)` : ""}${plan}`,
    stages: out,
  };
}

export function saveClip(c: StageClip) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event(CLIP_EVENT));
}
export function loadClip(): StageClip | null {
  try {
    return parseClip(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}
export function clearClip() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event(CLIP_EVENT));
}
export function parseClip(raw: string | null | undefined): StageClip | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as StageClip;
    return c?.v === 1 && Array.isArray(c.stages) && c.stages.length ? c : null;
  } catch {
    return null;
  }
}

/** 같은 프로젝트에 같은 이름이 있으면 '(복사)'를 붙임 (캘린더 말머리 연결이 헷갈리지 않게) */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const base = name.replace(/\s*\(복사(?: \d+)?\)$/, ""); // 복사본을 또 복사하면 (복사 2)
  let n = `${base} (복사)`;
  for (let i = 2; taken.has(n); i++) n = `${base} (복사 ${i})`;
  return n;
}
