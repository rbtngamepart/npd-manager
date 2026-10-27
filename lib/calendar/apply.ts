// 저장된 캘린더 일정 → 프로젝트 단계로 반영 계획 세우기 (순수 함수, 서버에서 실행)
import { normName, normTag } from "./text";

export interface EventRow {
  key: string;
  tag: string;
  tag_norm: string;
  stage_name: string;
  detail: string | null;
  start_date: string;
  end_date: string;
  done: boolean;
  organizer: string | null;
  attendees: string[];
  source_ids: string[];
  desc_owner: string | null;
  desc_related: string[];
  desc_roles: Record<string, string>;
  removed: boolean;
  project_id: string | null;
  stage_id: string | null;
}

export interface ProjectRow {
  id: string;
  name: string;
  calendar_tags: string[] | null;
  archived: boolean;
}

export interface StageRow {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  department: string | null;
  related_departments: string[] | null;
  dept_roles: Record<string, string> | null;
  plan_start: string | null;
  plan_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  progress: number;
  cal_linked: boolean;
  cal_follow: boolean;
  cal_missing: boolean;
}

export interface Plan {
  inserts: (Partial<StageRow> & { _group: string })[];
  updates: { id: string; patch: Partial<StageRow> }[];
  /** 일정 key → 프로젝트·단계 (새 단계는 _group 으로 연결 후 채움) */
  eventLinks: { key: string; project_id: string | null; group: string | null; stage_id: string | null }[];
  unmatchedTags: { tag: string; tag_norm: string; count: number }[];
  stats: { events: number; projects: number; stagesUpdated: number; stagesCreated: number; missing: number };
}

