import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import ProtectedRoute from "@components/protected-route"

export default function WishPage() {
  return (
    <ProtectedRoute>
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "결제수단 관리",
        }}
      >
        <MypageLayout>
          <div>준비중입니다.</div>
        </MypageLayout>
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}
