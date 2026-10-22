import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Snack Express Dashboard",
  description: "스낵 익스프레스 로봇 조종 대시보드",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
