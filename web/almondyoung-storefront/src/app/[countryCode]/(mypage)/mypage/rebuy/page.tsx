import { Metadata } from "next"
import { PageTitle } from "@/components/shared/page-title"
import MypageLayout from "@/app/[countryCode]/(mypage)/_components/mypage-layout"
import { WithHeaderLayout } from "@components/layout"
import { getOrders } from "@lib/api/medusa/orders"
import { getProductList } from "@lib/api/medusa/products"
import { mapStoreProductsToCardProps } from "@lib/utils/product-card"
import { Package } from "lucide-react"
import { RebuyContainer } from "./rebuy-container"

export const metadata: Metadata = {
  title: "재구매",
  description: "재구매 상품을 확인하세요",
}

interface RebuyPageProps {
  params: Promise<{
    countryCode: string
  }>
}

export default async function RebuyPage({ params }: RebuyPageProps) {
  const { countryCode } = await params

  return (
    <WithHeaderLayout
      config={{
        showDesktopHeader: true,
        showMobileHeader: false,
        showMobileSubBackHeader: true,
        mobileSubBackHeaderTitle: "자주 산 상품",
      }}
    >
      <MypageLayout>
        <div className="rounded-xl bg-white px-3 pt-4 pb-9 md:px-6">
          <PageTitle>자주 산 상품</PageTitle>
          <RebuyProductsList countryCode={countryCode} />
        </div>
      </MypageLayout>
    </WithHeaderLayout>
  )
}

async function RebuyProductsList({ countryCode }: { countryCode: string }) {
  try {
    // 1. 최근 주문 내역 조회
    const ordersData = await getOrders({ limit: 50 })

    if (!ordersData?.orders || ordersData.orders.length === 0) {
      return (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
          <Package className="h-12 w-12 text-gray-300" />
          <div>
            <p className="text-lg font-medium text-gray-600">
              구매 내역이 없습니다
            </p>
            <p className="mt-1 text-sm text-gray-400">첫 주문을 시작해보세요</p>
          </div>
        </div>
      )
    }

    // 2. 주문한 상품들의 ID를 수집하고 빈도 계산
    const productFrequency = new Map<string, number>()

    ordersData.orders.forEach((order) => {
      if (order.status === "completed" || order.payment_status === "captured") {
        order.items?.forEach((item) => {
          const productId = item.variant?.product_id || item.product_id
          if (productId) {
            productFrequency.set(
              productId,
              (productFrequency.get(productId) || 0) + 1
            )
          }
        })
      }
    })

    // 3. 구매 빈도 순으로 정렬하여 상위 20개 추출
    const sortedProducts = Array.from(productFrequency.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => id)

    if (sortedProducts.length === 0) {
      return (
        <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
          <Package className="h-12 w-12 text-gray-300" />
          <div>
            <p className="text-lg font-medium text-gray-600">
              완료된 주문이 없습니다
            </p>
            <p className="mt-1 text-sm text-gray-400">
              구매를 완료하면 여기에 표시됩니다
            </p>
          </div>
        </div>
      )
    }

    // 4. 상품 정보 조회
    const productsResult = await getProductList({
      handle: sortedProducts,
      limit: sortedProducts.length,
    })

    // 5. 구매 빈도 순서 유지하면서 매핑
    const productsMap = new Map(
      productsResult.products.map((p: any) => [p.id, p])
    )

    const orderedProducts = sortedProducts
      .map((id) => productsMap.get(id))
      .filter(Boolean)

    const mappedProducts = mapStoreProductsToCardProps(orderedProducts)

    return <RebuyContainer products={mappedProducts} countryCode={countryCode} />
  } catch (error) {
    console.error("재구매 상품 조회 실패:", error)

    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 text-center">
        <p className="text-gray-500">상품을 불러오는데 실패했습니다</p>
      </div>
    )
  }
}
