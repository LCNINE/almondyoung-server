/**
 * 정률 쿠폰 최대 할인금액(`promotion_meta.max_discount_amount`)의 **순수 로직** (#488 A4 / P10-B).
 *
 * Medusa 프로모션 엔진은 금액 상한 개념이 없다(2.13.4 · 2.19.0 · 2.20-preview 전부 확인).
 * 그래서 엔진이 만든 adjustment 를 **뒤에서 깎는다.** 이 파일은 「얼마로 깎을지」만 정하고
 * 어디서 읽고 어디에 쓰는지는 모른다 — 컨테이너를 아는 순간 유닛이 안 닿는다(#488 P1 교훈).
 *
 * 캡의 단위는 **「한 카트 × 한 프로모션」**이다. 라인별이 아니다. 같은 `promotion_id` 가 만든
 * 라인아이템·배송수단 adjustment 를 전부 합쳐 캡과 비교한다.
 */

export interface CappableAdjustment {
  id: string;
  promotion_id?: string | null;
  amount: number;
}

/** 되써야 하는 adjustment 만. 안 바뀌는 것은 담기지 않는다. */
export interface CapWriteback {
  id: string;
  amount: number;
}

/** 백스톱이 보는 것 — 「이 프로모션이 캡보다 얼마나 더 깎고 있는가」. */
export interface CapViolation {
  promotion_id: string;
  total: number;
  cap: number;
}

/** 캡이 걸린 프로모션별로 adjustment 를 모은다. 캡 밖·음수·0 은 애초에 안 담는다. */
function groupCapped(
  adjustments: readonly CappableAdjustment[],
  capByPromotionId: ReadonlyMap<string, number>,
): Map<string, CappableAdjustment[]> {
  const grouped = new Map<string, CappableAdjustment[]>();
  for (const adjustment of adjustments) {
    const promotionId = adjustment.promotion_id;
    if (!promotionId) continue;
    const cap = capByPromotionId.get(promotionId);
    if (cap == null || !Number.isFinite(cap) || cap < 0) continue;
    if (!Number.isFinite(adjustment.amount) || adjustment.amount <= 0) continue;
    grouped.set(promotionId, [...(grouped.get(promotionId) ?? []), adjustment]);
  }
  return grouped;
}

function sumAmount(adjustments: readonly CappableAdjustment[]): number {
  return adjustments.reduce((sum, adjustment) => sum + adjustment.amount, 0);
}

/**
 * 캡을 넘는 프로모션의 adjustment 를 **합이 정확히 캡이 되도록** 비례 축소한다.
 *
 * 원 단위(정수)로 내림한 뒤 남는 잔돈을 **버려진 소수부가 큰 순**으로 1원씩 되돌린다.
 * 동률은 금액 큰 순 → `id` 오름차순으로 깨서 **같은 입력이 항상 같은 출력**을 내게 한다
 * (카트 재계산이 잦아 결정성이 없으면 금액이 미세하게 진동한다).
 */
export function planPromotionCap(
  adjustments: readonly CappableAdjustment[],
  capByPromotionId: ReadonlyMap<string, number>,
): CapWriteback[] {
  const writebacks: CapWriteback[] = [];

  for (const [promotionId, group] of groupCapped(adjustments, capByPromotionId)) {
    const cap = capByPromotionId.get(promotionId) as number;
    const total = sumAmount(group);
    if (total <= 0 || total <= cap) continue;

    const shares = group.map((adjustment) => {
      const exact = (adjustment.amount * cap) / total;
      const floored = Math.floor(exact);
      return { adjustment, floored, fraction: exact - floored };
    });

    shares.sort(
      (a, b) =>
        b.fraction - a.fraction ||
        b.adjustment.amount - a.adjustment.amount ||
        (a.adjustment.id < b.adjustment.id ? -1 : 1),
    );

    let remainder = cap - shares.reduce((sum, share) => sum + share.floored, 0);
    for (const share of shares) {
      const bonus = remainder > 0 ? 1 : 0;
      remainder -= bonus;
      const next = share.floored + bonus;
      if (next !== share.adjustment.amount) {
        writebacks.push({ id: share.adjustment.id, amount: next });
      }
    }
  }

  return writebacks;
}

/**
 * 캡이 지켜지고 있는지 본다. **고치지 않는다** — 주문 확정 백스톱이 쓴다.
 */
export function findCapViolations(
  adjustments: readonly CappableAdjustment[],
  capByPromotionId: ReadonlyMap<string, number>,
): CapViolation[] {
  const violations: CapViolation[] = [];
  for (const [promotionId, group] of groupCapped(adjustments, capByPromotionId)) {
    const cap = capByPromotionId.get(promotionId) as number;
    const total = sumAmount(group);
    if (total > cap) violations.push({ promotion_id: promotionId, total, cap });
  }
  return violations;
}
