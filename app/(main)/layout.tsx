"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AppProvider, displayName, useApp } from "@/components/AppProvider";
import { supabase } from "@/lib/supabase/client";
import { TourProvider, useTour } from "@/components/Tour";

function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading } = useApp();
  const { openMenu } = useTour();
  const path = usePathname();
  const router = useRouter();

  async function logout() {
    await supabase().auth.signOut();
    router.replace("/login");
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center text-sm text-slate-400">불러오는 중…</div>;
  }

  if (!me) {
    return (
      <div className="grid min-h-screen place-items-center p-4 text-center text-sm">
        <div className="space-y-3">
          <p>프로필을 찾을 수 없습니다. 다시 로그인해 주세요.</p>
          <button className="btn-outline" onClick={logout}>
            로그인 화면으로
          </button>
        </div>
      </div>
    );
  }

  if (!me.approved) {
    return (
      <div className="grid min-h-screen place-items-center p-4">
        <div className="card max-w-sm space-y-3 p-6 text-center text-sm">
          <div className="text-2xl">⏳</div>
          <p className="font-semibold">승인 대기 중입니다</p>
          <p className="text-slate-600">
            <b>{me.email}</b> 계정이 등록되었습니다.
            <br />
            게임파트 관리자에게 승인을 요청해 주세요.
          </p>
          <button className="btn-ghost" onClick={logout}>
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  const nav = [
    { href: "/", label: "대시보드" },
    { href: "/departments", label: "부서별 일정" },
    { href: "/templates", label: "템플릿" },
    ...(me.is_admin ? [{ href: "/admin", label: "사용자 관리" }] : []),
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-black/[0.06] bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-xs font-bold text-white">R</span>
            <span className="text-sm font-semibold">게임파트 NPD</span>
          </Link>
          <nav className="flex gap-1" data-tour="nav">
            {nav.map((n) => {
              const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-2.5 py-1.5 text-sm ${
                    active ? "bg-black/[0.06] font-medium text-ink" : "text-slate-500 hover:text-ink"
                  }`}
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            <button
              data-tour="help-btn"
              onClick={openMenu}
              className="flex items-center gap-1.5 rounded-md border border-black/10 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-brand-500 hover:text-brand-600"
            >
              <span className="grid h-4 w-4 place-items-center rounded-full bg-brand-500 text-[10px] font-bold text-white">?</span>
              튜토리얼
            </button>
            <Link href="/settings" className="hidden items-center gap-2 rounded-md px-2 py-1 hover:bg-black/5 sm:flex">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-slate-200 text-[11px] font-semibold text-slate-600">
                {displayName(me).slice(0, 1)}
              </span>
              <span className="text-slate-700">{displayName(me)}</span>
              {me.department && <span className="text-xs text-slate-400">{me.department}</span>}
            </Link>
            <button className="btn-ghost text-slate-500" onClick={logout}>
              로그아웃
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <TourProvider>
        <Shell>{children}</Shell>
      </TourProvider>
    </AppProvider>
  );
}
