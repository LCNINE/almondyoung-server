import type { Metadata } from "next";
import "./globals.css";
import { ObservabilityProvider } from "./observability-provider";

export const metadata: Metadata = {
  title: "아몬드영 결제",
  description: "아몬드영 주문 결제",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">
        <ObservabilityProvider />
        {children}
      </body>
    </html>
  );
}
