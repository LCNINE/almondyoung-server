import Script from "next/script"
import type { Metadata } from "next"
import { NOINDEX } from "@lib/seo"

export const metadata: Metadata = { robots: NOINDEX }

export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      {children}
      <Script
        src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
        strategy="lazyOnload"
      />
    </>
  )
}
