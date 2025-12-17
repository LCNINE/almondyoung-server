"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/api/api"
import type {
    ProductSearchResponseDto,
    TagFilterDto,
} from "@lib/types/dto/pim"

// 엘라스틱서치 기반 상품 검색
export const searchProducts = async (params?: {
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
}): Promise<ApiResponse<ProductSearchResponseDto>> => {
    try {
        // URLSearchParams를 사용하여 배열 파라미터 처리
        const searchParams = new URLSearchParams()

        if (params?.keyword) searchParams.set("keyword", params.keyword)
        if (params?.categoryId) searchParams.set("categoryId", params.categoryId)
        if (params?.brands && params.brands.length > 0) {
            params.brands.forEach((brand) => searchParams.append("brands", brand))
        }
        if (params?.minPrice !== undefined)
            searchParams.set("minPrice", params.minPrice.toString())
        if (params?.maxPrice !== undefined)
            searchParams.set("maxPrice", params.maxPrice.toString())
        if (params?.status) searchParams.set("status", params.status)
        if (params?.tagFilters && params.tagFilters.length > 0) {
            params.tagFilters.forEach((filter, index) => {
                searchParams.set(`tagFilters[${index}][groupId]`, filter.groupId)
                filter.valueIds.forEach((valueId) => {
                    searchParams.append(`tagFilters[${index}][valueIds][]`, valueId)
                })
            })
        }
        if (params?.sortBy) searchParams.set("sortBy", params.sortBy)
        if (params?.sortOrder) searchParams.set("sortOrder", params.sortOrder)
        if (params?.page) searchParams.set("page", params.page.toString())
        if (params?.limit) searchParams.set("limit", params.limit.toString())

        // 쿼리 문자열을 경로에 직접 포함 (배열 파라미터 처리)
        const queryString = searchParams.toString()
        const path = queryString ? `/products/search?${queryString}` : "/products/search"

        const result = await api<ProductSearchResponseDto>("pim", path, {
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

