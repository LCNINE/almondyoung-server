import type {
  CreatePromotionPayload,
  PromotionRule,
  PromotionTargetRule,
} from '@/lib/api/domains/medusa/promotions';
import type { AutoIssueTrigger } from '../coupon-helpers';

export type TargetAttribute = 'product_id' | 'product_category_id' | 'product_collection_id';
export type Visibility = 'public' | 'claimable' | 'assigned_only';

// Medusa 라인아이템 컨텍스트가 노출하는 실제 경로로 매핑한다.
// 플랫 키(product_category_id 등)는 라인아이템에 없어 룰이 절대 매칭되지 않음.
const TARGET_ATTR_TO_MEDUSA: Record<TargetAttribute, PromotionTargetRule['attribute']> = {
  product_id: 'items.product.id',
  product_category_id: 'items.product.categories.id',
  product_collection_id: 'items.product.collection_id',
};

export interface CouponFormState {
  code: string;
  name: string;
  discountType: 'percentage' | 'fixed';
  value: number;
  targetType: 'order' | 'items' | 'shipping_methods';
  targetAttribute: TargetAttribute;
  targetItemIds: string[];
  minOrderAmount: number | '';
  customerGroupIds: string[];
  startsAt: string;
  endsAt: string;
  usageLimit: number | '';
  spendLimit: number | '';
  maxUsesPerCustomer: number | '';
  maxClaims: number | '';
  visibility: Visibility;
  autoIssueTrigger: AutoIssueTrigger | '';
  createdBy?: string;
}

/**
 * 폼 상태를 Medusa `POST /admin/promotions` 페이로드로 변환한다.
 *
 * 순수 함수다 — `Date.now()` 를 안에서 부르지 않고 `opts.campaignSuffix` 로 주입받는다.
 * 다이얼로그가 `.tsx` 라 jest transform 밖이므로, 판정 로직은 전부 이 파일에 있어야 검증된다.
 */
export function buildCreatePromotionPayload(
  form: CouponFormState,
  opts: { campaignSuffix: string },
): CreatePromotionPayload {
  const code = form.code.trim().toUpperCase();
  const name = form.name.trim();

  // 총 할인금액(spend)과 1인당 한도(use_by_attribute)는 둘 다 캠페인의 유일한 예산 슬롯을
  // 요구한다(Campaign.budget 은 hasOne). 엔진 제약이므로 조용히 버리지 않고 알린다.
  if (form.spendLimit && form.maxUsesPerCustomer) {
    throw new Error('총 할인금액 한도와 1인당 사용 한도는 동시에 설정할 수 없습니다');
  }

  // 1인당 한도는 campaign budget(use_by_attribute)로만 관리 — promotion_meta 컬럼은 제거됨
  const additional_data: Record<string, unknown> = { visibility: form.visibility };
  if (name) additional_data.name = name;
  if (form.visibility === 'claimable' && form.maxClaims) {
    additional_data.max_claims = Number(form.maxClaims);
  }
  if (form.createdBy) additional_data.created_by = form.createdBy;
  if (form.autoIssueTrigger) additional_data.auto_issue_trigger = form.autoIssueTrigger;

  const target_rules: PromotionTargetRule[] | undefined =
    form.targetType === 'items' && form.targetItemIds.length > 0
      ? [{
          attribute: TARGET_ATTR_TO_MEDUSA[form.targetAttribute],
          operator: 'in',
          values: form.targetItemIds,
        }]
      : undefined;

  const rules: PromotionRule[] = [
    ...(form.minOrderAmount
      ? [{ attribute: 'subtotal', operator: 'gte' as const, values: [String(form.minOrderAmount)] }]
      : []),
    ...(form.customerGroupIds.length > 0
      ? [{ attribute: 'customer.groups.id', operator: 'in' as const, values: form.customerGroupIds }]
      : []),
  ];

  // 전역 사용 횟수는 campaign budget 이 아니라 promotion.limit 으로 보낸다.
  // 그래야 예산 슬롯이 비어 1인당 한도 또는 총 할인금액 한도와 공존할 수 있다.
  const limit = form.usageLimit ? Number(form.usageLimit) : undefined;

  const budget = form.maxUsesPerCustomer
    ? { type: 'use_by_attribute' as const, attribute: 'customer_id', limit: Number(form.maxUsesPerCustomer) }
    : form.spendLimit
    ? { type: 'spend' as const, limit: Number(form.spendLimit), currency_code: 'krw' }
    : undefined;

  const hasCampaign = Boolean(form.startsAt || form.endsAt || budget);

  return {
    code,
    type: 'standard',
    is_automatic: false,
    ...(limit !== undefined ? { limit } : {}),
    // draft는 체크아웃에서 적용 안 됨
    status: 'active',
    application_method: {
      type: form.discountType,
      value: form.value,
      target_type: form.targetType,
      // 정액 할인은 항상 통화가 필요하고, 정률이라도 총 할인금액(spend budget) 을 쓰면
      // 엔진이 campaign.budget.currency_code 와 application_method.currency_code 일치를
      // 요구한다(@medusajs/promotion promotion-module.js 의 SPEND 분기) — 안 실으면 400.
      ...(form.discountType === 'fixed' || form.spendLimit ? { currency_code: 'krw' } : {}),
      ...(form.targetType === 'items' ? { allocation: 'across' as const } : {}),
      ...(target_rules ? { target_rules } : {}),
    },
    ...(hasCampaign
      ? {
          campaign: {
            name: name || code,
            // 코드 재사용(삭제 후 재생성) 시 campaign_identifier 충돌 방지
            campaign_identifier: `CAMP_${code}_${opts.campaignSuffix}`,
            ...(form.startsAt ? { starts_at: new Date(form.startsAt).toISOString() } : {}),
            ...(form.endsAt ? { ends_at: new Date(form.endsAt).toISOString() } : {}),
            ...(budget ? { budget } : {}),
          },
        }
      : {}),
    ...(rules.length > 0 ? { rules } : {}),
    additional_data,
  };
}
