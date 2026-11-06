import { NextResponse } from "next/server";
import { checkWebhookKey, fromJiraWebhook, ingest, noteWebhook, webhookKey } from "@/lib/atlassian/server";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/**
 * 지라 자동화(Automation) → 웹 요청 보내기
 * 헤더 X-NPD-Key: (Netlify 환경변수 ATLASSIAN_WEBHOOK_SECRET, 없으면 CRON_SECRET 값)
 * 본문: { key, url, summary, status, assignee, duedate, description, comment }
 */
export async function POST(req: Request) {
  const want = webhookKey();
  const got = req.headers.get("x-npd-key") ?? new URL(req.url).searchParams.get("key");
  if (!want) return NextResponse.json({ error: "서버에 ATLASSIAN_WEBHOOK_SECRET(또는 CRON_SECRET)이 설정되지 않았습니다" }, { status: 500 });
  const chk = checkWebhookKey(got);
  if (!chk.ok) return NextResponse.json({ error: "X-NPD-Key 값이 맞지 않습니다", hint: chk.hint }, { status: 401 });
  try {
    const raw = await req.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "JSON 형식이 아닙니다. 자동화 규칙의 웹 요청 본문을 확인하세요.", received: raw.slice(0, 300) }, { status: 400 });
    }
    const item = fromJiraWebhook(body);
    if (!item) return NextResponse.json({ error: "key(이슈 키)가 없습니다" }, { status: 400 });
    const r = await ingest(item);
    await noteWebhook(item, r);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e) }, { status: 500 });
  }
}
