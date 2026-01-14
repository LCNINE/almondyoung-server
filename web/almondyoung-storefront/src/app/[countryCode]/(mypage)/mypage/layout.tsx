import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@lib/seo"

export const metadata = getSEOTags({
  title: `${siteConfig.appName} | 마이페이지`,
  openGraph: {},
  extraTags: {},
})

export default function MyPageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
