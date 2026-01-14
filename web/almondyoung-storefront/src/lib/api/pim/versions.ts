"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/api/api"
import type {
    VersionTreeResponseDto,
    ProductVersionDto,
    ProductDetailDto,
} from "@lib/types/dto/pim"

// 버전 목록 조회
export const getVersionList = async (
    masterId: string
): Promise<ApiResponse<VersionTreeResponseDto[]>> => {
    try {
        const result = await api<VersionTreeResponseDto[]>(
            "pim",
            `/masters/${masterId}/versions`,
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

// active 버전 조회
export const getActiveVersion = async (
    masterId: string
): Promise<ApiResponse<ProductVersionDto>> => {
    try {
        const result = await api<ProductVersionDto>(
            "pim",
            `/masters/${masterId}/versions/active`,
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

// 특정 버전 조회
export const getVersion = async (
    masterId: string,
    versionId: string
): Promise<ApiResponse<ProductDetailDto>> => {
    try {
        const result = await api<ProductDetailDto>(
            "pim",
            `/masters/${masterId}/versions/${versionId}`,
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


