import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

// 이메일 링크 / 구글 로그인 후 돌아오는 곳
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  if (code) {
    const sb = await supabaseServer();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    if (!error) {
      // 로그인 전에 열려던 주소가 있으면 그리로
      const raw = request.headers.get("cookie")?.match(/(?:^|;\s*)npd-next=([^;]+)/)?.[1];
      let next = "/";
      try {
        const v = raw ? decodeURIComponent(raw) : "";
        if (v.startsWith("/") && !v.startsWith("//")) next = v;
      } catch {
        /* 무시 */
      }
      const res = NextResponse.redirect(`${origin}${next}`);
      res.cookies.set("npd-next", "", { path: "/", maxAge: 0 });
      return res;
    }
  }
  return NextResponse.redirect(`${origin}/login?error=1`);
}
