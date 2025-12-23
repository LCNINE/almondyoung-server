import { PageTitle } from "@components/common/page-title"
import { Spinner } from "@components/common/spinner"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@components/layout/mypage-layout"
import { ProductRowCard } from "@components/product-row-card/product-row-card"
import ProtectedRoute from "@components/protected-route"
import { getRecentViews } from "@lib/api/users/recent-views"
import { Suspense } from "react"

export default async function RecentPage() {
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
          <Suspense
            fallback={
              <div className="flex h-56 items-center justify-center text-center">
                <Spinner size="lg" color="gray" />
              </div>
            }
          >
            <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
              <PageTitle>최근 본 상품</PageTitle>

              <ResentViewsManager />
            </div>
          </Suspense>
        </MypageLayout>
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}

async function ResentViewsManager() {
  const resendViews = await getRecentViews(20)

  return <div>준비중입니다.</div>

  // if (resendViews.length === 0) {
  //   return (
  //     <div className="flex items-center justify-center py-20">
  //       <div className="text-gray-500">최근 본 상품이 없습니다.</div>
  //     </div>
  //   )
  // }

  // return (
  //   <>

  //     {/* {resendViews.map((recentView) => (
  //       <ProductRowCard item={recentView.items} />
  //     ))} */}
  //   </>
  // )
}
