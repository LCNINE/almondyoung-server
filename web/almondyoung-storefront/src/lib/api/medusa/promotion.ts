"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders } from "@lib/data/cookies"
import type { PromotionsResponseDto } from "@lib/types/dto/promotion"
import medusaError from "@lib/utils/medusa-error"
import { ApiAuthError } from "@lib/api/api-error"

/** 401은 error.tsx 토큰 복구가 인식하도록 digest를 실어 던진다. 그 외는 medusaError. */
function throwPromotionError(error: any): never {
  if (error?.status === 401) throw new ApiAuthError()
  medusaError(error)
}

/**
 * 내 프로모션(쿠폰) 목록 조회
 * GET /store/customers/me/promotions
 */
export async function getMyPromotions(params?: {
  limit?: number
  offset?: number
}): Promise<PromotionsResponseDto> {
  const headers = {
    ...(await getAuthHeaders()),
  }

  const query: Record<string, string> = {}
  if (params?.limit) query.limit = String(params.limit)
  if (params?.offset) query.offset = String(params.offset)

  return sdk.client
    .fetch<PromotionsResponseDto>(`/store/customers/me/promotions`, {
      method: "GET",
      query,
      headers,
      cache: "no-store",
    })
    .catch(throwPromotionError)
}

/**
 * 쿠폰 발급받기 (claimable 쿠폰만 가능)
 * POST /store/customers/me/promotions/:id/claim
 */
export async function claimCoupon(promotionId: string): Promise<void> {
  const headers = {
    ...(await getAuthHeaders()),
  }

  await sdk.client
    .fetch(`/store/customers/me/promotions/${promotionId}/claim`, {
      method: "POST",
      headers,
    })
    // 401 은 UNAUTHORIZED digest 로 던져 마이페이지 클레임도 토큰 복구 플로우를 태운다.
    .catch(throwPromotionError)
}
