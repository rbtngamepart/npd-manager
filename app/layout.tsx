import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "게임파트 NPD",
  description: "레드버튼 게임파트 프로젝트 일정·진행 관리",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
