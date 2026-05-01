import type {
  ApplicationMethodDto,
  PromotionCampaignDto,
  PromotionDto,
} from "../dto/promotion"

/*───────────────────────────
 * Application Method (할인 방식)
 *──────────────────────────*/
export interface ApplicationMethod extends ApplicationMethodDto {}

/*───────────────────────────
 * Promotion Campaign (캠페인 정보)
 *──────────────────────────*/
export interface PromotionCampaign extends PromotionCampaignDto {}

/*───────────────────────────
 * Promotion (프로모션/쿠폰)
 *──────────────────────────*/
export interface Promotion extends PromotionDto {}
