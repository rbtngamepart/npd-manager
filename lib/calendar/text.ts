// 캘린더 일정 제목·설명에서 프로젝트 말머리, 단계명, 세부, 완료, 부서를 읽는 규칙
import { parseDeptList, parseDeptRole } from "../departments";

/** 말머리 비교용: 소문자 + 공백 제거 */
export function normTag(t: string): string {
  return t.toLowerCase().replace(/\s+/g, "");
}

/** 단계명 비교용 */
export function normName(t: string): string {
  return t.toLowerCase().replace(/[\s·・\-_]+/g, "");
}

const TAG_RE = /^\s*[\[【［]\s*([^\]】］]+?)\s*[\]】］]\s*(.*)$/;
const DONE_RE = /(✅|☑️?|✔️?|[(\[（【]\s*완료\s*[)\]）】])/g;
const SPLIT_RE = /\s+[-–—>/]\s+/;

export interface ParsedTitle {
  tag: string;
  stage: string;
  detail: string | null;
  done: boolean;
}

/**
 * "[OG26] 제품화 검증 - 샘플 견적 ✅"
 *  → { tag: "OG26", stage: "제품화 검증", detail: "샘플 견적", done: true }
 * 말머리가 없으면 null
 */
export function parseTitle(summary: string | null | undefined): ParsedTitle | null {
  if (!summary) return null;
  const m = summary.match(TAG_RE);
  if (!m) return null;
  const tag = m[1].trim();
  if (!tag) return null;
  let rest = m[2] ?? "";
  const done = DONE_RE.test(rest);
  DONE_RE.lastIndex = 0;
  rest = rest.replace(DONE_RE, " ").replace(/\s+/g, " ").trim();
  const parts = rest.split(SPLIT_RE);
  const stage = (parts[0] ?? "").trim() || "기타";
  const detail = parts.length > 1 ? parts.slice(1).join(" - ").trim() || null : null;
  return { tag, stage, detail, done };
}

/** 말머리가 붙은 제목인지 (빠른 검사) */
export function hasTag(summary: string): boolean {
  return TAG_RE.test(summary);
}

export interface ParsedDesc {
  owner: string | null;
  related: string[];
  roles: Record<string, string>;
}

/** 설명란 HTML → 글자 */
export function stripHtml(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 설명란에서
 *   담당: 게임파트(주관)
 *   연관: 운영팀(검토), 경영진(의결)
 * 을 읽음
 */
export function parseDesc(raw: string | null | undefined): ParsedDesc {
  const out: ParsedDesc = { owner: null, related: [], roles: {} };
  const text = stripHtml(raw);
  for (const line of text.split(/\n/)) {
    const m = line.match(/^\s*(담당부서|담당|주관부서|연관부서|연관|협업부서|협업)\s*[:：]\s*(.+)$/);
    if (!m) continue;
    if (m[1].startsWith("담당") || m[1].startsWith("주관")) {
      const { dept, role } = parseDeptRole(m[2]);
      if (dept) {
        out.owner = dept;
        if (role) out.roles[dept] = role;
      }
    } else {
      const { depts, roles } = parseDeptList(m[2]);
      depts.forEach((d) => !out.related.includes(d) && out.related.push(d));
      Object.assign(out.roles, roles);
    }
  }
  if (out.owner) out.related = out.related.filter((d) => d !== out.owner);
  return out;
}
