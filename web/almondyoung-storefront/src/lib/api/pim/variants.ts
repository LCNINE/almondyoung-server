"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/api/api"
import type {
  VariantListResponseDto,
  VariantWithPriceDto,
} from "@lib/types/dto/pim"

// variant 목록 조회 (master id 기반)
export const getVariantsByMaster = async (
  masterId: string,
  options?: {
    includePrice?: boolean
    status?: string
    page?: number
    limit?: number
  }
): Promise<ApiResponse<VariantListResponseDto>> => {
  try {
    const queryParams: Record<string, string> = {}
    if (options?.includePrice !== undefined)
      queryParams.includePrice = options.includePrice.toString()
    if (options?.status) queryParams.status = options.status
    if (options?.page) queryParams.page = options.page.toString()
    if (options?.limit) queryParams.limit = options.limit.toString()

    const result = await api<VariantListResponseDto>(
      "pim",
      `/variants/masters/${masterId}`,
      {
        method: "GET",
        params: queryParams,
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

// variant 목록 조회 (version id 기반)
export const getVariantsByVersion = async (
  masterId: string,
  versionId: string,
  options?: {
    includePrice?: boolean
    status?: string
    page?: number
    limit?: number
  }
): Promise<ApiResponse<VariantListResponseDto>> => {
  try {
    const queryParams: Record<string, string> = {}
    if (options?.includePrice !== undefined)
      queryParams.includePrice = options.includePrice.toString()
    if (options?.status) queryParams.status = options.status
    if (options?.page) queryParams.page = options.page.toString()
    if (options?.limit) queryParams.limit = options.limit.toString()

    const result = await api<VariantListResponseDto>(
      "pim",
      `/variants/masters/${masterId}/versions/${versionId}`,
      {
        method: "GET",
        params: queryParams,
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

// variant 상세 조회
export const getVariant = async (
  variantId: string,
  options?: {
    versionId?: string
    masterId?: string
  }
): Promise<ApiResponse<VariantWithPriceDto>> => {
  try {
    const queryParams: Record<string, string> = {}
    if (options?.versionId) queryParams.versionId = options.versionId
    if (options?.masterId) queryParams.masterId = options.masterId

    const result = await api<VariantWithPriceDto>(
      "pim",
      `/variants/${variantId}`,
      {
        method: "GET",
        params: queryParams,
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
