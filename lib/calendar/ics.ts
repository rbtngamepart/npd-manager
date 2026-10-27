// 구글 캘린더 iCal(.ics) → 말머리가 붙은 일정만 꺼내기 (서버에서만 사용)
import ICAL from "ical.js";
import { hasTag, normTag, parseDesc, parseTitle } from "./text";

export interface CalEvent {
  key: string;
  uid: string;
  tag: string;
  tag_norm: string;
  stage_name: string;
  detail: string | null;
  title: string;
  start_date: string; // YYYY-MM-DD (한국 날짜)
  end_date: string; // 마지막 날 (포함)
  start_at: string | null;
  all_day: boolean;
  done: boolean;
  organizer: string | null;
  attendees: string[];
  desc_owner: string | null;
  desc_related: string[];
  desc_roles: Record<string, string>;
}

const TZ = "Asia/Seoul";
const DAY = 86_400_000;

function seoulDate(d: Date): string {
  return d.toLocaleDateString("sv-SE", { timeZone: TZ });
}

function addDaysStr(s: string, n: number): string {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

function email(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.replace(/^mailto:/i, "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** 긴 줄 이어 붙이기(RFC5545 folding) 후 VEVENT 블록 중 말머리 있는 것만 남김 → 빠르고 개인 일정은 아예 읽지 않음 */
export function prefilter(raw: string): { text: string; total: number; tagged: number } {
  const unfolded = raw.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);
  const head: string[] = [];
  const keep: string[] = [];
  let block: string[] | null = null;
  let inTz = false;
  let total = 0;
  let tagged = 0;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      block = [line];
      continue;
    }
    if (block) {
      block.push(line);
      if (line === "END:VEVENT") {
        total++;
        const summary = block.find((l) => /^SUMMARY[;:]/.test(l));
        const value = summary ? summary.slice(summary.indexOf(":") + 1).replace(/\\,/g, ",").replace(/\\;/g, ";") : "";
        if (value && hasTag(value)) {
          tagged++;
          keep.push(...block);
        }
        block = null;
      }
      continue;
    }
    if (line === "BEGIN:VTIMEZONE") inTz = true;
    if (inTz || /^(BEGIN|END):VCALENDAR$|^VERSION:|^PRODID:|^CALSCALE:/.test(line)) head.push(line);
    if (line === "END:VTIMEZONE") inTz = false;
  }
  const endIdx = head.lastIndexOf("END:VCALENDAR");
  if (endIdx >= 0) head.splice(endIdx, 1);
  if (!head.includes("BEGIN:VCALENDAR")) head.unshift("BEGIN:VCALENDAR", "VERSION:2.0");
  return { text: [...head, ...keep, "END:VCALENDAR"].join("\r\n"), total, tagged };
}

/** ICS 원문 → 말머리 일정 목록 (반복 일정은 기간 안에서 펼침) */
export function parseCalendar(raw: string, today: string, windowDays = 400): { events: CalEvent[]; total: number } {
  const { text, total, tagged } = prefilter(raw);
  if (!tagged) return { events: [], total };

  const comp = new ICAL.Component(ICAL.parse(text));
  for (const tz of comp.getAllSubcomponents("vtimezone")) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      /* 중복 등록 무시 */
    }
  }

  const from = addDaysStr(today, -windowDays);
  const to = addDaysStr(today, windowDays);

  // UID별 원본 + 예외(특정 회차만 바뀐 일정)
  const masters = new Map<string, InstanceType<typeof ICAL.Event>>();
  const exceptions: InstanceType<typeof ICAL.Event>[] = [];
  for (const v of comp.getAllSubcomponents("vevent")) {
    const ev = new ICAL.Event(v);
    if (ev.isRecurrenceException()) exceptions.push(ev);
    else masters.set(ev.uid, ev);
  }
  for (const ex of exceptions) {
    const m = masters.get(ex.uid);
    if (m) m.relateException(ex);
    else masters.set(`${ex.uid}#${ex.recurrenceId?.toString()}`, ex);
  }

  const out: CalEvent[] = [];
  const push = (item: InstanceType<typeof ICAL.Event>, start: InstanceType<typeof ICAL.Time>, end: InstanceType<typeof ICAL.Time>, instanceKey: string) => {
    const status = String(item.component.getFirstPropertyValue("status") ?? "").toUpperCase();
    if (status === "CANCELLED") return;
    const p = parseTitle(item.summary);
    if (!p) return;
    const allDay = start.isDate;
    let sd: string;
    let ed: string;
    let startAt: string | null = null;
    if (allDay) {
      sd = start.toString().slice(0, 10);
      // 종일 일정의 끝 날짜는 '다음 날'로 들어 있음 → 하루 빼기
      ed = end ? addDaysStr(end.toString().slice(0, 10), -1) : sd;
      if (ed < sd) ed = sd;
    } else {
      const js = start.toJSDate();
      sd = seoulDate(js);
      startAt = js.toISOString();
      const je = end ? end.toJSDate() : js;
      // 자정에 끝나는 일정은 전날까지로
      ed = seoulDate(new Date(je.getTime() - 1));
      if (ed < sd) ed = sd;
    }
    if (ed < from || sd > to) return;
    const desc = parseDesc(item.description);
    const attendees = item.component
      .getAllProperties("attendee")
      .map((a) => email(a.getFirstValue()))
      .filter(Boolean) as string[];
    out.push({
      key: `${item.uid}|${instanceKey}`,
      uid: item.uid,
      tag: p.tag,
      tag_norm: normTag(p.tag),
      stage_name: p.stage,
      detail: p.detail,
      title: item.summary,
      start_date: sd,
      end_date: ed,
      start_at: startAt,
      all_day: allDay,
      done: p.done,
      organizer: email(item.component.getFirstPropertyValue("organizer")),
      attendees: Array.from(new Set(attendees)),
      desc_owner: desc.owner,
      desc_related: desc.related,
      desc_roles: desc.roles,
    });
  };

  for (const ev of masters.values()) {
    try {
      if (ev.isRecurring()) {
        const it = ev.iterator();
        let next: InstanceType<typeof ICAL.Time> | null;
        let guard = 0;
        while ((next = it.next()) && guard++ < 1000) {
          const d = next.toString().slice(0, 10);
          if (d > to) break;
          const det = ev.getOccurrenceDetails(next);
          if (det.endDate.toString().slice(0, 10) < from) continue;
          push(det.item, det.startDate, det.endDate, next.toString());
        }
      } else {
        push(ev, ev.startDate, ev.endDate, ev.recurrenceId ? ev.recurrenceId.toString() : "single");
      }
    } catch {
      /* 형식이 이상한 일정 하나 때문에 전체가 멈추지 않게 */
    }
  }
  return { events: out, total };
}
