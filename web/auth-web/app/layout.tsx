import { Geist_Mono } from "next/font/google"

import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils";

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans")}
    >
      <body>
        <ThemeProvider>{process.env.APP_STAGE === "demo" && <div className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950">DEMO · 시연 계정으로 로그인하세요</div>}{children}</ThemeProvider>
      </body>
    </html>
  )
}
