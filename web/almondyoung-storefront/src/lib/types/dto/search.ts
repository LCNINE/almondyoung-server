// 상품 검색 결과 아이템
export interface SearchServiceProductItem {
  productId: string
  versionId: string
  name: string
  thumbnail: string | null
  brand: string | null
  minBasePrice: number | null
  maxBasePrice: number | null
  minMembershipPrice: number | null
  maxMembershipPrice: number | null
  categoryIds: string[]
  score: number | null
}

// 페이지네이션 (size 필드 사용)
export interface SearchServicePagination {
  page: number
  size: number
  total: number
  totalPages: number
}

// 상품 검색 응답
export interface SearchServiceProductsResponse {
  items: SearchServiceProductItem[]
  pagination: SearchServicePagination
}

// 급상승 검색어 아이템
export interface SearchServiceTrendingKeywordItem {
  keyword: string
  count24h: number
  lastSearchedAt: string
}

// 급상승 검색어 응답
export interface SearchServiceTrendingKeywordsResponse {
  windowHours: number
  items: SearchServiceTrendingKeywordItem[]
}

// 자동완성 제안 아이템
export interface SearchServiceSuggestionItem {
  keyword: string
  count: number
  lastSearchedAt: string
  source: "query_log"
}

// 자동완성 응답
export interface SearchServiceSuggestionsResponse {
  query: string
  items: SearchServiceSuggestionItem[]
}
