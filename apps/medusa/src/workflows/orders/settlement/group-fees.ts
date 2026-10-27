import type { PriorGroupFees } from '../partial-cancel/plan-shipping';

/**
 * 기록(부분취소·반품 정산)들이 남긴 그룹 요금을 주문 버전 순으로 겹친다(나중 것이 이긴다).
 * 입력 순서와 무관하다 — metadata 는 키 순서를 보장하지 않고, 반품 기록은 다른 행에서 온다.
 */
export function mergeGroupFees(records: Array<{ orderVersion: number; groupFees: Record<string, number> }>): PriorGroupFees {
  return [...records]
    .sort((a, b) => a.orderVersion - b.orderVersion)
    .reduce<PriorGroupFees>((acc, r) => ({ ...acc, ...r.groupFees }), {});
}
