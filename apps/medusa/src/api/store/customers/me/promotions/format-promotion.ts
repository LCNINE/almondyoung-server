/**
 * 스토어 쿠폰 목록 응답의 한 항목을 만든다.
 *
 * 라우트 핸들러가 아니라 이 파일에 사는 이유: Medusa 의 유닛 게이트가
 * `src/**\/__tests__/*.unit.spec.ts` 만 돌리므로, 클로저로 두면 「무엇이 나가는가」가
 * 검증 대상 밖이다. 응답 모양은 계약이고, 계약은 테스트가 지켜야 한다.
 */

export type PromotionRuleValue = string | { value?: string | null } | null | undefined;

export type PromotionRuleLike = {
  attribute?: string | null;
  operator?: string | null;
  values?: PromotionRuleValue[] | null;
};

// 그래프 필드 목록(`route.ts` 의 `promotionFields`)이 항상 선택하는 것들이라 optional 로 두지
// 않는다 — optional 로 두면 매퍼가 `as` 캐스팅으로 되돌려야 한다.
export type ApplicationMethodLike = {
  id: string;
  type: string;
  value: number;
  target_type: string;
  max_quantity: number | null;
  currency_code: string | null;
};

export type CampaignLike = {
  campaign_identifier: string;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
};

export type PromotionLike = {
  id: string;
  code: string;
  type: string;
  status: string;
  is_automatic: boolean;
  metadata?: Record<string, unknown> | null;
  rules?: PromotionRuleLike[] | null;
  application_method?: ApplicationMethodLike | null;
  campaign?: CampaignLike | null;
};

export type FormattedPromotion = {
  id: string;
  code: string;
  type: string;
  status: string;
  is_automatic: boolean;
  is_assigned: boolean;
  metadata: Record<string, unknown> | null;
  min_order_amount: number | null;
  visibility: string;
  application_method: ApplicationMethodLike | null;
  campaign: CampaignLike | null;
};

/**
 * 최소 주문 금액(subtotal gte rule) 추출 — 마이페이지 "최소주문금액 낮은순" 정렬용.
 * 룰 값은 그래프 결과에 따라 문자열이거나 `{ value }` 객체다.
 */
function minOrderAmount(promo: PromotionLike): number | null {
  const rule = (promo.rules ?? []).find((r) => r?.attribute === 'subtotal' && r?.operator === 'gte');
  if (!rule) return null;
  const raw = rule.values?.[0];
  const val = Number(typeof raw === 'string' ? raw : raw?.value);
  return Number.isFinite(val) ? val : null;
}

export function formatPromotion(promo: PromotionLike, isAssigned: boolean, visibility: string): FormattedPromotion {
  return {
    id: promo.id,
    code: promo.code,
    type: promo.type,
    status: promo.status,
    is_automatic: promo.is_automatic,
    is_assigned: isAssigned,
    metadata: promo.metadata ?? null,
    min_order_amount: minOrderAmount(promo),
    visibility,
    application_method: promo.application_method
      ? {
          // 필드를 하나씩 옮긴다 — 그래프가 더 실어 보내도 스토어 응답에 새지 않게.
          id: promo.application_method.id,
          type: promo.application_method.type,
          value: promo.application_method.value,
          target_type: promo.application_method.target_type,
          max_quantity: promo.application_method.max_quantity ?? null,
          currency_code: promo.application_method.currency_code ?? null,
        }
      : null,
    campaign: promo.campaign
      ? {
          campaign_identifier: promo.campaign.campaign_identifier,
          starts_at: promo.campaign.starts_at,
          ends_at: promo.campaign.ends_at,
        }
      : null,
  };
}
