import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio Renderer — 텍스트 제거 (Inpainting)",
  description:
    "중국 사입 기성품의 텍스트를 지우고 브랜드 로고를 얹어 최고급 스튜디오 컷으로 재렌더링하는 MVP 툴",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
