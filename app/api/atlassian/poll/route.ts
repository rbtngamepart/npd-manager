import { NextResponse } from "next/server";
import { authorize, fail } from "@/lib/calendar/server";
import { pollConfigured, pollConfluence, pollJira } from "@/lib/atlassian/server";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** 컨플루언스(+지라 보조) 정기 수집. 정기 실행(x-cron-key) 또는 로그인 사용자가 호출 */
export async function POST(req: Request) {
  const a = await authorize(req);
  if (!a.ok) return a.res;
  if (!pollConfigured()) return NextResponse.json({ skipped: true, reason: "ATLASSIAN_SITE / ATLASSIAN_EMAIL / ATLASSIAN_API_TOKEN 환경변수가 없습니다" });
  try {
    const [confluence, jira] = await Promise.all([pollConfluence(), pollJira()]);
    return NextResponse.json({ ok: true, confluence, jira });
  } catch (e) {
    return fail(e);
  }
}
