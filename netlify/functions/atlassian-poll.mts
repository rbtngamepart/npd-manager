// Netlify 정기 실행: 매시간 컨플루언스(+지라 보조)에서 NPD 단계 코드 수집
// 필요한 환경변수: CRON_SECRET, ATLASSIAN_SITE, ATLASSIAN_EMAIL, ATLASSIAN_API_TOKEN
import type { Config } from "@netlify/functions";

export default async () => {
  const base = process.env.URL;
  const key = process.env.CRON_SECRET;
  if (!base || !key || !process.env.ATLASSIAN_API_TOKEN) {
    console.log("지라·컨플루언스 수집: 환경변수가 없어 건너뜁니다");
    return;
  }
  const r = await fetch(`${base}/api/atlassian/poll`, { method: "POST", headers: { "x-cron-key": key } });
  console.log("atlassian poll", r.status, await r.text());
};

export const config: Config = { schedule: "@hourly" };
