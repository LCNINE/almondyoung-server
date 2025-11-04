import { WishlistItem } from "@lib/api/users/wishlist"
import { ProductDetail } from "@lib/types/ui/product"
import { getProductDetailService } from "@lib/services/pim/products/getProductDetailService"
import { getWishlistService } from "./wishlist"

export interface WishlistItemWithProduct extends WishlistItem {
  product: ProductDetail
}

/**
 * 찜한 상품 목록과 상품 상세 정보를 함께 가져오는 서비스
 */
export async function getWishlistWithProducts(
  userId: string
): Promise<WishlistItemWithProduct[]> {
  try {
    console.log("🔍 [getWishlistWithProducts] 시작 - userId:", userId)

    // 1. 찜한 상품 목록 조회 (캐시 무시하고 최신 데이터 조회)
    const wishlistItems = await getWishlistService({
      userId,
      useCache: false,
    })

    console.log("📋 [getWishlistWithProducts] 찜한 상품 목록:", wishlistItems)

    if (wishlistItems.length === 0) {
      console.log("📭 [getWishlistWithProducts] 찜한 상품이 없습니다.")
      return []
    }

    // 2. 각 상품의 상세 정보를 병렬로 조회
    console.log("🛍️ [getWishlistWithProducts] 상품 상세 정보 조회 시작")
    const productPromises = wishlistItems.map(async (item, index) => {
      console.log(
        `📦 [getWishlistWithProducts] 상품 ${index + 1}/${wishlistItems.length} 조회 중 - productId:`,
        item.productId
      )
      try {
        const product = await getProductDetailService(item.productId)
        console.log(
          `✅ [getWishlistWithProducts] 상품 ${item.productId} 조회 성공:`,
          product
        )
        return {
          ...item,
          product: product,
        } as WishlistItemWithProduct
      } catch (error) {
        console.error(
          `❌ [getWishlistWithProducts] 상품 ${item.productId} 정보 조회 실패:`,
          error
        )
        // 상품 정보 조회 실패 시 기본값 반환 (서버 데이터 구조)
        const fallbackProduct = {
          ...item,
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
        } as WishlistItemWithProduct
        console.log(
          `🔄 [getWishlistWithProducts] 상품 ${item.productId} 기본값 반환:`,
          fallbackProduct
        )
        return fallbackProduct
      }
    })

    // 3. 모든 상품 정보 조회 완료 대기
    console.log(
      "⏳ [getWishlistWithProducts] 모든 상품 정보 조회 완료 대기 중..."
    )
    const wishlistWithProducts = await Promise.all(productPromises)

    console.log("🎉 [getWishlistWithProducts] 최종 결과:", wishlistWithProducts)
    console.log(
      "📊 [getWishlistWithProducts] 총 상품 수:",
      wishlistWithProducts.length
    )

    return wishlistWithProducts
  } catch (error) {
    console.error(
      "💥 [getWishlistWithProducts] 찜한 상품 목록 조회 실패:",
      error
    )
    throw error
  }
}
