"use server"

import { api } from "@lib/api/api"
import { ApiNetworkError, HttpApiError } from "@lib/api/api-error"
import type { ApiResponse } from "@lib/types/common/users"
import type {
    PricingRulesResponseDto,
    CalculatePriceRequestDto,
    CalculatePriceResponseDto,
    VariantPriceSetDto,
} from "@lib/types/dto/pim.dto"


// 가격 규칙 조회
export const getMasterPricingRules = async (
    masterId: string
): Promise<ApiResponse<PricingRulesResponseDto>> => {
    try {
        const result = await api<PricingRulesResponseDto>(
            "pim",
            `/masters/${masterId}/pricing/rules`,
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

// 가격 계산
export const calculateMasterPrice = async (
    masterId: string,
    data: CalculatePriceRequestDto
): Promise<ApiResponse<CalculatePriceResponseDto>> => {
    try {
        const result = await api<CalculatePriceResponseDto>(
            "pim",
            `/masters/${masterId}/pricing/calculate`,
            {
                method: "POST",
                body: data,
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

// 가격 세트 조회
export const getMasterPriceSet = async (
    masterId: string,
    variantId: string
): Promise<ApiResponse<VariantPriceSetDto>> => {
    try {
        const result = await api<VariantPriceSetDto>(
            "pim",
            `/masters/${masterId}/pricing/price-set`,
            {
                method: "GET",
                params: { variantId },
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


