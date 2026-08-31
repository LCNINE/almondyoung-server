import { Modules } from '@medusajs/framework/utils';

/**
 * 「이 주문에 어떤 쿠폰이 쓰였나」를 링크 행에 남기는 **순수 조립 로직** (#488 N4 → A2).
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
): UsageLinkPayload[] {
  // 링크는 고객에게만 붙는다. 비회원 주문은 기록할 «한 장»이 없다.
  if (!customerId) return [];
  return (promotionIds ?? []).map((promotionId) => ({
    [Modules.CUSTOMER]: { customer_id: customerId },
    [Modules.PROMOTION]: { promotion_id: promotionId },
    data: { used_at: usedAt, order_id: orderId },
  }));
}
