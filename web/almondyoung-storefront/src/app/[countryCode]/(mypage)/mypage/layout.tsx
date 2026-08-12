import ProtectedRoute from "@components/protected-route"
import { NOINDEX, getSEOTags } from "@lib/seo"
import { getTranslations } from "next-intl/server"
import Script from "next/script"

export async function generateMetadata() {
  const t = await getTranslations("mypage.menu")
  return getSEOTags({
    title: t("mypage"),
    openGraph: {},
    extraTags: { robots: NOINDEX },
  })
}

export default function MyPageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ProtectedRoute>
      <>
        {children}
        <Script
          src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
          strategy="lazyOnload"
        />
      </>
    </ProtectedRoute>
  )
}
