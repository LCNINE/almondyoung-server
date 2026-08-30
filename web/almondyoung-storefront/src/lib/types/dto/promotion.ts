/*───────────────────────────
 * Application Method (할인 방식)
 *──────────────────────────*/
export type ApplicationMethodDto = {
  type: "percentage" | "fixed"
  value: number
  target_type: "order" | "items" | "shipping_methods"
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
  /**
   * 어휘 정본은 `@packages/domain-types` 의 `CouponVisibility` 다. 여기서 import 하지 않는 것은
   * 이 필드를 읽는 코드가 storefront 에 0곳이라 의존성을 더할 이익이 없어서다.
   * 정본과 어긋나면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 잡는다.
   */
  visibility?: "public" | "claimable" | "assigned_only"
  min_order_amount?: number | null
  application_method: ApplicationMethodDto
  campaign: PromotionCampaignDto | null
}

/*───────────────────────────
 * Promotions Response (프로모션 목록 응답)
 *──────────────────────────*/
export type PromotionsResponseDto = {
  promotions: PromotionDto[]
  claimable_promotions: PromotionDto[]
  expired_promotions?: PromotionDto[]
  count: number
  offset: number
  limit: number
}
