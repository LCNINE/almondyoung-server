import { WithHeaderLayout } from "@components/layout"
import ProtectedRoute from "@components/protected-route"
import { MyPageTemplate } from "domains/mypage/template/mypage-template"

//배송중인 주문 목록 API
//결제 금액 API 이번달

export default async function MyPage() {
  return (
    // <ProtectedRoute>
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      <MyPageTemplate />
    </WithHeaderLayout>
    // </ProtectedRoute>
  )
}
