import { HttpTypes } from "@medusajs/types"
// import { SortOptions } from "@modules/store/components/refinement-list/sort-products"

// 임시 타입 정의
type SortOptions = any

interface MinPricedProduct extends HttpTypes.StoreProduct {
  _minPrice?: number
}

/**
 * 스토어 API가 가격 정렬을 지원할 때까지 가격 기준으로 상품을 정렬하는 헬퍼 함수
 * @param products 정렬할 상품 배열
 * @param sortBy 정렬 옵션 (예: price_asc, price_desc)
 * @returns 가격 기준으로 정렬된 상품 배열
 */
export function sortProducts(
  products: HttpTypes.StoreProduct[],
  sortBy: SortOptions
): HttpTypes.StoreProduct[] {
  let sortedProducts = products as MinPricedProduct[]

  if (["price_asc", "price_desc"].includes(sortBy)) {
    // 각 상품의 최저가를 미리 계산
    sortedProducts.forEach((product) => {
      if (product.variants && product.variants.length > 0) {
        product._minPrice = Math.min(
          ...product.variants.map(
            (variant) => variant?.calculated_price?.calculated_amount || 0
          )
        )
      } else {
        product._minPrice = Infinity
      }
    })

    // 미리 계산한 최저가 기준으로 상품 정렬
    sortedProducts.sort((a, b) => {
      const diff = a._minPrice! - b._minPrice!
      return sortBy === "price_asc" ? diff : -diff
    })
  }

  if (sortBy === "created_at") {
    sortedProducts.sort((a, b) => {
      return (
        new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime()
      )
    })
  }

  return sortedProducts
}