function mostCommon(list: (string | null | undefined)[]): string | null {
  const c = new Map<string, number>();
  list.forEach((x) => x && c.set(x, (c.get(x) ?? 0) + 1));
  let best: string | null = null;
  let n = 0;
  c.forEach((v, k) => {
    if (v > n) {
      best = k;
      n = v;
    }
  });
  return best;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function planSync(input: {
  events: EventRow[];
  projects: ProjectRow[];
  stages: StageRow[];
  /** 이메일(소문자) → 부서 */
  deptByEmail: Record<string, string | null>;
  /** 캘린더 source id → 주인 부서 */
  deptBySource: Record<string, string | null>;
  ignoredTags: string[];
  today: string;
}): Plan {
  const { events, projects, stages, deptByEmail, deptBySource, today } = input;
  const ignored = new Set(input.ignoredTags);

  // 말머리 → 프로젝트 (설정한 말머리, 또는 프로젝트 이름과 같은 말머리)
  const tagMap = new Map<string, string>();
  projects
    .filter((p) => !p.archived)
    .forEach((p) => {
      tagMap.set(normTag(p.name), p.id);
      (p.calendar_tags ?? []).forEach((t) => t && tagMap.set(normTag(t), p.id));
    });

  const live = events.filter((e) => !e.removed);
  const eventLinks: Plan["eventLinks"] = [];
  const unmatched = new Map<string, { tag: string; count: number }>();
  const groups = new Map<string, { project_id: string; name: string; events: EventRow[] }>();

  for (const e of live) {
    const pid = tagMap.get(e.tag_norm) ?? null;
    if (!pid) {
      if (!ignored.has(e.tag_norm)) {
        const u = unmatched.get(e.tag_norm) ?? { tag: e.tag, count: 0 };
        u.count++;
        unmatched.set(e.tag_norm, u);
      }
      eventLinks.push({ key: e.key, project_id: null, group: null, stage_id: null });
      continue;
    }
    const g = `${pid}::${normName(e.stage_name)}`;
    const grp = groups.get(g) ?? { project_id: pid, name: e.stage_name.trim(), events: [] };
    grp.events.push(e);
    groups.set(g, grp);
    eventLinks.push({ key: e.key, project_id: pid, group: g, stage_id: null });
  }
  // 사라진 일정은 연결만 유지
  events.filter((e) => e.removed).forEach((e) => eventLinks.push({ key: e.key, project_id: e.project_id, group: null, stage_id: e.stage_id }));

  const stagesByProject = new Map<string, StageRow[]>();
  stages.forEach((s) => {
    const l = stagesByProject.get(s.project_id) ?? [];
    l.push(s);
    stagesByProject.set(s.project_id, l);
  });

  const inserts: Plan["inserts"] = [];
  const updates: Plan["updates"] = [];
  const groupStage = new Map<string, string>(); // group → 기존 stage id
  const nextOrder = new Map<string, number>();
  const touched = new Set<string>();

  // 새 단계는 시작일 순으로 뒤에 붙임
  const ordered = Array.from(groups.entries()).sort((a, b) => {
    const as = a[1].events.reduce((m, e) => (e.start_date < m ? e.start_date : m), "9999");
    const bs = b[1].events.reduce((m, e) => (e.start_date < m ? e.start_date : m), "9999");
    return as.localeCompare(bs);
  });

  for (const [g, grp] of ordered) {
    const ev = grp.events;
    const planStart = ev.reduce((m, e) => (e.start_date < m ? e.start_date : m), ev[0].start_date);
    const planEnd = ev.reduce((m, e) => (e.end_date > m ? e.end_date : m), ev[0].end_date);
    // 완료: 가장 마지막 일정에 완료 표시(✅)가 있을 때 (중간 회의만 끝난 건 완료 아님)
    const last = ev.reduce((m, e) => (e.end_date > m.end_date || (e.end_date === m.end_date && e.done) ? e : m), ev[0]);
    const actualEnd = last.done ? last.end_date : null;
    const actualStart = planStart <= today ? planStart : null;

    // 부서: 설명란 '담당:' > 일정 만든 사람 부서 > 캘린더 주인 부서
    const owner =
      mostCommon(ev.map((e) => e.desc_owner)) ??
      mostCommon(ev.map((e) => (e.organizer ? deptByEmail[e.organizer] : null))) ??
      mostCommon(ev.flatMap((e) => e.source_ids.map((s) => deptBySource[s])));
    const rel = new Set<string>();
    ev.forEach((e) => {
      e.desc_related.forEach((d) => rel.add(d));
      e.attendees.forEach((a) => deptByEmail[a] && rel.add(deptByEmail[a]!));
      if (e.organizer && deptByEmail[e.organizer]) rel.add(deptByEmail[e.organizer]!);
      e.source_ids.forEach((s) => deptBySource[s] && rel.add(deptBySource[s]!));
    });
    if (owner) rel.delete(owner);
    const roles: Record<string, string> = {};
    ev.forEach((e) => Object.entries(e.desc_roles ?? {}).forEach(([d, r]) => (roles[d] ??= r)));

    const list = stagesByProject.get(grp.project_id) ?? [];
    const n = normName(grp.name);
    const existing = list.find((s) => s.cal_linked && normName(s.name) === n) ?? list.find((s) => normName(s.name) === n);

    if (existing) {
      groupStage.set(g, existing.id);
      touched.add(existing.id);
      const patch: Partial<StageRow> = {};
      if (!existing.cal_linked) patch.cal_linked = true;
      if (existing.cal_missing) patch.cal_missing = false;
      if (existing.cal_follow) {
        if (existing.plan_start !== planStart) patch.plan_start = planStart;
        if (existing.plan_end !== planEnd) patch.plan_end = planEnd;
      }
      if (!existing.actual_start && actualStart) patch.actual_start = actualStart;
      if (!existing.actual_end && actualEnd) {
        patch.actual_end = actualEnd;
        patch.progress = 100;
      }
      // NPD에서 직접 고친 부서는 덮어쓰지 않고, 비어 있으면 채우고, 연관부서·역할은 더하기만
      const dept = existing.department ?? owner;
      if (!existing.department && owner) patch.department = owner;
      const curRel = existing.related_departments ?? [];
      const addRel = Array.from(rel).filter((d) => d !== dept && !curRel.includes(d));
      if (addRel.length) patch.related_departments = [...curRel, ...addRel];
      const curRoles = existing.dept_roles ?? {};
      const addRoles = Object.fromEntries(Object.entries(roles).filter(([d]) => !(d in curRoles)));
      if (Object.keys(addRoles).length) patch.dept_roles = { ...curRoles, ...addRoles };
      if (Object.keys(patch).length) updates.push({ id: existing.id, patch });
    } else {
      const base = nextOrder.get(grp.project_id) ?? list.reduce((m, s) => Math.max(m, s.sort_order), -1) + 1;
      nextOrder.set(grp.project_id, base + 1);
      const relList = Array.from(rel);
      inserts.push({
        _group: g,
        project_id: grp.project_id,
        name: grp.name,
        sort_order: base,
        department: owner,
        related_departments: relList,
        dept_roles: Object.fromEntries(Object.entries(roles).filter(([d]) => d === owner || relList.includes(d))),
        plan_start: planStart,
        plan_end: planEnd,
        actual_start: actualStart,
        actual_end: actualEnd,
        progress: actualEnd ? 100 : 0,
        cal_linked: true,
        cal_follow: true,
        cal_missing: false,
      });
    }
  }

  // 연결돼 있었는데 이번에 일정이 하나도 없는 단계 → '캘린더에서 사라짐'
  let missing = 0;
  stages.forEach((s) => {
    if (s.cal_linked && !touched.has(s.id) && !s.cal_missing) {
      updates.push({ id: s.id, patch: { cal_missing: true } });
      missing++;
    }
  });

  eventLinks.forEach((l) => {
    if (l.group && groupStage.has(l.group)) l.stage_id = groupStage.get(l.group)!;
  });

  return {
    inserts,
    updates: updates.filter((u) => {
      const s = stages.find((x) => x.id === u.id)!;
      return Object.entries(u.patch).some(([k, v]) => !same((s as unknown as Record<string, unknown>)[k], v));
    }),
    eventLinks,
    unmatchedTags: Array.from(unmatched.entries()).map(([tag_norm, v]) => ({ tag: v.tag, tag_norm, count: v.count })),
    stats: {
      events: live.length,
      projects: new Set(Array.from(groups.values()).map((g) => g.project_id)).size,
      stagesUpdated: updates.filter((u) => !("cal_missing" in u.patch && Object.keys(u.patch).length === 1)).length,
      stagesCreated: inserts.length,
      missing,
    },
  };
}
