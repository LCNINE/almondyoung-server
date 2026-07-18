import { MypageHomeSkeleton } from "@/components/skeletons/page-skeletons"
import { sanitizeOrderListParams } from "@/domains/order/list/get-order-list-data"
import { MyPageTemplate } from "@/domains/mypage/template/main/mypage-template"
import { WithHeaderLayout } from "@components/layout"
import { Suspense } from "react"

export default async function MyPage({
  params,
  searchParams,
}: {
  params: { countryCode: string }
  searchParams: Promise<{ page?: string; period?: string; q?: string }>
}) {
  const { countryCode } = await params
  const orderListParams = sanitizeOrderListParams(await searchParams)

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
      }}
    >
      <Suspense fallback={<MypageHomeSkeleton />}>
        <MyPageTemplate
          countryCode={countryCode}
          orderListParams={orderListParams}
        />
      </Suspense>
    </WithHeaderLayout>
  )
}
