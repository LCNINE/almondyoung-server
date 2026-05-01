import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"

interface MypageLoadingShellProps {
  children: React.ReactNode
  title?: string
  showMobileSubBackHeader?: boolean
}

export function MypageLoadingShell({
  children,
  title = "",
  showMobileSubBackHeader = true,
}: MypageLoadingShellProps) {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader,
        mobileSubBackHeaderTitle: title,
      }}
    >
      <MypageLayout>{children}</MypageLayout>
    </WithHeaderLayout>
  )
}
