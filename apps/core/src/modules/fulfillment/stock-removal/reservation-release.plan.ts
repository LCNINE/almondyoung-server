export interface ReleaseSourceLine {
  lineId: string;
  reservedQty: number;
  /** 마지막에야 놓는 줄 — 우선할당한 주문과 셀메이트가 내보내는 주문 */
  lastResort: boolean;
  /** 상자의 모든 줄이 예약됐는가 — 놓으면 나갈 수 있던 상자가 못 나가게 된다 */
  ready: boolean;
  /** 재고 대기 순번. 클수록 뒤에 온 주문이다 */
  queuedAt: number;
}

export interface ReservationReleasePlan {
  releases: { lineId: string; qty: number }[];
  /** 놓을 수 있는 예약을 다 놓아도 모자라는 수량 */
  missingQty: number;
}

/** 어차피 못 나가는 상자부터, 그 안에서는 뒤에 온 주문부터 예약을 놓는다 — 재고를 받는 순서의 거꾸로다. */
export function planReservationRelease(need: number, sources: readonly ReleaseSourceLine[]): ReservationReleasePlan {
  const plan: ReservationReleasePlan = { releases: [], missingQty: Math.max(0, need) };
  const order = [...sources].sort(
    (a, b) =>
      Number(a.lastResort) - Number(b.lastResort) ||
      Number(a.ready) - Number(b.ready) ||
      b.queuedAt - a.queuedAt ||
      a.lineId.localeCompare(b.lineId),
  );
  for (const source of order) {
    if (plan.missingQty === 0) break;
    const qty = Math.min(plan.missingQty, source.reservedQty);
    if (qty <= 0) continue;
    plan.releases.push({ lineId: source.lineId, qty });
    plan.missingQty -= qty;
  }
  return plan;
}
