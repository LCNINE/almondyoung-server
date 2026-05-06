"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/api/api"
import type {
  SearchServiceProductsResponse,
  SearchServiceTrendingKeywordsResponse,
  SearchServiceSuggestionsResponse,
} from "@lib/types/dto/search"

// 급상승 검색어 타입
export interface TrendingKeyword {
  keyword: string
  status: "up" | "down" | "new" | "stable"
  rank: number
  previousRank?: number
}

// 인기 검색어 타입
export interface PopularKeyword {
  keyword: string
  searchCount?: number
}

// search 서비스 기반 상품 검색
export const searchProducts = async (params?: {
  q?: string
  categoryIds?: string[]
  brands?: string[]
  minPrice?: number
  maxPrice?: number
  sort?: string
  page?: number
  size?: number
}): Promise<ApiResponse<SearchServiceProductsResponse>> => {
  try {
    const searchParams = new URLSearchParams()

    if (params?.q) searchParams.set("q", params.q)
    if (params?.categoryIds?.length) {
      params.categoryIds.forEach((categoryId) =>
        searchParams.append("categoryIds", categoryId)
      )
    }
    if (params?.brands && params.brands.length > 0) {
      params.brands.forEach((brand) => searchParams.append("brands", brand))
    }
    if (params?.minPrice !== undefined)
      searchParams.set("minPrice", params.minPrice.toString())
    if (params?.maxPrice !== undefined)
      searchParams.set("maxPrice", params.maxPrice.toString())
    if (params?.sort) searchParams.set("sort", params.sort)
    if (params?.page) searchParams.set("page", params.page.toString())
    if (params?.size) searchParams.set("size", params.size.toString())

    const queryString = searchParams.toString()
    const path = queryString ? `/search/products?${queryString}` : "/search/products"

    const result = await api<SearchServiceProductsResponse>("search", path, {
      method: "GET",
      withAuth: false,
    })

    return { data: result }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }
    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }
    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}

// 급상승 검색어 조회
export const getTrendingKeywords = async (params?: {
  size?: number
}): Promise<ApiResponse<{ keywords: TrendingKeyword[]; updatedAt: string }>> => {
  try {
    const searchParams = new URLSearchParams()
    if (params?.size) searchParams.set("size", params.size.toString())

    const queryString = searchParams.toString()
    const path = queryString
      ? `/search/products/trending-keywords?${queryString}`
      : "/search/products/trending-keywords"

    const result = await api<SearchServiceTrendingKeywordsResponse>(
      "search",
      path,
      { method: "GET", withAuth: false }
    )

    const keywords: TrendingKeyword[] = result.items.map((item, idx) => ({
      keyword: item.keyword,
      status: "stable" as const,
      rank: idx + 1,
    }))

    const updatedAt =
      result.items[0]?.lastSearchedAt ?? new Date().toISOString()

    return { data: { keywords, updatedAt } }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }
    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }
    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}

// 인기/추천 검색어 조회 — trending 데이터 재사용
export const getPopularKeywords = async (): Promise<
  ApiResponse<{ keywords: PopularKeyword[] }>
> => {
  const trendingResult = await getTrendingKeywords({ size: 12 })

  if ("error" in trendingResult && trendingResult.error) {
    return { error: trendingResult.error }
  }

  const keywords: PopularKeyword[] =
    trendingResult.data?.keywords.map((item) => ({
      keyword: item.keyword,
    })) ?? []

  return { data: { keywords } }
}

// 카테고리 대표 이미지 1장 조회 — 인덱스에 thumbnail이 비어있는 상품이 많아
// 여러 건을 받아 첫 non-null thumbnail을 선택합니다.
const CATEGORY_THUMBNAIL_PROBE_SIZE = 20

export const getCategoryFallbackThumbnail = async (
  categoryIds: string[]
): Promise<string | null> => {
  if (categoryIds.length === 0) return null

  try {
    const searchParams = new URLSearchParams()
    categoryIds.forEach((id) => searchParams.append("categoryIds", id))
    searchParams.set("size", String(CATEGORY_THUMBNAIL_PROBE_SIZE))

    const result = await api<SearchServiceProductsResponse>(
      "search",
      `/search/products?${searchParams.toString()}`,
      {
        method: "GET",
        withAuth: false,
        next: {
          tags: [`category-thumbnail-${categoryIds[0]}`],
          revalidate: 3600,
        },
      }
    )

    return result.items.find((item) => item.thumbnail)?.thumbnail ?? null
  } catch {
    return null
  }
}

// 자동완성 제안 조회
export const getSuggestions = async (params: {
  q?: string
  size?: number
}): Promise<ApiResponse<SearchServiceSuggestionsResponse>> => {
  try {
    const searchParams = new URLSearchParams()
    if (params.q) searchParams.set("q", params.q)
    if (params.size) searchParams.set("size", params.size.toString())

    const queryString = searchParams.toString()
    const path = queryString
      ? `/search/products/suggestions?${queryString}`
      : "/search/products/suggestions"

    const result = await api<SearchServiceSuggestionsResponse>("search", path, {
      method: "GET",
      withAuth: false,
    })

    return { data: result }
  } catch (error) {
    if (error instanceof HttpApiError) {
      return { error: { message: error.message, status: error.status } }
    }
    if (error instanceof ApiNetworkError) {
      return {
        error: { message: "네트워크 오류가 발생했습니다.", status: 500 },
      }
    }
    return {
      error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 },
    }
  }
}
