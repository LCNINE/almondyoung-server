/*───────────────────────────
 * Application Method (할인 방식)
 *──────────────────────────*/
export type ApplicationMethodDto = {
  type: "percentage" | "fixed"
  value: number
  target_type: "order" | "items" | "shipping"
  max_quantity: number | null
  currency_code: string | null
}

/*───────────────────────────
 * Promotion Campaign (캠페인 정보)
 *──────────────────────────*/
export type PromotionCampaignDto = {
  campaign_identifier: string
  starts_at: string
  ends_at: string
}

/*───────────────────────────
 * Promotion (프로모션/쿠폰)
 *──────────────────────────*/
export type PromotionDto = {
  id: string
  code: string
  type: string
  status: string
  is_automatic: boolean
  is_assigned: boolean
  application_method: ApplicationMethodDto
  campaign: PromotionCampaignDto | null
}

/*───────────────────────────
 * Promotions Response (프로모션 목록 응답)
 *──────────────────────────*/
export type PromotionsResponseDto = {
  promotions: PromotionDto[]
  count: number
  offset: number
  limit: number
}
