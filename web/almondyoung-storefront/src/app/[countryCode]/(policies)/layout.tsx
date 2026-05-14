import { MainHeader } from "@/components/layout/header/main-header"

export default function PoliciesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col min-h-screen">
      <MainHeader />
      <main className="flex-1">{children}</main>
    </div>
  )
}
