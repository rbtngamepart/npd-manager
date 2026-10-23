import { datesToWeeks, weeksToDates } from "./dates";
import type { Stage, TemplateStage } from "./types";

/** 템플릿 단계 → 프로젝트 단계 행. 시작주차가 비어 있으면 앞 단계 다음 주차로 이어 붙임 */
export function instantiate(tpl: TemplateStage[], projectId: string, projectStart: string | null) {
  let cursor = 1;
  return tpl.map((t, i) => {
    const startWeek = t.start_week ?? cursor;
    let plan_start: string | null = null;
    let plan_end: string | null = null;
    if (projectStart && t.weeks && t.weeks > 0) {
      const d = weeksToDates(projectStart, startWeek, t.weeks);
      plan_start = d.start;
      plan_end = d.end;
      cursor = Math.max(cursor, startWeek + t.weeks);
    }
    return {
      project_id: projectId,
      sort_order: i,
      name: t.name,
      department: t.department ?? null,
      description: t.description ?? null,
      plan_start,
      plan_end,
      skipped: !!t.skipped,
    };
  });
}

/** 프로젝트 단계 → 템플릿 단계 */
export function toTemplate(stages: Stage[], projectStart: string | null): TemplateStage[] {
  return stages.map((s) => {
    let start_week: number | null = null;
    let weeks: number | null = null;
    if (projectStart && s.plan_start && s.plan_end) {
      const w = datesToWeeks(projectStart, s.plan_start, s.plan_end);
      start_week = w.startWeek;
      weeks = w.weeks;
    }
    return {
      name: s.name,
      department: s.department,
      description: s.description,
      start_week,
      weeks,
      skipped: s.skipped || undefined,
    };
  });
}
