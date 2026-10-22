import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "리포트 포털",
  description: "믿는구석 광고주 마케팅 리포트",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard 웹폰트 (가변 굵기, 한글 글자 단위 분할 로딩) — 굵기는 globals.css 의 400·500·700 그대로 */}
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
