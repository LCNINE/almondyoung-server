import { WithHeaderLayout } from "@components/layout"
import { Breadcrumb } from "@components/layout/components/breadcrumb"

export default function CategoryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      <Breadcrumb className="bg-stone-100" />
      {/* <div id="menu-root" className="relative z-[150] overflow-visible">
          //카테고리 시트 작용하는 범위
        </div> */}
      <div className="bg-white">{children}</div>
    </WithHeaderLayout>
  )
}
