"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/types/common/users"
import type {
    ProductListResponseDto,
    ProductDetailDto,
} from "@lib/types/dto/pim"

// 상품 목록 조회
export const getProductList = async (params?: {
    page?: number
    limit?: number
    mode?: "active" | "active-or-inactive"
    categoryId?: string
    brand?: string
    name?: string
}): Promise<ApiResponse<ProductListResponseDto>> => {
    try {
        const queryParams: Record<string, string> = {}
        if (params?.page) queryParams.page = params.page.toString()
        if (params?.limit) queryParams.limit = params.limit.toString()
        if (params?.mode) queryParams.mode = params.mode
        if (params?.categoryId) queryParams.categoryId = params.categoryId
        if (params?.brand) queryParams.brand = params.brand
        if (params?.name) queryParams.name = params.name

        const result = await api<ProductListResponseDto>("pim", "/masters", {
            method: "GET",
            params: queryParams,
            withAuth: false, // PIM API는 인증 불필요 (쇼핑몰 클라이언트)
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

// 상품 상세 조회
export const getProductDetail = async (
    masterId: string
): Promise<ApiResponse<ProductDetailDto>> => {
    try {
        const result = await api<ProductDetailDto>("pim", `/masters/${masterId}`, {
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


