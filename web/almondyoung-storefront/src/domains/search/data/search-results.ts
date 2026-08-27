import "server-only"
import { headers } from "next/headers"
import { listProducts } from "@lib/api/medusa/products"
import { searchProducts } from "@lib/api/pim/search"
import { filterProductsByMembershipVisibility } from "@/lib/utils/product-card"
import type { HttpTypes } from "@medusajs/types"

export type SearchSort =
  | "relevance"
  | "newest"
  | "price_asc"
  | "price_desc"
  | "review"

export interface SearchProductResult {
  items: HttpTypes.StoreProduct[]
  pagination: {
    page: number
    size: number
    total: number
    totalPages: number
  }
  // 영타로 친 검색어를 되돌린 결과 ("tpwp" → "세제")
  correctedQuery?: string
  relatedKeywords?: string[]
}

export interface SearchQuery {
  keyword: string
  page: number
  size: number
  sort: SearchSort
  categoryIds?: string[]
  brands?: string[]
  minPrice?: number
  maxPrice?: number
  isMembership: boolean
  regionId?: string
  correct?: boolean
}

const emptyResult = (size: number): SearchProductResult => ({
  items: [],
  pagination: { page: 1, size, total: 0, totalPages: 0 },
})

// bingbot 이 자기 검색 쿼리를 우리 /search?q= 에 던진다. 2026-08-26 액세스 로그 기준
// /search 요청의 44% 가 bingbot 이었고, 이게 추천검색어와 0건 리포트로 새어 0건 비율을
// 8% → 40% 로 밀어올렸다. 페이지는 정상 응답하되 통계에만 안 남긴다.
const CRAWLER_UA = /bot|crawl|spider|slurp|bingpreview/i

async function isCrawlerRequest(): Promise<boolean> {
  try {
    const requestHeaders = await headers()
    // x-crawler 는 캐시 계층이 붙여줄 때만 있다.
    if (requestHeaders.get("x-crawler") === "1") return true
    return CRAWLER_UA.test(requestHeaders.get("user-agent") ?? "")
  } catch {
    return false
  }
}

/**
 * 검색어로 상품 목록을 만든다. OpenSearch 가 관련도 순서를 정하고 Medusa 가 가격·재고를
 * 채우는 2단 구조라, 두 응답을 합쳐 관련도 순서를 복원하는 것까지가 이 함수의 몫이다.
 *
 * 실패는 빈 결과로 흡수한다 — 검색이 안 되는 것과 페이지가 죽는 것은 다르다.
 */
export async function fetchSearchResults(
  query: SearchQuery
): Promise<SearchProductResult> {
  const { keyword, size, isMembership, regionId } = query
  if (!keyword) return emptyResult(size)

  const isCrawler = await isCrawlerRequest()

  // isMembership 을 전달해 비회원에겐 멤버십 전용 노출 상품을 소스에서 제외 →
  // pagination.total/totalPages 가 실제 노출 개수와 일치.
  const searchApiResult = await searchProducts({
    q: keyword,
    page: query.page,
    size,
    sort: query.sort,
    categoryIds: query.categoryIds,
    brands: query.brands,
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    includeMembersOnly: isMembership,
    correct: query.correct,
    track: !isCrawler,
  }).catch((error) => {
    console.error("[search] OpenSearch 조회 실패:", error)
    return null
  })

  if (!searchApiResult || !("data" in searchApiResult) || !searchApiResult.data) {
    return emptyResult(size)
  }

  const searchData = searchApiResult.data
  const masterIds = searchData.items.map((item) => item.productId)

  let items: HttpTypes.StoreProduct[] = []

  if (masterIds.length > 0) {
    try {
      const medusaResult = await listProducts({
        queryParams: { handle: masterIds, limit: masterIds.length },
        regionId,
      })

      // 검색 관련도 순서 복원 — Medusa 는 handle 배열 순서를 보장하지 않는다.
      const orderMap = new Map(masterIds.map((id, idx) => [id, idx]))
      items = [...medusaResult.response.products].sort((a, b) => {
        const orderA = orderMap.get(a.handle ?? "") ?? Infinity
        const orderB = orderMap.get(b.handle ?? "") ?? Infinity
        return orderA - orderB
      })
    } catch (error) {
      console.error("[search] Medusa 상품 조회 실패:", error)
      return emptyResult(size)
    }
  }

  return {
    // 소스에서 이미 멤버십 전용 노출을 제외하므로 total/totalPages 는 정확하다.
    // 아래 필터는 아직 재색인 안 된 문서(is_visible_to_members_only 없음) 방어층.
    items: filterProductsByMembershipVisibility(items, isMembership),
    pagination: {
      page: searchData.pagination.page,
      size: searchData.pagination.size,
      total: searchData.pagination.total,
      totalPages: searchData.pagination.totalPages,
    },
    correctedQuery: searchData.correctedQuery,
    relatedKeywords: searchData.relatedKeywords,
  }
}
