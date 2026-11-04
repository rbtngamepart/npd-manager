// 지라·컨플루언스 글에서 NPD 단계 코드(NPD-K7Q2M)와 결정·이슈 줄을 찾음

export const CODE_RE = /NPD-[2-9A-HJKMNP-Z]{5}/g;

export function findCodes(text: string): string[] {
  return Array.from(new Set((text.toUpperCase().match(CODE_RE) ?? []).map((c) => c.toUpperCase())));
}

export type LineKind = "decision" | "issue" | null;

const LEAD = /^[\s\-*•▶>|☐☑✅\[\]()\d.]*/;
const DECISION = /^(?:결정\s*사항|결정|합의|decision)\s*[:：\]-]\s*/i;
const ISSUE = /^(?:이슈|리스크|문제|위험|issue|risk|blocker)\s*[:：\]-]\s*/i;

const stripCodes = (line: string) => line.replace(/\[?NPD-[2-9A-HJKMNP-Z]{5}\]?/gi, " ").replace(/\s{2,}/g, " ");

export function lineKind(line: string): LineKind {
  const t = stripCodes(line).replace(LEAD, "");
  if (DECISION.test(t)) return "decision";
  if (ISSUE.test(t)) return "issue";
  return null;
}

/** '결정:' '이슈:' 머리말과 코드를 뗀 본문 */
export function markedText(line: string): string {
  return stripCodes(line).replace(LEAD, "").replace(DECISION, "").replace(ISSUE, "").replace(/[\s|]+$/, "").trim();
}

export interface Mention {
  code: string;
  /** 코드가 들어 있는 줄들 (앞뒤 공백 정리) */
  lines: string[];
  /** '결정:' '이슈:' 로 시작하는 줄 */
  marked: { kind: "decision" | "issue"; text: string }[];
}

/** 글 전체에서 코드별로 언급 줄 모으기. 제목에 있는 코드는 줄 없이 언급만 */
export function findMentions(title: string, text: string): Mention[] {
  const out = new Map<string, Mention>();
  const get = (code: string) => {
    let m = out.get(code);
    if (!m) out.set(code, (m = { code, lines: [], marked: [] }));
    return m;
  };
  findCodes(title).forEach(get);
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const codes = findCodes(line);
    if (!codes.length) return;
    for (const code of codes) {
      const m = get(code);
      if (m.lines.length < 5 && !m.lines.includes(line)) m.lines.push(line);
      const k = lineKind(line);
      // 코드만 있는 줄이면 바로 다음 줄을 본문으로
      const bare = line.replace(CODE_RE, "").replace(/[\s[\]()·:：-]+/g, "") === "";
      const body = bare && lines[i + 1] ? lines[i + 1] : line;
      const kk = k ?? (bare && lines[i + 1] ? lineKind(lines[i + 1]) : null);
      if (kk && m.marked.length < 20) m.marked.push({ kind: kk, text: markedText(body) });
    }
  });
  return Array.from(out.values());
}

/** 줄에서 코드·머리표 정리 */
export function cleanLine(line: string): string {
  return line
    .replace(/\[?NPD-[2-9A-HJKMNP-Z]{5}\]?/gi, "")
    .replace(/^\s*[-*•▶>]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** 지라 ADF(설명·댓글 JSON) → 글자 */
export function adfToText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const n = node as { type?: string; text?: string; content?: unknown[]; attrs?: { text?: string; shortName?: string; url?: string } };
  if (n.type === "text") return n.text ?? "";
  if (n.type === "hardBreak") return "\n";
  if (n.type === "mention") return n.attrs?.text ?? "";
  if (n.type === "emoji") return n.attrs?.shortName ?? "";
  if (n.type === "inlineCard" || n.type === "blockCard") return n.attrs?.url ?? "";
  const inner = (n.content ?? []).map(adfToText).join("");
  const block = ["paragraph", "heading", "listItem", "blockquote", "codeBlock", "tableRow", "taskItem", "decisionItem", "rule"];
  if (n.type === "decisionItem") return `결정: ${inner}\n`;
  if (n.type === "taskItem") return `- ${inner}\n`;
  return block.includes(n.type ?? "") ? `${inner}\n` : inner;
}

/** 컨플루언스 저장 형식(XHTML) → 줄 단위 글자 */
export function storageToText(html: string): string {
  return html
    .replace(/<ac:task-body>/gi, "\n- ")
    .replace(/<ri:user[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|pre|ac:task)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

/** 짧은 해시 (같은 줄은 같은 기록으로) */
export function shortHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
