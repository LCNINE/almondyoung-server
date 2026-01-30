import { PageTitle } from "@/components/shared/page-title"
import { Spinner } from "@/components/shared/spinner"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import ProtectedRoute from "@components/protected-route"
import { getRecentViews } from "@lib/api/users/recent-views"
import { getProductList } from "@lib/api/medusa/products"
import { mapMedusaProductsToCards } from "@lib/utils/map-medusa-product-card"
import { Suspense } from "react"
import { BasicProductCard } from "@components/products/product-card"
import { Eye } from "lucide-react"

export default async function RecentPage() {
  return (
    <ProtectedRoute>
      <WithHeaderLayout
        config={{
          showDesktopHeader: true,
          showMobileHeader: false,
          showMobileSubBackHeader: true,
          mobileSubBackHeaderTitle: "최근 본 상품",
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

              <RecentViewsManager />
            </div>
          </Suspense>
        </MypageLayout>
      </WithHeaderLayout>
    </ProtectedRoute>
  )
}

async function RecentViewsManager() {
  const recentViews = await getRecentViews(20)

  if (recentViews.length === 0) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
        <Eye className="h-12 w-12 text-gray-300" />
        <div>
          <p className="text-lg font-medium text-gray-600">
            최근 본 상품이 없습니다
          </p>
          <p className="mt-1 text-sm text-gray-400">
            상품을 둘러보고 나만의 취향을 찾아보세요
          </p>
        </div>
      </div>
    )
  }

  // 최근 본 상품 ID 목록으로 실제 상품 정보 조회
  const productIds = recentViews.map((view) => view.productId)

  try {
    const productsResult = await getProductList({
      handle: productIds,
      limit: productIds.length,
    })

    // 최근 본 순서 유지하면서 상품 매핑
    const productsMap = new Map(
      productsResult.products.map((p: any) => [p.id, p])
    )

    const orderedProducts = productIds
      .map((id) => productsMap.get(id))
      .filter(Boolean)

    const mappedProducts = mapMedusaProductsToCards(orderedProducts)

    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {mappedProducts.map((product) => (
          <div key={product.id}>
            <BasicProductCard product={product} />
          </div>
        ))}
      </div>
    )
  } catch (error) {
    console.error("최근 본 상품 조회 실패:", error)

    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center">
        <p className="text-gray-500">최근 본 상품을 불러오는데 실패했습니다</p>
      </div>
    )
  }
}
