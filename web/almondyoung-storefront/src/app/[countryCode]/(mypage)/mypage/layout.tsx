import ProtectedRoute from "@components/protected-route"
import { getSEOTags } from "@lib/seo"
import Script from "next/script"

export const metadata = getSEOTags({
  title: `마이페이지`,
  openGraph: {},
  extraTags: {},
})

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
