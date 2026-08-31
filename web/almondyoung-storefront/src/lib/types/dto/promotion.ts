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
  /**
   * 이 브랜치부터 서버가 더는 채우지 않는다(`format-promotion.ts` 가 항상 `null` 로 내려보낸다) —
   * 유효기간의 정본은 `PromotionDto.expires_at` 이다(#488 결정 1). 필드 자체는 옛 응답 캐시·
   * 아직 안 바뀐 배포 태스크와의 호환을 위해 남아 있다.
   */
  starts_at: string | null
  ends_at: string | null
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
  /** 정률 쿠폰 최대 할인금액 (#488 A4). 상한이 없으면 `null`. */
  max_discount_amount?: number | null
  /**
   * 이 쿠폰이 언제까지 쓸 수 있는가 (#488 결정 1). 발급된 쿠폰이면 «받은 한 장»의 만료이고,
   * 아니면 정책의 종료일이다. `null` 이면 무기한.
   *
   * ⚠️ `campaign.ends_at` 을 대체한다 — 캠페인 날짜는 서버가 더 이상 채우지 않는다.
   */
  expires_at?: string | null
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
