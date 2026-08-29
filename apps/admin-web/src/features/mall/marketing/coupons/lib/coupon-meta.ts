import type { MedusaPromotion } from '@/lib/api/domains/medusa/promotions';
import { type CouponVisibility, toCouponVisibility } from '@packages/domain-types';

/**
 * 쿠폰 자동발급 트리거 어휘.
 *
 * 정본은 Medusa 의 `apps/medusa/src/modules/promotion-meta/service.ts` 이고 여기는 **사본**이다
 * — 공유 타입으로 합치지 않기로 한 것은 ADR-0033 §7 의 결정이다(실사용 0). 사본이 정본과
 * 어긋나면 `packages/domain-types/coupon-vocabulary-drift.spec.ts` 가 빨개진다.
 */
export const AUTO_ISSUE_TRIGGERS = ['customer_registered', 'membership_activated', 'birthday'] as const;

export type AutoIssueTrigger = (typeof AUTO_ISSUE_TRIGGERS)[number];

export const AUTO_ISSUE_TRIGGER_LABELS: Record<AutoIssueTrigger, string> = {
  customer_registered: '회원가입 완료',
  membership_activated: '멤버십 가입',
  birthday: '생일 (미구현 — 발급되지 않음)',
};

/** 어휘 밖 값은 `null`. 그대로 통과시키면 라벨 조회가 `undefined` 를 렌더한다. */
export function toAutoIssueTrigger(value: unknown): AutoIssueTrigger | null {
  return typeof value === 'string' && (AUTO_ISSUE_TRIGGERS as readonly string[]).includes(value)
    ? (value as AutoIssueTrigger)
    : null;
}

export interface CouponMeta {
  name: string | undefined;
  maxDiscountAmount: number | null;
  maxClaims: number | null;
  issuedCount: number | null;
  createdBy: string | undefined;
  /**
   * `null` = 서버가 우리 어휘 밖의 값을 보냈다. **«공개» 로 접지 않는다** — 제한 쿠폰이
   * 관리자 눈에 공개로 보이던 것이 #488 N3 이다. 표시는 `visibilityBadge` 가 맡는다.
   */
  visibility: CouponVisibility | null;
  autoIssueTrigger: AutoIssueTrigger | null;
}

/**
 * 어드민 프로모션 응답의 `metadata`(우리가 `promotion_meta` 에서 **합성한 것**)를 화면이 쓰는
 * 모양으로 옮긴다. 스토어 응답의 `metadata` 와는 다른 물건이다 — ADR-0033 결정 5 참조.
 *
 * `.tsx` 가 아니라 `.ts` 에 사는 이유: admin-web 의 jest transform 이 `^.+\.(t|j)s$` 라
 * `.tsx` 안의 판정은 테스트가 실행조차 되지 않는다.
 */
export function getCouponMeta(coupon: MedusaPromotion): CouponMeta {
  const meta = (coupon.metadata ?? {}) as Record<string, unknown>;
  return {
    name: meta.name as string | undefined,
    maxDiscountAmount: meta.max_discount_amount != null ? Number(meta.max_discount_amount) : null,
    maxClaims: meta.max_claims != null ? Number(meta.max_claims) : null,
    issuedCount: meta.issued_count != null ? Number(meta.issued_count) : null,
    createdBy: meta.created_by as string | undefined,
    visibility: toCouponVisibility(meta.visibility),
    autoIssueTrigger: toAutoIssueTrigger(meta.auto_issue_trigger),
  };
}
