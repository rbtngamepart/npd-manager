import { NextResponse } from "next/server";
import { applySync, authorize, fail } from "@/lib/calendar/server";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** 저장된 일정 → 단계 반영 */
export async function POST(req: Request) {
  const a = await authorize(req);
  if (!a.ok) return a.res;
  try {
    return NextResponse.json(await applySync());
  } catch (e) {
    return fail(e);
  }
}
