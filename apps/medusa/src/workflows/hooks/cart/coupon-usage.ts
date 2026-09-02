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
 * 훅 등록(`record-coupon-usage.ts`)은 전역 부수효과라 유닛 테스트가 닿지 않는다. 그래서
 * 판정을 여기로 뽑고 등록부는 얇게 둔다(`apply-promotion-meta.ts` 와 같은 모양).
 */
export function selectGrantIdsToConsume(grants: CouponGrantRow[], promotionIds: string[], now: Date): string[] {
  const ids: string[] = [];
  for (const promotionId of promotionIds ?? []) {
    const chosen = selectGrantToConsume(grantsFor(grants, promotionId), now);
    if (chosen) ids.push(chosen.id);
  }
  return ids;
}
