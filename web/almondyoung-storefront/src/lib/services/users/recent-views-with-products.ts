import { RecentViewDto } from "@lib/types/dto/user"
import { ProductDetail } from "@lib/types/ui/product"
import { getProductDetailService } from "@lib/services/pim/products/getProductDetailService"
import { getRecentViews } from "@lib/api/users/recent-views"

/**
 * 최근 본 상품 아이템 + 상품 상세 정보
 * WishlistItemWithProduct와 호환되는 구조
 */
export interface RecentViewItemWithProduct {
  id: string
  userId: string
  productId: string
  createdAt: string
  product: ProductDetail
}

/**
 * 최근 본 상품 목록과 상품 상세 정보를 함께 가져오는 서비스
 */
export async function getRecentViewsWithProducts(
  limit: number = 10
): Promise<RecentViewItemWithProduct[]> {
  try {
    console.log("🔍 [getRecentViewsWithProducts] 시작 - limit:", limit)

    // 1. 최근 본 상품 목록 조회
    const recentViews = await getRecentViews(limit)

    console.log("📋 [getRecentViewsWithProducts] 최근 본 상품 목록:", recentViews)

    if (recentViews.length === 0) {
      console.log("📭 [getRecentViewsWithProducts] 최근 본 상품이 없습니다.")
      return []
    }

    // 2. 각 상품의 상세 정보를 병렬로 조회
    console.log("🛍️ [getRecentViewsWithProducts] 상품 상세 정보 조회 시작")
    const productPromises = recentViews.map(async (item: RecentViewDto, index: number) => {
      console.log(
        `📦 [getRecentViewsWithProducts] 상품 ${index + 1}/${recentViews.length} 조회 중 - productId:`,
        item.productId
      )
      try {
        const product = await getProductDetailService(item.productId)
        console.log(
          `✅ [getRecentViewsWithProducts] 상품 ${item.productId} 조회 성공:`,
          product
        )
        return {
          id: item.id,
          userId: item.userId,
          productId: item.productId,
          createdAt: item.createdAt,
          product: product,
        } as RecentViewItemWithProduct
      } catch (error) {
        console.error(
          `❌ [getRecentViewsWithProducts] 상품 ${item.productId} 정보 조회 실패:`,
          error
        )
        // 상품 정보 조회 실패 시 기본값 반환
        return {
          id: item.id,
          userId: item.userId,
          productId: item.productId,
          createdAt: item.createdAt,
          product: {
            id: item.productId,
            name: "상품 정보를 불러올 수 없습니다",
            thumbnail: "https://placehold.co/300x300",
            thumbnails: [],
            brand: "",
            basePrice: 0,
            membershipPrice: 0,
            status: "inactive",
            options: [],
          } as ProductDetail,
        } as RecentViewItemWithProduct
      }
    })

    // 3. 모든 상품 정보 조회 완료 대기
    console.log(
      "⏳ [getRecentViewsWithProducts] 모든 상품 정보 조회 완료 대기 중..."
    )
    const recentViewsWithProducts = await Promise.all(productPromises)

    console.log("🎉 [getRecentViewsWithProducts] 최종 결과:", recentViewsWithProducts)
    console.log(
      "📊 [getRecentViewsWithProducts] 총 상품 수:",
      recentViewsWithProducts.length
    )

    return recentViewsWithProducts
  } catch (error) {
    console.error(
      "💥 [getRecentViewsWithProducts] 최근 본 상품 목록 조회 실패:",
      error
    )
    throw error
  }
}

