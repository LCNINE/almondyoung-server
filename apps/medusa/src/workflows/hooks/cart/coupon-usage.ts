import { selectGrantToConsume, grantsFor } from '../../../modules/promotion-meta/grants';
import type { CouponGrantRow } from '../../../modules/promotion-meta/service';

/**
 * 「이 주문에 쓰인 쿠폰」마다 소모할 장을 하나씩 고른다 (#488 A2 의 선행).
 *
 * 🔴 옛 구현(링크 upsert)은 **없는 쌍에 행을 만들어 버리는** 위험이 있었다 — `Link.create` 가
 * upsert 라 `public` 쿠폰을 결제한 고객에게 만료 NULL 인 «영구 쿠폰» 이 생겼다(C1, 2026-08-31).
 * grant 로 옮기면서 그 위험 자체가 사라졌다 — **여기서는 id 로 UPDATE 만 한다.** 발급받지
 * 않은 쿠폰은 고를 장이 없어 자연히 건너뛴다. 그래서 「이미 발급된 것만」 필터가 필요 없다.
 *
 * 🔴 재실행 멱등성 가드(최종 리뷰 Important #1): 링크 upsert 는 `(customer_id, promotion_id)`
 * 키라 훅이 같은 주문으로 두 번 불려도 같은 행에 다시 쓸 뿐 무해했다. grant 소모는 매 호출마다
 * 「사용 가능 집합에서 하나를 고르는」 동작이라 그 우연한 안전성이 없다 — 같은 주문이 여분 장을
 * 가진 고객에게 두 번 불리면 두 번째 호출이 **다른** 장을 고른다(1 주문 = 2장 소모, G5 시나리오
 * 정확히 반대). 워크플로 엔진이 이 훅을 실제로 재호출할 수 있는지는 증명하지 않는다(비싸고
 * 업그레이드 한 번에 무효화될 수 있다) — 대신 구조로 막는다: 프로모션마다 「이 orderId 로 이미
 * 소모된 장」이 있으면 그 프로모션은 건너뛴다. 재호출이 몇 번이든 주문당 쿠폰당 정확히 한 장이다.
 *
 * 훅 등록(`record-coupon-usage.ts`)은 전역 부수효과라 유닛 테스트가 닿지 않는다. 그래서
 * 판정을 여기로 뽑고 등록부는 얇게 둔다(`apply-promotion-meta.ts` 와 같은 모양).
 */
export function selectGrantIdsToConsume(
  grants: CouponGrantRow[],
  promotionIds: string[],
  now: Date,
  orderId: string,
): string[] {
  const ids: string[] = [];
  for (const promotionId of promotionIds ?? []) {
    const mine = grantsFor(grants, promotionId);
    // 이 주문이 이 프로모션의 장을 이미 소모했다면(재호출) 다시 고르지 않는다.
    const alreadyConsumedByThisOrder = mine.some((g) => g.order_id === orderId);
    if (alreadyConsumedByThisOrder) continue;
    const chosen = selectGrantToConsume(mine, now);
    if (chosen) ids.push(chosen.id);
  }
  return ids;
}
