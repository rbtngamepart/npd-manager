import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { authorize, fail } from "@/lib/calendar/server";

export const dynamic = "force-dynamic";

/** 동기화할 캘린더 id 목록 (주소는 내보내지 않음) */
export async function GET(req: Request) {
  const a = await authorize(req);
  if (!a.ok) return a.res;
  try {
    const { data, error } = await supabaseAdmin().from("calendar_sources").select("id").eq("enabled", true).not("ics_url", "is", null); // Apps Script 연결은 스크립트가 직접 보냄
    if (error) throw error;
    return NextResponse.json({ ids: (data ?? []).map((r) => r.id) });
  } catch (e) {
    return fail(e);
  }
}
