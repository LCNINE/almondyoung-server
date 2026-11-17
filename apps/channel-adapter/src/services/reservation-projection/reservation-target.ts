/**
 * Medusa 예약 목표 수량(판매 단위) — 투영 공식은 이 함수 하나다 (#1247).
 * `demand = ordered − canceledBeforeShipment`, `heldUnits` 는 core 가 구성 SKU 별 완성 세트 수의 최솟값으로 계산해 보낸다.
 */
export function reservationTarget(line: { demand: number; heldUnits: number }): number {
  return Math.max(0, line.demand - line.heldUnits);
}
