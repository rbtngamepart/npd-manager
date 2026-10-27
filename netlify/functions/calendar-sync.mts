// Netlify 정기 실행: 매시 정각에 구글 캘린더 → NPD 동기화
// 필요한 환경변수: CRON_SECRET (사이트와 같은 값), URL (Netlify가 자동으로 넣어줌)
import type { Config } from "@netlify/functions";

export default async () => {
  const base = process.env.URL;
  const key = process.env.CRON_SECRET;
  if (!base || !key) {
    console.log("CRON_SECRET 환경변수가 없어 캘린더 자동 동기화를 건너뜁니다");
    return;
  }
  const h = { "x-cron-key": key, "content-type": "application/json" };
  const r = await fetch(`${base}/api/calendar/sources`, { headers: h });
  if (!r.ok) return console.log("sources 실패", r.status, await r.text());
  const { ids } = (await r.json()) as { ids: string[] };
  const results = await Promise.allSettled(
    ids.map((id) => fetch(`${base}/api/calendar/sync`, { method: "POST", headers: h, body: JSON.stringify({ sourceId: id }) }).then((x) => x.json()))
  );
  const a = await fetch(`${base}/api/calendar/apply`, { method: "POST", headers: h });
  console.log("calendar sync", JSON.stringify({ sources: results.map((x) => (x.status === "fulfilled" ? x.value : String(x.reason))), apply: await a.json() }));
};

export const config: Config = { schedule: "@hourly" };
