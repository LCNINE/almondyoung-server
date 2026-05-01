import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@/lib/seo"

export const metadata = getSEOTags({
  title: `샵 설문조사 | ${siteConfig.appName}`,
  openGraph: {},
  extraTags: {},
})

export default function ShopSurveyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="w-full px-5 md:px-[40px]">{children}</div>
}
