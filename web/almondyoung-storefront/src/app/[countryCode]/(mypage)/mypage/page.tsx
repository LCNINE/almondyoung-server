import { WithHeaderLayout } from "@components/layout"
import ProtectedRoute from "@components/protected-route"
import { MyPageTemplate } from "domains/mypage/template/mypage-template"

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
