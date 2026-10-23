"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const google = process.env.NEXT_PUBLIC_ENABLE_GOOGLE === "true";

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await supabase().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  async function signInGoogle() {
    await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">R</span>
          <div>
            <div className="text-sm font-semibold">게임파트 NPD</div>
            <div className="text-xs text-slate-500">프로젝트 일정·진행 관리</div>
          </div>
        </div>

        <div className="card p-5">
          {sent ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">메일을 확인해 주세요 ✉️</p>
              <p className="text-slate-600">
                <b>{email}</b> 로 로그인 링크를 보냈습니다. 링크를 누르면 바로 들어와집니다.
              </p>
              <button className="btn-ghost -ml-3" onClick={() => setSent(false)}>
                다른 이메일로 받기
              </button>
            </div>
          ) : (
            <>
              {google && (
                <>
                  <button onClick={signInGoogle} className="btn-outline w-full py-2">
                    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
                      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
                      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
                    </svg>
                    Google 계정으로 로그인
                  </button>
                  <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
                    <div className="h-px flex-1 bg-slate-200" />
                    또는
                    <div className="h-px flex-1 bg-slate-200" />
                  </div>
                </>
              )}
              <form onSubmit={sendLink} className="space-y-3">
                <div>
                  <label className="label">회사 이메일</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    placeholder="name@company.com"
                  />
                </div>
                <button disabled={busy} className="btn-primary w-full py-2">
                  {busy ? "보내는 중…" : "로그인 링크 받기"}
                </button>
                {err && <p className="text-xs text-rose-600">{err}</p>}
              </form>
            </>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-slate-400">
          초대받은 메일로 로그인하면 바로 사용할 수 있습니다.
          <br />
          초대받지 않았다면 첫 로그인 후 관리자 승인을 기다려 주세요.
        </p>
        <p className="mt-3 flex justify-center gap-3 text-[11px] text-slate-400">
          <a href="/privacy" className="hover:text-ink">
            개인정보처리방침
          </a>
          <a href="/terms" className="hover:text-ink">
            이용약관
          </a>
        </p>
      </div>
    </main>
  );
}
