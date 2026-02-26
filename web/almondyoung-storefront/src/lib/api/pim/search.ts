"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/api/api"
import type { ProductSearchResponseDto, SearchSort } from "@lib/types/dto/pim"

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

// 엘라스틱서치 기반 상품 검색
export const searchProducts = async (params?: {
  q?: string
  categoryIds?: string[]
  brands?: string[]
  minPrice?: number
  maxPrice?: number
  sort?: SearchSort
  page?: number
  size?: number
}): Promise<ApiResponse<ProductSearchResponseDto>> => {
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

    const result = await api<ProductSearchResponseDto>("search", path, {
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
// TODO: 서버 API 구현 후 실제 API 호출로 변경
export const getTrendingKeywords = async (): Promise<
  ApiResponse<{ keywords: TrendingKeyword[]; updatedAt: string }>
> => {
  // Mock 데이터 (서버 API 구현 전까지 사용)
  const mockData: TrendingKeyword[] = [
    { keyword: "비타민D", status: "up", rank: 1 },
    { keyword: "저당 젤리", status: "new", rank: 2 },
    { keyword: "식물성 단백질", status: "up", rank: 3 },
    { keyword: "아르기닌 6000", status: "down", rank: 4 },
    { keyword: "콜라겐 스틱", status: "new", rank: 5 },
    { keyword: "유산균", status: "up", rank: 6 },
    { keyword: "오메가3", status: "new", rank: 7 },
    { keyword: "다이어트 쉐이크", status: "up", rank: 8 },
    { keyword: "선크림", status: "down", rank: 9 },
    { keyword: "비타민C", status: "new", rank: 10 },
  ]

  // 현재 시간 기준 (정각)
  const now = new Date()
  now.setMinutes(0, 0, 0)
  const updatedAt = now.toISOString()

  return {
    data: {
      keywords: mockData,
      updatedAt,
    },
  }

  // TODO: 서버 API 구현 후 아래 코드로 교체
  // try {
  //   const result = await api<{ keywords: TrendingKeyword[]; updatedAt: string }>(
  //     "analytics",
  //     "/search/trending",
  //     { method: "GET", withAuth: false }
  //   )
  //   return { data: result }
  // } catch (error) {
  //   if (error instanceof HttpApiError) {
  //     return { error: { message: error.message, status: error.status } }
  //   }
  //   return { error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 } }
  // }
}

// 인기/추천 검색어 조회
// TODO: 서버 API 구현 후 실제 API 호출로 변경
export const getPopularKeywords = async (): Promise<
  ApiResponse<{ keywords: PopularKeyword[] }>
> => {
  // Mock 데이터 (서버 API 구현 전까지 사용)
  const mockData: PopularKeyword[] = [
    { keyword: "퍼마" },
    { keyword: "펌제" },
    { keyword: "노몬드" },
    { keyword: "롤리킹" },
    { keyword: "국가고시" },
    { keyword: "네일" },
    { keyword: "헤어" },
    { keyword: "샴푸" },
    { keyword: "로레알" },
    { keyword: "데미" },
    { keyword: "클리닉" },
    { keyword: "가발" },
  ]

  return {
    data: {
      keywords: mockData,
    },
  }

  // TODO: 서버 API 구현 후 아래 코드로 교체
  // try {
  //   const result = await api<{ keywords: PopularKeyword[] }>(
  //     "analytics",
  //     "/search/popular",
  //     { method: "GET", withAuth: false }
  //   )
  //   return { data: result }
  // } catch (error) {
  //   if (error instanceof HttpApiError) {
  //     return { error: { message: error.message, status: error.status } }
  //   }
  //   return { error: { message: "알 수 없는 오류가 발생했습니다.", status: 500 } }
  // }
}
