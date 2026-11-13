import { NextResponse } from "next/server";
import { authorize } from "@/lib/calendar/server";
import { postSlack } from "@/lib/atlassian/slack";

export const dynamic = "force-dynamic";

/** 슬랙 연결 확인용 시험 메시지 */
export async function POST(req: Request) {
  const a = await authorize(req);
  if (!a.ok) return a.res;
  const r = await postSlack(":white_check_mark: *NPD 슬랙 알림 연결 확인* — 이 채널로 'NPD 업데이트 요청'이 옵니다.");
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
