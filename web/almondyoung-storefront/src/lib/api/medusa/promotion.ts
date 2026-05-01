"use server"

import { sdk } from "@/lib/config/medusa"
import { getAuthHeaders, getCacheOptions } from "@lib/data/cookies"
import type { PromotionsResponseDto } from "@lib/types/dto/promotion"
import medusaError from "@lib/utils/medusa-error"

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

  const next = {
    ...(await getCacheOptions("promotions")),
  }

  const query: Record<string, string> = {}
  if (params?.limit) query.limit = String(params.limit)
  if (params?.offset) query.offset = String(params.offset)

  return sdk.client
    .fetch<PromotionsResponseDto>(`/store/customers/me/promotions`, {
      method: "GET",
      query,
      headers,
      next,
      cache: "force-cache",
    })
    .catch(medusaError)
}
