"use server"

import { searchProducts } from "@lib/api/pim/search.server"
import type {
  ProductCard,
  SearchProductParams,
  SearchProductResult,
} from "@lib/types/ui/product"
import type { ProductSearchItemDto } from "@lib/types/dto/pim"

/**
 * ProductSearchItemDto를 ProductCard로 변환
 */
function searchItemToProductCard(item: ProductSearchItemDto): ProductCard {
  return {
    id: item.product_id,
    name: item.name,
    brand: item.brand || undefined,
    thumbnail: "https://placehold.co/200x200?text=No+Image", // 검색 결과에는 썸네일 정보가 없음
    basePrice: item.price || undefined,
    membershipPrice: undefined,
    isMembershipOnly: false,
    status: item.status,
    tags: item.tags?.map(t => t.value_name) || [],
    stock: {},
    optionMeta: { isSingle: true },
    defaultSku: 0, // 검색 결과에는 SKU 정보가 없음
  }
}

/**
 * 상품 검색 서비스
 */
export async function searchProductService(
  params: SearchProductParams
): Promise<SearchProductResult> {
  try {
    // 기본값 설정
    const searchParams: SearchProductParams = {
      page: 1,
      limit: 24,
      ...params,
    }

    // API 호출
    const result = await searchProducts(searchParams)
    if ("error" in result) {
      throw new Error(result.error.message)
    }

    const res = result.data

    // DTO → UI 타입 변환
    const items: ProductCard[] = res.items.map(searchItemToProductCard)

    return {
      items,
      pagination: res.pagination,
      aggregations: res.aggregations,
    }
  } catch (error) {
    console.error("[searchProductService] 에러:", error)
    return {
      items: [],
      pagination: {
        page: params.page ?? 1,
        limit: params.limit ?? 24,
        total: 0,
        totalPages: 0,
      },
    }
  }
}

/**
 * 자동완성 검색 (간단한 검색 결과만 반환)
 */
export async function searchProductAutocompleteService(
  keyword: string,
  limit = 10
): Promise<ProductCard[]> {
  try {
    const result = await searchProducts({
      keyword,
      page: 1,
      limit,
    })

    if ("error" in result) {
      throw new Error(result.error.message)
    }

    return result.data.items.map(searchItemToProductCard)
  } catch (error) {
    console.error("[searchProductAutocompleteService] 에러:", error)
    return []
  }
}
