import type { Metadata, Viewport } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { ObservabilityProvider } from "./observability-provider";

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "아몬드영 결제",
  description: "아몬드영 주문 결제",
};

// interactiveWidget: 키보드가 올라올 때 레이아웃 뷰포트를 «줄인다». 이게 없으면 하단 고정
// CTA 가 키보드 뒤로 숨는다 (Chrome Android 기준. iOS Safari 는 아직 이 힌트를 안 읽는다).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className={`${geistMono.variable} antialiased`}>
        <ObservabilityProvider />
        {children}
      </body>
    </html>
  );
}
