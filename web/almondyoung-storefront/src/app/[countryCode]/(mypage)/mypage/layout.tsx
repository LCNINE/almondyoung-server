import { appConfig } from "@/lib/config/medusa"
import { getSEOTags } from "@lib/seo"

export const metadata = getSEOTags({
  title: `${appConfig.appName} | 마이페이지`,
  openGraph: {},
  twitter: {},
  extraTags: {},
})

export default function MyPageLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
