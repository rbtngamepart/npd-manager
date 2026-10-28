// Apps Script가 보내준 일정 → 말머리 일정 목록 (서버에서만 사용)
import { normTag, parseDesc, parseTitle } from "./text";
import type { CalEvent } from "./ics";

/** Apps Script가 보내는 일정 하나 */
export interface ScriptEvent {
  id: string; // iCalUID (여러 사람 캘린더에서 같은 값)
  recurring?: boolean;
  title: string;
  description?: string | null;
  allDay?: boolean;
  start: string; // 종일: YYYY-MM-DD / 시간: ISO
  end: string; // 종일: 다음 날(YYYY-MM-DD, 미포함) / 시간: ISO
  creators?: string[];
  guests?: string[];
}

const TZ = "Asia/Seoul";
const DAY = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const seoulDate = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: TZ });

export function addDaysStr(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

const email = (v: unknown) => {
  if (typeof v !== "string") return null;
  const e = v.replace(/^mailto:/i, "").trim().toLowerCase();
  return e.includes("@") ? e : null;
};

export function isDate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s);
}

export function fromScript(raw: ScriptEvent[]): CalEvent[] {
  const out = new Map<string, CalEvent>();
  for (const r of raw) {
    try {
      if (!r || typeof r.id !== "string" || typeof r.title !== "string") continue;
      const p = parseTitle(r.title);
      if (!p) continue;
      let sd: string;
      let ed: string;
      let startAt: string | null = null;
      if (r.allDay) {
        if (!isDate(r.start)) continue;
        sd = r.start;
        // 종일 일정 끝 날짜는 '다음 날'로 들어옴 → 하루 빼기
        ed = isDate(r.end) ? addDaysStr(r.end, -1) : sd;
      } else {
        const s = new Date(r.start);
        if (isNaN(s.getTime())) continue;
        const e = new Date(r.end);
        sd = seoulDate(s);
        startAt = s.toISOString();
        // 자정에 끝나는 일정은 전날까지로
        ed = isNaN(e.getTime()) ? sd : seoulDate(new Date(e.getTime() - 1));
      }
      if (ed < sd) ed = sd;
      const desc = parseDesc(r.description ?? null);
      const instance = r.recurring ? (r.allDay ? sd : startAt!) : "single";
      const key = `${r.id}|${instance}`;
      const creators = (r.creators ?? []).map(email).filter(Boolean) as string[];
      const guests = (r.guests ?? []).map(email).filter(Boolean) as string[];
      out.set(key, {
        key,
        uid: r.id,
        tag: p.tag,
        tag_norm: normTag(p.tag),
        stage_name: p.stage,
        detail: p.detail,
        title: r.title,
        start_date: sd,
        end_date: ed,
        start_at: startAt,
        all_day: !!r.allDay,
        done: p.done,
        organizer: creators[0] ?? null,
        attendees: Array.from(new Set(guests)),
        desc_owner: desc.owner,
        desc_related: desc.related,
        desc_roles: desc.roles,
      });
    } catch {
      /* 이상한 일정 하나 때문에 전체가 멈추지 않게 */
    }
  }
  return Array.from(out.values());
}
