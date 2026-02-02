import Footer from "@/components/layout/footer"
import { MainHeader } from "@/components/layout/header/main-header"

export default function PoliciesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <MainHeader />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
