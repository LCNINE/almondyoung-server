import { searchProducts } from "@lib/api/pim/search.server"
import type {
  ProductCard,
  SearchProductParams,
  SearchProductResult,
} from "@lib/types/ui/product"
import { toProductCardFromSearch } from "@lib/utils/transformers"

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
    const result = await searchProducts(searchParams)
    if ("error" in result) {
      throw new Error(result.error.message)
    }
    const response = result.data

    // ProductSearchItemDto -> ProductCard 변환
    const items: ProductCard[] = response.items.map(toProductCardFromSearch)

    return {
      items,
      pagination: response.pagination,
      aggregations: response.aggregations,
    }
  } catch (error) {
    throw error
  }
}

