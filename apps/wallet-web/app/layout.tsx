import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import "./globals.css";
import { ObservabilityProvider } from "./observability-provider";

export const metadata: Metadata = {
  title: "아몬드영 결제",
  description: "아몬드영 주문 결제",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 체크아웃 경로엔 locale 세그먼트가 없다. 핸드오프 region 쿠키로 정해진 locale 을 그대로 쓴다.
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <body className="antialiased">
        <ObservabilityProvider />
        {children}
      </body>
    </html>
  );
}
