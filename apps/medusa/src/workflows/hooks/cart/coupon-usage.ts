import { Modules } from '@medusajs/framework/utils';

/**
 * 「이 주문에 어떤 쿠폰이 쓰였나」를 링크 행에 남기는 **순수 조립 로직** (#488 N4 → A2).
 *
 * ⚠️⚠️ **이 함수는 링크 행을 절대 생성하지 않는다 — 이미 발급된(=이미 링크 행이 있는) 쌍만
 * 갱신한다.** `issuedPromotionIds` 로 거르는 그 `.filter` 한 줄이 그 불변식이다. 지우면
 * 무슨 일이 나는지: `public` 쿠폰은 발급이라는 사건이 없어 링크 행이 애초에 없다. 그런데
 * `Link.create` 는 upsert 라 `(customer_id, promotion_id)` 쌍에 행이 없으면 그 자리에서
 * **INSERT** 한다(§2 ⓑ). 즉 필터를 지우면 「public 쿠폰을 한 번이라도 결제한 고객」 전원에게
 * 그 쿠폰의 인스턴스 링크가 새로 생기고, 이 함수는 `expires_at` 을 채우지 않으므로(아래 참고)
 * 그 행은 NULL 로 박힌다. `validity.ts` 의 `isUsable` 규칙(「링크 행이 있으면 링크 행이
 * 만료를 정한다, NULL 은 무기한」)에 따라 그 고객에게는 그 쿠폰이 정책의 `ends_at` 을 지나도
 * **영원히** 살아난다 — C1(2026-08-31 최종 리뷰)이 실사고로 잡은 경로다. "중복 검사 같으니
 * 지워도 되겠다"는 판단으로 지우지 말 것 — 그 판단 자체가 이 사고를 재현한다.
 *
 * 훅 등록(`record-coupon-usage.ts`)은 전역 부수효과라 유닛 테스트가 닿지 않는다. 그래서
 * 판정을 여기로 뽑고 등록부는 얇게 둔다(`apply-promotion-meta.ts` 와 같은 모양).
 *
 * ⚠️ `expires_at` 은 `data` 에 넣지 않는다 — `Link.create` 는 upsert 라 넣으면 덮인다.
 *    사용했다고 만료가 바뀌어서는 안 된다.
 */
export type UsageLinkPayload = {
  [key: string]: unknown;
  data: { used_at: Date; order_id: string };
};

export function buildUsageLinks(
  customerId: string | null | undefined,
  promotionIds: string[],
  orderId: string,
  usedAt: Date,
  /** 이 고객에게 이미 발급된(=링크 행이 존재하는) 프로모션 id 전체. 이 집합 밖은 절대 만들지 않는다. */
  issuedPromotionIds: ReadonlySet<string>,
): UsageLinkPayload[] {
  // 링크는 고객에게만 붙는다. 비회원 주문은 기록할 «한 장»이 없다.
  if (!customerId) return [];
  return (promotionIds ?? [])
    // 발급된 적 없는 쌍(=링크 행 없음)은 절대 만들지 않는다 — 위 주석의 C1 불변식.
    .filter((promotionId) => issuedPromotionIds.has(promotionId))
    .map((promotionId) => ({
      [Modules.CUSTOMER]: { customer_id: customerId },
      [Modules.PROMOTION]: { promotion_id: promotionId },
      data: { used_at: usedAt, order_id: orderId },
    }));
}
