import type { Stage } from "./types";

/** 기본 부서 목록 (사용하면서 입력한 부서는 자동으로 목록에 추가됨) */
export const DEFAULT_DEPARTMENTS = ["게임파트", "구매물류팀"];

/** 기본 역할 종류 (DB 업데이트 전에도 쓰기 위한 값) */
export const DEFAULT_ROLES = ["주관", "의결", "검토", "협의", "의견 청취", "공유"];

export type DeptRole = "owner" | "related" | null;

/** 이 단계에서 해당 부서의 역할: 담당 / 협업 / 무관 */
export function deptRole(s: Pick<Stage, "department" | "related_departments">, dept: string): DeptRole {
  if (s.department === dept) return "owner";
  if ((s.related_departments ?? []).includes(dept)) return "related";
  return null;
}

/** 관리자 부서 목록(base)을 앞에, 데이터에만 있는 부서명을 뒤에 모음 */
export function collectDepartments(
  stages: Pick<Stage, "department" | "related_departments">[],
  extra: (string | null | undefined)[] = [],
  base: string[] = DEFAULT_DEPARTMENTS
): string[] {
  const set = new Set<string>(base);
  stages.forEach((s) => {
    if (s.department) set.add(s.department.trim());
    (s.related_departments ?? []).forEach((d) => d && set.add(d.trim()));
  });
  extra.forEach((d) => d && set.add(d.trim()));
  return Array.from(set).filter(Boolean);
}

/** "구매물류팀, 디자인팀 / 마케팅" → ["구매물류팀","디자인팀","마케팅"] */
export function splitDepartments(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[,/·;\n]|\s{2,}/)
        .map((x) => x.trim())
        .filter(Boolean)
    )
  );
}

/** 문자열 하나 또는 여러 개를 배열로 */
export function toList(v: string | string[] | null | undefined): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** 고른 부서 중 하나라도 담당/협업이면 true (아무것도 안 골랐으면 true) */
export function matchesDepts(s: Pick<Stage, "department" | "related_departments">, depts: string[]): boolean {
  return depts.length === 0 || depts.some((d) => deptRole(s, d));
}

/** 고른 부서 기준 역할: 하나라도 담당이면 담당, 아니면 협업 */
export function rolesFor(s: Pick<Stage, "department" | "related_departments">, depts: string[]): DeptRole {
  if (depts.some((d) => deptRole(s, d) === "owner")) return "owner";
  if (depts.some((d) => deptRole(s, d) === "related")) return "related";
  return null;
}

type WithRoles = Pick<Stage, "department" | "related_departments" | "dept_roles">;

/** 이 단계에서 부서가 맡은 역할 (지정 안 했으면 null) */
export function roleOf(s: WithRoles, dept: string | null | undefined): string | null {
  if (!dept) return null;
  return (s.dept_roles ?? {})[dept] ?? null;
}

/** 화면 표시용 역할: 지정한 역할, 없으면 '담당'/'협업' */
export function roleLabel(s: WithRoles, dept: string): string | null {
  const r = roleOf(s, dept);
  if (r) return r;
  const k = deptRole(s, dept);
  return k === "owner" ? "담당" : k === "related" ? "협업" : null;
}

/** 담당·연관부서에 남아 있는 부서의 역할만 남김 */
export function cleanRoles(
  roles: Record<string, string> | null | undefined,
  owner: string | null,
  related: string[]
): Record<string, string> {
  const keep = new Set([owner, ...related].filter(Boolean) as string[]);
  return Object.fromEntries(Object.entries(roles ?? {}).filter(([d, r]) => keep.has(d) && r));
}

/** "운영팀(검토)" / "운영팀:검토" / "운영팀" → { dept, role } */
export function parseDeptRole(raw: string): { dept: string; role: string | null } {
  const t = raw.trim();
  const m = t.match(/^(.+?)\s*[(（\[]\s*(.+?)\s*[)）\]]$/) ?? t.match(/^(.+?)\s*[:：]\s*(.+)$/);
  return m ? { dept: m[1].trim(), role: m[2].trim() } : { dept: t, role: null };
}

/** "운영팀(검토), 법무팀" → 부서 목록 + 역할 */
export function parseDeptList(raw: string | null | undefined): { depts: string[]; roles: Record<string, string> } {
  const depts: string[] = [];
  const roles: Record<string, string> = {};
  splitDepartments(raw).forEach((x) => {
    const { dept, role } = parseDeptRole(x);
    if (!dept || depts.includes(dept)) return;
    depts.push(dept);
    if (role) roles[dept] = role;
  });
  return { depts, roles };
}

/** 부서 + 역할을 "운영팀(검토)" 형태로 */
export function deptWithRole(dept: string, role: string | null | undefined): string {
  return role ? `${dept}(${role})` : dept;
}
