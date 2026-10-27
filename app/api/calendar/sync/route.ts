import { NextResponse } from "next/server";
import { authorize, fail, syncSource } from "@/lib/calendar/server";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** 캘린더 하나 읽기: { sourceId } */
export async function POST(req: Request) {
  const a = await authorize(req);
  if (!a.ok) return a.res;
  try {
    const { sourceId } = await req.json();
    if (!sourceId) return NextResponse.json({ error: "sourceId 필요" }, { status: 400 });
    return NextResponse.json(await syncSource(String(sourceId)));
  } catch (e) {
    return fail(e);
  }
}
