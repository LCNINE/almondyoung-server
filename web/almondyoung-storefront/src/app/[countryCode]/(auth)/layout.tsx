import { NOINDEX, getSEOTags } from "@lib/seo"
import { Toaster } from "sonner"

export const metadata = getSEOTags({
  title: "로그인",
  openGraph: {},
  extraTags: { robots: NOINDEX },
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
