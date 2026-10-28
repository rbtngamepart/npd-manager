import { NextResponse } from "next/server";
import { fail, pushFromScript } from "@/lib/calendar/server";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** 각자 구글 Apps Script가 말머리 일정을 보내는 곳 (연결 코드로 확인) */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") return NextResponse.json({ error: "JSON 형식이 아닙니다" }, { status: 400 });
    const r = await pushFromScript(body);
    return NextResponse.json(r.json, { status: r.status });
  } catch (e) {
    return fail(e);
  }
}
