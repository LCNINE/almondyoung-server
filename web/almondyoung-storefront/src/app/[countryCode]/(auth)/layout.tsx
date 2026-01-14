import { MobileBackHeader } from "@/components/layout/header/m-back-header"
import { siteConfig } from "@/lib/config/site"
import { getSEOTags } from "@lib/seo"
import { Toaster } from "sonner"

export const metadata = getSEOTags({
  title: `${siteConfig.appName}`,
  openGraph: {},
  extraTags: {},
})

export default async function AuthLayout({
  children,
  params,
}: {
  params: Promise<{ countryCode: string }>
  children: React.ReactNode
}) {
  const { countryCode } = await params
  const pageTitle = `/${countryCode}/auth`
  return (
    <div className="min-h-screen">
      {/* Auth 전용 레이아웃 - 헤더 없음 */}
      <MobileBackHeader title={pageTitle} />
      <main className="flex-1">{children}</main>
      <Toaster />
    </div>
  )
}
