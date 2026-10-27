"use client";
// 화면에서 캘린더 동기화 실행 (캘린더마다 따로 읽고 → 단계 반영)

export interface SyncSummary {
  sources: { id: string; ok: boolean; tagged?: number; error?: string }[];
  apply?: {
    events: number;
    projects: number;
    stagesUpdated: number;
    stagesCreated: number;
    missing: number;
    unmatchedTags: { tag: string; tag_norm: string; count: number }[];
  };
  error?: string;
}

async function post(url: string, body?: unknown) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
}

let running: Promise<SyncSummary> | null = null;

export function runCalendarSync(onlyIds?: string[]): Promise<SyncSummary> {
  if (running) return running;
  running = (async () => {
    const out: SyncSummary = { sources: [] };
    try {
      let ids = onlyIds;
      if (!ids) {
        const r = await fetch("/api/calendar/sources");
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        ids = j.ids as string[];
      }
      let i = 0;
      await Promise.all(
        Array.from({ length: Math.min(3, ids.length) }, async () => {
          while (i < ids!.length) {
            const id = ids![i++];
            try {
              const j = await post("/api/calendar/sync", { sourceId: id });
              out.sources.push({ id, ok: !!j.ok, tagged: j.tagged, error: j.error });
            } catch (e) {
              out.sources.push({ id, ok: false, error: e instanceof Error ? e.message : String(e) });
            }
          }
        })
      );
      out.apply = await post("/api/calendar/apply");
      window.dispatchEvent(new CustomEvent("npd-calendar-synced", { detail: out }));
    } catch (e) {
      out.error = e instanceof Error ? e.message : String(e);
    } finally {
      running = null;
    }
    return out;
  })();
  return running;
}

export function summaryText(s: SyncSummary): string {
  if (s.error) return `동기화 실패: ${s.error}`;
  const failed = s.sources.filter((x) => !x.ok).length;
  const a = s.apply;
  if (!a) return "동기화 완료";
  const parts = [`일정 ${a.events}개`, a.stagesCreated ? `새 단계 ${a.stagesCreated}` : "", a.stagesUpdated ? `단계 갱신 ${a.stagesUpdated}` : ""].filter(Boolean);
  if (a.unmatchedTags.length) parts.push(`대기함 ${a.unmatchedTags.length}`);
  if (failed) parts.push(`읽기 실패 캘린더 ${failed}`);
  return `📅 동기화 완료 · ${parts.join(" · ")}`;
}
