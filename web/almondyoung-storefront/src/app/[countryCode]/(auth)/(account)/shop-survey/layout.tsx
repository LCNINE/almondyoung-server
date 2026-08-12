import { NOINDEX, getSEOTags } from "@/lib/seo"

export const metadata = getSEOTags({
  title: "샵 설문조사",
  openGraph: {},
  extraTags: { robots: NOINDEX },
})

export default function ShopSurveyLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="w-full px-5 md:px-[40px]">{children}</div>
}
