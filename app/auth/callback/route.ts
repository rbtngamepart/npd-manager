import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// 이메일 링크 / 구글 로그인 후 돌아오는 곳
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/`);
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
