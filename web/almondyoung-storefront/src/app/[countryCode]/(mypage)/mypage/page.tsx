import { WithHeaderLayout } from "@components/layout"
import { MyPageTemplate } from "domains/mypage/template/mypage-template"

export default async function MyPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      <MyPageTemplate />
    </WithHeaderLayout>
  )
}
