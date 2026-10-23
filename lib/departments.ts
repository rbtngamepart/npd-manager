import type { Stage } from "./types";

/** 기본 부서 목록 (사용하면서 입력한 부서는 자동으로 목록에 추가됨) */
export const DEFAULT_DEPARTMENTS = ["게임파트", "구매물류팀"];

export type DeptRole = "owner" | "related" | null;

/** 이 단계에서 해당 부서의 역할: 담당 / 협업 / 무관 */
export function deptRole(s: Pick<Stage, "department" | "related_departments">, dept: string): DeptRole {
  if (s.department === dept) return "owner";
  if ((s.related_departments ?? []).includes(dept)) return "related";
  return null;
}

/** 단계들과 사용자 부서에서 부서 이름을 모음 */
export function collectDepartments(
  stages: Pick<Stage, "department" | "related_departments">[],
  extra: (string | null | undefined)[] = []
): string[] {
  const set = new Set<string>(DEFAULT_DEPARTMENTS);
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
