import "server-only"
import { headers } from "next/headers"
import { listProducts } from "@lib/api/medusa/products"
import { searchProducts } from "@lib/api/pim/search"
import { filterProductsByMembershipVisibility } from "@/lib/utils/product-card"
import {
  OWN_BRAND,
  PIN_CANDIDATE_SIZE,
  PIN_EXCLUDED_CATEGORY_IDS,
  PIN_LIMIT,
  PIN_SCORE_RATIO,
  pinOwnBrand,
} from "../utils/pin-own-brand"
import { findOwnBrandAlias } from "./own-brand-aliases"
import type { HttpTypes } from "@medusajs/types"
import type {
  SearchServiceProductItem,
  SearchServiceProductsResponse,
} from "@lib/types/dto/search"

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
  // 고정은 1페이지에서만 계산한다 — 2페이지 이후엔 그 페이지의 1위 점수가 낮아
  // 관련도 하한이 헐거워져, 1페이지에 고정한 적도 없는 상품을 걷어내게 된다.
  const pinnedIds =
    query.page === 1 ? await resolveOwnBrandPin(query, searchData) : []

  const masterIds = pinOwnBrand(
    searchData.items.map((item) => item.productId),
    pinnedIds
  )

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

/**
 * 검색 결과에 끼워 넣을 자사 상품을 고른다 (최대 PIN_LIMIT 개).
 *
 * 1) 검색어 그대로 자사 상품을 찾는다 — 관련도가 1위 대비 너무 낮은 건 버린다.
 * 2) 하나도 안 남으면 사전(own-brand-aliases)에 등록된 대체 검색어로 다시 찾는다.
 *    "롤리킹"(타사 롯드 브랜드)처럼 우리 상품명엔 없는 말로 검색한 경우가 여기 걸린다.
 *    사전은 사람이 고른 대응이라 관련도 하한을 적용하지 않는다.
 *
 * 검색 본류를 안 건드린다: 이 조회들은 통계에 남기지 않고(track: false), 교정도 다시
 * 걸지 않으며(correct: false), 실패는 빈 배열로 흡수한다.
 */
async function resolveOwnBrandPin(
  query: SearchQuery,
  searchData: SearchServiceProductsResponse
): Promise<string[]> {
  if (query.sort !== "relevance") return []
  if (query.brands?.length) return []
  if (searchData.items[0]?.brand === OWN_BRAND) return []

  const keyword = searchData.correctedQuery ?? query.keyword
  const topScore = maxScore(searchData.items)
  if (topScore <= 0) return []

  const matched = (await findOwnBrandProducts(query, keyword)).filter(
    (item) => (item.score ?? 0) >= topScore * PIN_SCORE_RATIO
  )
  if (matched.length > 0) {
    return matched.slice(0, PIN_LIMIT).map((item) => item.productId)
  }

  const alias = findOwnBrandAlias(keyword)
  if (!alias) return []

  return (await findOwnBrandProducts(query, alias))
    .slice(0, PIN_LIMIT)
    .map((item) => item.productId)
}

/** 주어진 검색어로 자사 상품을 관련도 높은 순으로 돌려준다. */
async function findOwnBrandProducts(
  query: SearchQuery,
  keyword: string
): Promise<SearchServiceProductItem[]> {
  const result = await searchProducts({
    q: keyword,
    page: 1,
    size: PIN_CANDIDATE_SIZE,
    sort: "relevance",
    categoryIds: query.categoryIds,
    brands: [OWN_BRAND],
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    includeMembersOnly: query.isMembership,
    correct: false,
    track: false,
  }).catch(() => null)

  const items =
    result && "data" in result && result.data ? result.data.items : []

  // 응답 순서는 관련도 점수 순서와 다를 수 있다 (벡터 검색과 RRF 로 섞인다).
  return items
    .filter(
      (item) =>
        !item.categoryIds.some((id) => PIN_EXCLUDED_CATEGORY_IDS.includes(id))
    )
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}

function maxScore(items: SearchServiceProductItem[]): number {
  return items.reduce((acc, item) => Math.max(acc, item.score ?? 0), 0)
}
