import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 서버 전용 관리자 키 클라이언트 (캘린더 동기화용).
 * 키는 Netlify 환경변수 SUPABASE_SERVICE_ROLE_KEY 에만 넣고, 화면 코드에는 절대 쓰지 않음.
 */
export function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("서버 환경변수 SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다 (Netlify 환경변수 확인)");
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
