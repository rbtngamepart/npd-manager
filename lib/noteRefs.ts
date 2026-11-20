// 저장된 HTML에서 @사람 · [[메모·단계]] 뽑기 (언급 알림, 백링크용)
export interface Refs {
  mentions: string[];
  notes: string[];
  stages: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function extractRefs(html: string | null | undefined): Refs {
  const out: Refs = { mentions: [], notes: [], stages: [] };
  if (!html) return out;
  const add = (list: string[], id: string | null) => id && UUID.test(id) && !list.includes(id) && list.push(id);
  // 브라우저·서버 어디서나 되도록 정규식으로 (속성 순서와 상관없이)
  for (const m of html.matchAll(/<(span|a)\b[^>]*>/gi)) {
    const tag = m[0];
    const type = /data-type="([^"]+)"/.exec(tag)?.[1];
    const id = /data-id="([^"]+)"/.exec(tag)?.[1] ?? null;
    if (type === "mention") add(out.mentions, id);
    else if (type === "ref") {
      const kind = /data-kind="([^"]+)"/.exec(tag)?.[1];
      add(kind === "stage" ? out.stages : out.notes, id);
    }
  }
  return out;
}

/** 새로 언급된 사람만 (알림 보낼 대상) */
export function newMentions(before: string[] | null | undefined, after: string[]): string[] {
  const b = new Set(before ?? []);
  return after.filter((x) => !b.has(x));
}

/** 언급 알림 보내기 (슬랙이 설정돼 있으면). 실패해도 조용히 */
export async function notifyMentions(body: { kind: "note"; id: string; mentioned: string[] } | { kind: "log"; stageId: string; mentioned: string[]; text: string }) {
  if (!body.mentioned.length) return;
  try {
    await fetch("/api/notify/mention", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    /* 무시 */
  }
}
