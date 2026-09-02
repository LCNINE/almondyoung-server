import type {
  CreatePromotionPayload,
  PromotionRule,
  PromotionTargetRule,
} from '@/lib/api/domains/medusa/promotions';
import type { AutoIssueTrigger } from './coupon-meta';
import type { CouponVisibility } from '@packages/domain-types';

export type TargetAttribute = 'product_id' | 'product_category_id' | 'product_collection_id';

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
  /**
   * 정률 쿠폰 최대 할인금액 (#488 A4). 엔진에는 이 개념이 없어 `promotion_meta` 에 싣고
   * 카트 재계산 훅이 강제한다(`apps/medusa/src/workflows/hooks/cart/promotion-cap-hooks.ts`).
   */
  maxDiscountAmount: number | '';
  targetType: 'order' | 'items' | 'shipping_methods';
  targetAttribute: TargetAttribute;
  targetItemIds: string[];
  minOrderAmount: number | '';
  customerGroupIds: string[];
  startsAt: string;
  endsAt: string;
  /**
   * 발급된 한 장의 수명(일). #488 결정 1 의 «인스턴스 축». 비우면 만료는 `endsAt` 이 정한다.
   */
  validityDays: number | '';
  usageLimit: number | '';
  spendLimit: number | '';
  maxClaims: number | '';
  visibility: CouponVisibility;
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

  const additional_data: Record<string, unknown> = { visibility: form.visibility };
  if (name) additional_data.name = name;
  if (form.visibility === 'claimable' && form.maxClaims) {
    additional_data.max_claims = Number(form.maxClaims);
  }
  // 정률에만 싣는다 — 정액 쿠폰의 상한은 할인액 자신이라 의미가 없고,
  // 검증 스키마도 양수 정수만 받는다(`additional-data-schema.ts`).
  if (form.discountType === 'percentage' && form.maxDiscountAmount) {
    additional_data.max_discount_amount = Number(form.maxDiscountAmount);
  }
  if (form.createdBy) additional_data.created_by = form.createdBy;
  if (form.autoIssueTrigger) additional_data.auto_issue_trigger = form.autoIssueTrigger;
  // 유효기간 두 축 (#488 결정 1): 창은 promotion_meta 가 갖고, 캠페인 날짜는 쓰지 않는다.
  // 엔진의 listActivePromotions_ 가 캠페인 창이 지난 프로모션을 할인 계산에서 제외하기 때문에
  // 캠페인에 날짜를 실으면 「발급 후 N일」이 표현되지 않는다.
  if (form.startsAt) additional_data.starts_at = new Date(form.startsAt).toISOString();
  if (form.endsAt) additional_data.ends_at = new Date(form.endsAt).toISOString();
  // public 은 발급이라는 사건이 없어 validity_days 가 절대 안 쓰인다(computeExpiresAt 은
  // 발급 시점에만 돈다) — 안 쓰일 값을 저장하면 어드민 목록이 「발급 후 N일」을 거짓으로
  // 확인시켜준다. 쓰기 자체를 막는다(읽기 쪽 couponPeriodText 는 손대지 않는다).
  const isIssuedVisibility = form.visibility === 'claimable' || form.visibility === 'assigned_only';
  if (isIssuedVisibility && form.validityDays) {
    additional_data.validity_days = Number(form.validityDays);
  }

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
  // 그래야 예산 슬롯이 비어 총 할인금액 한도와 공존할 수 있다.
  const limit = form.usageLimit ? Number(form.usageLimit) : undefined;

  // 1장 = 1회는 이제 coupon_grant 가 강제한다(설계 §5.3) — 캠페인 예산의 use_by_attribute 를
  // 쓰지 않으므로 예산 슬롯이 「총 할인금액 한도」 하나에게 온전히 돌아간다.
  const budget = form.spendLimit
    ? { type: 'spend' as const, limit: Number(form.spendLimit), currency_code: 'krw' }
    : undefined;

  // 캠페인은 «예산이 필요할 때만» 만든다. 날짜만으로 만들면 CAMP_<code> 가 캠페인 탭을
  // 기계 생성 행으로 오염시킨다(#488 1-3).
  const hasCampaign = Boolean(budget);

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
      // 엔진은 target_type 이 items·shipping_methods 일 때 allocation 을 요구한다
      // (없으면 400). `across` 가 유일한 선택지다 — each·once 는 max_quantity 를 추가로
      // 요구하는데 그 입력란이 폼에 없다(#488 N5 의 미개봉 축). 입력란이 생기면 선택지가 열린다.
      ...(form.targetType === 'items' || form.targetType === 'shipping_methods'
        ? { allocation: 'across' as const }
        : {}),
      ...(target_rules ? { target_rules } : {}),
    },
    ...(hasCampaign
      ? {
          campaign: {
            name: name || code,
            // 코드 재사용(삭제 후 재생성) 시 campaign_identifier 충돌 방지
            campaign_identifier: `CAMP_${code}_${opts.campaignSuffix}`,
            ...(budget ? { budget } : {}),
          },
        }
      : {}),
    ...(rules.length > 0 ? { rules } : {}),
    additional_data,
  };
}
