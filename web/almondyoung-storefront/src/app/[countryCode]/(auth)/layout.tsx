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
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen">
      <main className="flex-1">{children}</main>
      <Toaster />
    </div>
  )
}
