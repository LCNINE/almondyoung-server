import { searchProducts } from "@lib/api/pim/pim-api"
import type { ProductSearchResponseDto, TagFilterDto } from "@lib/api/pim/pim-types"
import type { ProductCard } from "@lib/types/ui/product"
import { toProductCardFromSearch } from "@lib/utils/transformers/product.transformer"

/**
 * 검색 파라미터 타입
 */
export interface SearchProductParams {
  keyword?: string
  categoryId?: string
  brands?: string[]
  minPrice?: number
  maxPrice?: number
  status?: string
  tagFilters?: TagFilterDto[]
  sortBy?: "relevance" | "price" | "createdAt"
  sortOrder?: "asc" | "desc"
  page?: number
  limit?: number
}

/**
 * 검색 결과 타입
 */
export interface SearchProductResult {
  items: ProductCard[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
  aggregations?: ProductSearchResponseDto["aggregations"]
}

/**
 * Elasticsearch를 사용한 상품 검색 서비스
 * 
 * @param params 검색 파라미터
 * @returns 검색 결과
 */
export async function searchProductService(
  params: SearchProductParams = {}
): Promise<SearchProductResult> {
  try {
    // 기본값 설정
    const searchParams = {
      page: params.page ?? 1,
      limit: params.limit ?? 20,
      sortBy: params.sortBy ?? "relevance",
      sortOrder: params.sortOrder ?? "desc",
      ...params,
    }

    // API 호출
    const response = await searchProducts(searchParams)

    // ProductSearchItemDto -> ProductCard 변환
    const items: ProductCard[] = response.items.map(toProductCardFromSearch)

    return {
      items,
      pagination: response.pagination,
      aggregations: response.aggregations,
    }
  } catch (error) {
    console.error("❌ [searchProductService] 검색 실패:", error)
    throw error
  }
}

