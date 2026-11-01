import type { Metadata } from "next"
import { Geist_Mono } from "next/font/google"

// 본문 폰트(Pretendard)는 같은 기원에서 낸다 — 테넌트 도메인 로그인 화면이 외부 CDN 을 부르지 않게(격리 실측 «네트워크 호스트»).
import "pretendard/dist/web/static/pretendard-dynamic-subset.css"
import "./globals.css"
import { SiteUnavailable } from "@/components/site-unavailable"
import { ThemeProvider } from "@/components/theme-provider"
import { getSite } from "@/lib/site/site"
import { cn } from "@/lib/utils";

// 들어온 주소로 브랜드가 갈린다 — 정적·ISR 로 구우면 한 주소의 브랜드가 다른 주소에 나간다(OpenNext 캐시 키에 Host 가 없다).
// scripts/tenancy/brand-pages-dynamic.spec.ts 가 이 선언과, 아래 어느 파일도 이걸 뒤집지 않음을 지킨다.
export const dynamic = "force-dynamic"

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export async function generateMetadata(): Promise<Metadata> {
  const site = await getSite()
  // 파비콘은 파일 규칙(app/favicon.ico)이 아니라 여기서 준다 — 파일 규칙은 metadata 보다 앞서 모든 주소에 같은 아이콘을 박는다.
  if (site.kind === "default") return { icons: { icon: "/favicon.ico" } }
  if (site.kind === "tenant") {
    return {
      title: site.displayName,
      // 로고가 없으면 빈 아이콘 — 비워 두면 브라우저가 /favicon.ico(기본 주소의 아이콘)를 스스로 부른다.
      icons: { icon: site.logoUrl ?? "data:," },
    }
  }
  return { title: "주소를 확인해 주세요", icons: { icon: "data:," } }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const site = await getSite()
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-sans")}
    >
      <body>
        <ThemeProvider>{process.env.APP_STAGE === "demo" && <div className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-950">DEMO · 시연 계정으로 로그인하세요</div>}{site.kind === "unavailable" ? <SiteUnavailable /> : children}</ThemeProvider>
      </body>
    </html>
  )
}
