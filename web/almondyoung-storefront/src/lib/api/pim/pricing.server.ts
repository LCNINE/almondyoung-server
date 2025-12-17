"use server"

import { api } from "@lib/api/api"
import type { ApiResponse } from "@lib/api/api"

// ===== 요청/응답 타입 =====

export interface CalculatePriceRequest {
    variantId: string
    quantity: number
    customerType?: "regular" | "membership"
}

export interface PriceRuleApplication {
    ruleId: string
    layer: "base_price" | "membership_price" | "tiered_price"
    order: number
    scopeType: "all_variants" | "with_option" | "variants"
    operationType: "offset" | "scale" | "override"
    operationValue: number
    priceBeforeRule: number
    priceAfterRule: number
}

export interface PriceBreakdown {
    initialPrice: number
    afterBasePrice: number
    afterMembershipPrice: number
    afterTieredPrice: number
}

export interface CalculatePriceResponse {
    variantId: string
    price: number
    totalPrice: number
    appliedRules: PriceRuleApplication[]
    priceBreakdown: PriceBreakdown
}

export interface VariantPriceSet {
    basePrice: number
    membershipPrice?: number
    tieredPrices?: Array<{
        minQuantity: number
        price: number
    }>
}

// ===== 서버 액션 =====

/**
 * Master의 Active 버전 기준으로 가격 계산
 * 옵션 선택 시 실시간 가격 표시용
 * 
 * @param masterId - Master ID
 * @param request - 가격 계산 요청 (variantId, quantity, customerType)
 * @returns 계산된 가격 정보
 */
export async function calculateMasterPrice(
    masterId: string,
    request: CalculatePriceRequest
): Promise<ApiResponse<CalculatePriceResponse>> {
    try {
        const result = await api<CalculatePriceResponse>(
            "pim",
            `/masters/${masterId}/pricing/calculate`,
            {
                method: "POST",
                body: request,
                withAuth: false, // 공개 API (인증 불필요)
            }
        )

        return { data: result }
    } catch (error: any) {
        return {
            error: {
                message: error.message || "가격 계산에 실패했습니다.",
                status: error.status || 500,
            },
        }
    }
}

/**
 * Master의 Active 버전 기준으로 완전한 가격 세트 조회
 * 상품 상세 페이지에서 모든 가격 옵션 표시용
 * 
 * @param masterId - Master ID
 * @param variantId - Variant ID
 * @returns 기본가/멤버십가/수량별 가격
 */
export async function getMasterPriceSet(
    masterId: string,
    variantId: string
): Promise<ApiResponse<VariantPriceSet>> {
    try {
        const result = await api<VariantPriceSet>(
            "pim",
            `/masters/${masterId}/pricing/price-set`,
            {
                method: "GET",
                params: { variantId },
                withAuth: false, // 공개 API (인증 불필요)
            }
        )

        return { data: result }
    } catch (error: any) {
        return {
            error: {
                message: error.message || "가격 정보 조회에 실패했습니다.",
                status: error.status || 500,
            },
        }
    }
}
