/**
 * 스토어 쿠폰 목록 응답의 한 항목을 만든다.
 *
 * 라우트 핸들러가 아니라 이 파일에 사는 이유: Medusa 의 유닛 게이트가
 * `__tests__/*.unit.spec.ts` 패턴만 돌리므로, 클로저로 두면 「무엇이 나가는가」가
 * 검증 대상 밖이다. 응답 모양은 계약이고, 계약은 테스트가 지켜야 한다.
 *
 * **`metadata` 를 내리지 않는 것은 의도다 (#488 N2).** 어드민 응답의 `metadata` 는 우리가
 * `promotion_meta` 에서 합성한 것이고, 여기서 같은 이름으로 나가던 것은 Medusa 네이티브 json
 * 컬럼이었다. 그 컬럼에 쓰는 코드가 0곳이라 값은 늘 `null` 이었고, 「스토어엔 메타가 없다」는
 * 정반대 진단을 유도했다. 스토어에 필요한 메타 정보는 최상위 `visibility` 하나뿐이므로 그것만
 * 내보내고, 네이티브 컬럼은 나중에 쓸 수 있게 이름을 비워 둔다.
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
  min_order_amount: number | null;
  /**
   * 정률 쿠폰 최대 할인금액 (#488 A4). `promotion_meta` 에서 온다 — 엔진에는 이 개념이 없다.
   * `visibility` 와 같은 이유로 **최상위**에 둔다: `application_method` 는 엔진 필드를 그대로
   * 옮기는 자리이고, 여기 우리 확장을 섞으면 「엔진이 준 것」과 「우리가 붙인 것」이 안 갈린다.
   */
  max_discount_amount: number | null;
  visibility: string;
  /**
   * 이 쿠폰이 언제까지 쓸 수 있는가 (#488 결정 1). `campaign.ends_at` 을 대체한다 —
   * 캠페인 날짜는 더 이상 쓰지 않는다. `null` 이면 무기한 **이거나**, 미발급
   * `validity_days` 쿠폰이라 아직 만료일이 정해지지 않은 상태다(W1) — 그 구분은
   * `validity_days` 필드로 한다.
   */
  expires_at: string | Date | null;
  /**
   * 발급일로부터 며칠간 유효한가 (W1, 2026-08-31). `expires_at` 이 null 인데 이 값이
   * 있으면 「무기한」이 아니라 「아직 발급 안 받아서 만료일 미정, 받으면 이 값만큼 유효」다.
   * 화면이 「발급 후 N일」을 표시할 수 있게 노출한다.
   */
  validity_days: number | null;
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

/** `promotion_meta` 에서 온 값들. 호출부가 프로모션마다 조회하지 않도록 묶어서 받는다. */
export type PromotionMetaView = {
  visibility: string;
  maxDiscountAmount: number | null;
  /**
   * 이 고객에게 이 쿠폰이 언제까지인가. **발급된 장이면 링크 행의 값**, 아니면 정책의 `ends_at`.
   * 호출부가 링크를 한 번에 조회해 넣는다 — 프로모션마다 조회하지 않는다.
   */
  expiresAt: string | Date | null;
  /** 정책의 `validity_days` 그대로. `expiresAt` 이 null 인 이유를 화면이 구분할 수 있게. */
  validityDays: number | null;
};

export function formatPromotion(
  promo: PromotionLike,
  isAssigned: boolean,
  meta: PromotionMetaView,
): FormattedPromotion {
  return {
    id: promo.id,
    code: promo.code,
    type: promo.type,
    status: promo.status,
    is_automatic: promo.is_automatic,
    is_assigned: isAssigned,
    min_order_amount: minOrderAmount(promo),
    max_discount_amount: meta.maxDiscountAmount,
    visibility: meta.visibility,
    expires_at: meta.expiresAt,
    validity_days: meta.validityDays,
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
          // 이 플랜이 그래프 필드 목록에서 campaign.starts_at/ends_at 을 뺐다 — 값은 항상
          // undefined 로 들어온다. `?? null` 없이 두면 JSON 직렬화가 키를 통째로 지워
          // 응답 모양이 조용히 바뀐다. 응답 shape 을 오늘과 동일하게 유지하기 위한 것.
          starts_at: promo.campaign.starts_at ?? null,
          ends_at: promo.campaign.ends_at ?? null,
        }
      : null,
  };
}
