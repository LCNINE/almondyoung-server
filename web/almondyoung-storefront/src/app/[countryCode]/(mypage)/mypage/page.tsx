import { Suspense } from "react"
import { WithHeaderLayout } from "@components/layout"
import { MypageHomeSkeleton } from "@/components/skeletons/page-skeletons"
import { MyPageTemplate } from "domains/mypage/template/mypage-template"

export default async function MyPage() {
  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      <Suspense fallback={<MypageHomeSkeleton />}>
        <MyPageTemplate />
      </Suspense>
    </WithHeaderLayout>
  )
}
