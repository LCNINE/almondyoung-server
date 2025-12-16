"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/types/common/users"
import type {
    CategoryTreeResponseDto,
    CategoryDetailResponseDto,
    CategoryResponseDto,
    CategoryPathResponseDto,
    CategoryTreeNodeDto,
} from "@lib/types/dto/pim"

// 카테고리 트리 조회
export const getCategoryTree = async (
    maxDepth?: number
): Promise<ApiResponse<CategoryTreeResponseDto>> => {
    try {
        const queryParams: Record<string, string> = {}
        if (maxDepth !== undefined) queryParams.maxDepth = maxDepth.toString()

        const result = await api<CategoryTreeResponseDto>("pim", "/categories", {
            method: "GET",
            params: queryParams,
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

// 카테고리 상세 조회
export const getCategoryById = async (
    id: string
): Promise<ApiResponse<CategoryDetailResponseDto>> => {
    try {
        const result = await api<CategoryDetailResponseDto>(
            "pim",
            `/categories/${id}`,
            {
                method: "GET",
                withAuth: false,
            }
        )

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

// 하위 카테고리 조회
export const getChildCategories = async (
    id: string
): Promise<ApiResponse<CategoryResponseDto[]>> => {
    try {
        const result = await api<CategoryResponseDto[]>(
            "pim",
            `/categories/${id}/children`,
            {
                method: "GET",
                withAuth: false,
            }
        )

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

// 카테고리 경로 조회
export const getCategoryPath = async (
    id: string
): Promise<ApiResponse<CategoryPathResponseDto>> => {
    try {
        const result = await api<CategoryPathResponseDto>(
            "pim",
            `/categories/${id}/path`,
            {
                method: "GET",
                withAuth: false,
            }
        )

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


// slug로 카테고리 찾기
export const getCategoryBySlug = async (
    slug: string
): Promise<ApiResponse<CategoryTreeNodeDto | null>> => {
    try {
        const result = await getCategoryTree()
        if ("error" in result) {
            return { error: result.error }
        }

        const findNodeBySlug = (
            nodes: CategoryTreeNodeDto[],
            targetSlug: string
        ): CategoryTreeNodeDto | null => {
            for (const node of nodes) {
                if (node.slug === targetSlug) return node
                if (node.children) {
                    const found = findNodeBySlug(node.children, targetSlug)
                    if (found) return found
                }
            }
            return null
        }

        const found = findNodeBySlug(result.data.categories, slug)
        return { data: found }
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

