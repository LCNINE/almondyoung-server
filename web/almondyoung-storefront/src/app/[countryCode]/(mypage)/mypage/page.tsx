import { MypageHomeSkeleton } from "@/components/skeletons/page-skeletons"
import { MyPageTemplate } from "@/domains/mypage/template/main/mypage-template"
import { WithHeaderLayout } from "@components/layout"
import { Suspense } from "react"

export default async function MyPage({
  params,
}: {
  params: { countryCode: string }
}) {
  const { countryCode } = await params

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      <Suspense fallback={<MypageHomeSkeleton />}>
        <MyPageTemplate countryCode={countryCode} />
      </Suspense>
    </WithHeaderLayout>
  )
}
