"use server"

import {
    calculateMasterPrice,
    getMasterPriceSet,
    type CalculatePriceRequest,
    type CalculatePriceResponse,
    type VariantPriceSet,
} from "@lib/api/pim/pricing.server"

/**
 * 옵션 선택 시 실시간 가격 계산 서비스
 * 
 * 사용 예시:
 * - 상품 상세 페이지에서 옵션 선택 시
 * - 수량 변경 시
 * - 회원/비회원 전환 시
 */
export async function calculateProductPrice(
    masterId: string,
    variantId: string,
    quantity: number,
    isMembership: boolean = false
): Promise<{
    price: number
    totalPrice: number
    breakdown?: {
        basePrice: number
        membershipDiscount?: number
        tieredDiscount?: number
    }
    error?: string
}> {
    try {
        const result = await calculateMasterPrice(masterId, {
            variantId,
            quantity,
            customerType: isMembership ? "membership" : "regular",
        })

        if ("error" in result) {
            return {
                price: 0,
                totalPrice: 0,
                error: result.error.message,
            }
        }

        const data = result.data

        // 가격 breakdown 계산
        const basePrice = data.priceBreakdown.afterBasePrice
        const membershipPrice = data.priceBreakdown.afterMembershipPrice
        const finalPrice = data.price

        return {
            price: finalPrice,
            totalPrice: data.totalPrice,
            breakdown: {
                basePrice,
                membershipDiscount: isMembership ? basePrice - membershipPrice : undefined,
                tieredDiscount: quantity > 1 ? membershipPrice - finalPrice : undefined,
            },
        }
    } catch (error) {
        console.error("[calculateProductPrice] 에러:", error)
        return {
            price: 0,
            totalPrice: 0,
            error: "가격 계산 중 오류가 발생했습니다.",
        }
    }
}

/**
 * 상품의 모든 가격 옵션 조회 서비스
 * 
 * 사용 예시:
 * - 상품 상세 페이지 로드 시 모든 가격 정보 표시
 * - 가격 비교 (기본가 vs 멤버십가)
 */
export async function getProductPriceSet(
    masterId: string,
    variantId: string
): Promise<{
    basePrice: number
    membershipPrice?: number
    tieredPrices?: Array<{ minQuantity: number; price: number }>
    discountRate?: number
    error?: string
}> {
    try {
        const result = await getMasterPriceSet(masterId, variantId)

        if ("error" in result) {
            return {
                basePrice: 0,
                error: result.error.message,
            }
        }

        const data = result.data

        // 할인율 계산 (기본가 대비 멤버십가)
        const discountRate = data.membershipPrice
            ? Math.round(((data.basePrice - data.membershipPrice) / data.basePrice) * 100)
            : undefined

        return {
            basePrice: data.basePrice,
            membershipPrice: data.membershipPrice,
            tieredPrices: data.tieredPrices,
            discountRate,
        }
    } catch (error) {
        console.error("[getProductPriceSet] 에러:", error)
        return {
            basePrice: 0,
            error: "가격 정보 조회 중 오류가 발생했습니다.",
        }
    }
}

/**
 * 여러 Variant의 가격 범위 계산
 * 
 * 사용 예시:
 * - 상품 목록에서 "₩10,000 ~ ₩50,000" 형태로 표시
 * 
 * TODO:
 * - 현재 구현: variant마다 개별 API 호출 (병렬 처리)
 * - Variant가 많을 경우 네트워크 비용 증가
 * - 개선 방안: 백엔드에 batch 가격 계산 API 추가 권장
 *   (예: POST /masters/:masterId/pricing/calculate-batch)
 * 
 * 임시
 * - Variant 수가 많을 경우 대표 variant 몇 개만 샘플링
 * - 또는 첫 번째/마지막 variant만 사용하여 근사값 표시
 */
export async function calculatePriceRange(
    masterId: string,
    variantIds: string[],
    isMembership: boolean = false
): Promise<{
    minPrice: number
    maxPrice: number
    error?: string
}> {
    try {
        if (variantIds.length === 0) {
            return { minPrice: 0, maxPrice: 0 }
        }

        // 성능 최적화: variant가 많을 경우 샘플링 (최대 10개)
        const sampleIds =
            variantIds.length > 10
                ? [
                    variantIds[0], // 첫 번째
                    ...variantIds.slice(1, 9), // 중간 샘플
                    variantIds[variantIds.length - 1], // 마지막
                ]
                : variantIds

        // 모든 variant의 가격 조회 (병렬 처리)
        const pricePromises = sampleIds.map((variantId) =>
            calculateProductPrice(masterId, variantId, 1, isMembership)
        )

        const results = await Promise.all(pricePromises)

        // 에러가 있는 경우 첫 번째 에러 반환
        const errorResult = results.find((r) => r.error)
        if (errorResult) {
            return {
                minPrice: 0,
                maxPrice: 0,
                error: errorResult.error,
            }
        }

        const prices = results.map((r) => r.price).filter((p) => p > 0)

        if (prices.length === 0) {
            return { minPrice: 0, maxPrice: 0 }
        }

        return {
            minPrice: Math.min(...prices),
            maxPrice: Math.max(...prices),
        }
    } catch (error) {
        console.error("[calculatePriceRange] 에러:", error)
        return {
            minPrice: 0,
            maxPrice: 0,
            error: "가격 범위 계산 중 오류가 발생했습니다.",
        }
    }
}

