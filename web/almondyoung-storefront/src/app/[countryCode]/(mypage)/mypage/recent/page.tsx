import { PageTitle } from "@/components/shared/page-title"
import { WithHeaderLayout } from "@components/layout"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { getRecentViews } from "@lib/api/users/recent-views"
import { getProductList } from "@lib/api/medusa/products"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import { Suspense } from "react"
import { Eye } from "lucide-react"
import { RecentContainer, RecentContainerSkeleton } from "./recent-container"

interface RecentPageProps {
  params: Promise<{
    countryCode: string
  }>
}

export default async function RecentPage({ params }: RecentPageProps) {
  const { countryCode } = await params

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "최근 본 상품",
      }}
    >
      <MypageLayout>
        <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
          <PageTitle>최근 본 상품</PageTitle>
          <Suspense fallback={<RecentContainerSkeleton />}>
            <RecentViewsManager countryCode={countryCode} />
          </Suspense>
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}

async function RecentViewsManager({ countryCode }: { countryCode: string }) {
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

    const mappedProducts = mapStoreProductsToCardProps(orderedProducts)

    return <RecentContainer products={mappedProducts} countryCode={countryCode} />
  } catch (error) {
    console.error("최근 본 상품 조회 실패:", error)

    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 text-center">
        <p className="text-gray-500">최근 본 상품을 불러오는데 실패했습니다</p>
      </div>
    )
  }
}
