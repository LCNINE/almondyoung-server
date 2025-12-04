import { WithHeaderLayout } from "@components/layout"
import { Breadcrumb } from "@components/layout/components/breadcrumb"

export default function CategoryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <>
      <Breadcrumb className="bg-stone-100" />
      <div className="bg-white">{children}</div>
    </>
  )
}
