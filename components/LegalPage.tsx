import Link from "next/link";

export const SERVICE_NAME = "레드버튼 게임파트 NPD";
export const CONTACT_EMAIL = "awayminki@redbutton.co.kr";
export const EFFECTIVE_DATE = "2026년 10월 23일";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10">
      <Link href="/" className="mb-6 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-500 text-xs font-bold text-white">R</span>
        <span className="text-sm font-semibold">{SERVICE_NAME}</span>
      </Link>
      <article className="card space-y-5 p-6 text-sm leading-relaxed text-slate-700 [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-ink [&_li]:ml-5 [&_li]:list-disc">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        <p className="text-xs text-slate-400">시행일: {EFFECTIVE_DATE}</p>
        {children}
      </article>
      <p className="mt-6 flex gap-4 text-xs text-slate-400">
        <Link href="/privacy" className="hover:text-ink">
          개인정보처리방침
        </Link>
        <Link href="/terms" className="hover:text-ink">
          이용약관
        </Link>
        <Link href="/login" className="hover:text-ink">
          로그인
        </Link>
      </p>
    </main>
  );
}
