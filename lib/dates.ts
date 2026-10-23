// 날짜는 모두 'YYYY-MM-DD' 문자열로 다룹니다 (시간대 문제 방지).

const DAY = 86_400_000;

function toUTC(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUTC(t: number): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): string {
  // 한국 시간 기준 오늘
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

export function addDays(s: string, n: number): string {
  return fromUTC(toUTC(s) + n * DAY);
}

/** b - a (일) */
export function diffDays(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / DAY);
}

export function maxDate(...ds: (string | null | undefined)[]): string | null {
  const v = ds.filter(Boolean) as string[];
  if (!v.length) return null;
  return v.reduce((a, b) => (a > b ? a : b));
}

export function minDate(...ds: (string | null | undefined)[]): string | null {
  const v = ds.filter(Boolean) as string[];
  if (!v.length) return null;
  return v.reduce((a, b) => (a < b ? a : b));
}

/** 주차 + 기간(주) → 날짜. 시트와 동일: 1주차 = 프로젝트 시작일, 기간 2주 = 14일 */
export function weeksToDates(projectStart: string, startWeek: number, weeks: number) {
  const start = addDays(projectStart, (startWeek - 1) * 7);
  const end = addDays(start, Math.max(1, weeks) * 7 - 1);
  return { start, end };
}

/** 날짜 → 주차 + 기간(주) */
export function datesToWeeks(projectStart: string, start: string, end: string) {
  const startWeek = Math.floor(diffDays(projectStart, start) / 7) + 1;
  const weeks = Math.max(1, Math.ceil((diffDays(start, end) + 1) / 7));
  return { startWeek, weeks };
}

export function weekNumber(projectStart: string, date: string): number {
  return Math.floor(diffDays(projectStart, date) / 7) + 1;
}

export function short(s: string | null | undefined): string {
  if (!s) return "-";
  const [, m, d] = s.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function full(s: string | null | undefined): string {
  if (!s) return "-";
  const [y, m, d] = s.split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

export function monthStart(s: string): string {
  return s.slice(0, 8) + "01";
}

export function nextMonth(s: string): string {
  const [y, m] = s.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * 시트에서 붙여넣은 날짜 문자열을 YYYY-MM-DD 로.
 * 지원: 2025-10-02, 2025. 10. 2, 2025/10/2, 25.10.02, 1899-12-30(빈 값 취급)
 */
export function parseLooseDate(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{2,4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return null;
  let y = Number(m[1]);
  if (y < 100) y += 2000;
  if (y < 1950) return null; // 시트의 0 날짜(1899-12-30)
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
}
