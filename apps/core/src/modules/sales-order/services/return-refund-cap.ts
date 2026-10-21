/**
 * 세트 일부 반품의 환불 상한 (K6 PR3b).
 *
 * - U1: 라인 배분액을 «취소 안 된 비율»(remaining ÷ quantity)로 줄인다. totalAmount 는 취소해도
 *   줄지 않아, 줄이지 않으면 취소로 환불한 몫을 또 환불할 수 있다. 취소 환불 기록은 읽지 않는다.
 * - A4: 금액을 모르는 앞선 완료 반품(refundedAmount null)이 건드린 touched 라인은 배분액 0 —
 *   과환불은 막고 상한이 실제보다 낮게 나올 수 있다.
 * - A5: 상한은 내림. 반올림하면 1원 넘게 나갈 수 있다.
 *
 * 수량 뺄셈은 하지 않는다 — 수량 문이 낸 `remaining` 을 받는다. 돈 판단이라 커널이 아니라 여기 둔다.
 */
export type RefundCapLine = {
  id: string;
  /** 주문 수량(판매 단위) */
  quantity: number;
  /** LineQuantities.remaining (주문 − 취소 전부) */
  remaining: number;
  unitPrice: number | null;
  totalPrice: number | null;
};

/** 앞선 완료 반품 — refundedAmount null = 금액 모름(A4). */
export type PriorCompletedReturn = { lineIds: readonly string[]; refundedAmount: number | null };

export function returnRefundCap(input: {
  orderLines: readonly RefundCapLine[];
  touchedLineIds: ReadonlySet<string>;
  priorReturns: readonly PriorCompletedReturn[];
  totalAmount: number | null;
  shippingFee: number;
}): number {
  const { orderLines, touchedLineIds, priorReturns, totalAmount, shippingFee } = input;

  // 라인 무게: calculateReturnRefund 와 같은 기준(분모는 모든 라인)
  const weight = (l: RefundCapLine): number => l.totalPrice ?? (l.unitPrice ?? 0) * l.quantity;
  const weightSum = orderLines.reduce((acc, l) => acc + weight(l), 0);
  const pool = Math.max(0, (totalAmount ?? 0) - shippingFee);
  const useWeights = (totalAmount ?? 0) > 0 && weightSum > 0;

  const allocation = (l: RefundCapLine): number => {
    if (!useWeights) return (l.unitPrice ?? 0) * l.remaining;
    if (l.quantity <= 0) return 0;
    return (((weight(l) * pool) / weightSum) * l.remaining) / l.quantity;
  };

  const unknownPriorLineIds = new Set<string>();
  let knownPriorSum = 0;
  for (const prior of priorReturns) {
    if (prior.refundedAmount === null) {
      prior.lineIds.forEach((id) => unknownPriorLineIds.add(id));
    } else if (prior.lineIds.some((id) => touchedLineIds.has(id))) {
      knownPriorSum += prior.refundedAmount;
    }
  }

  const share = orderLines
    .filter((l) => touchedLineIds.has(l.id) && !unknownPriorLineIds.has(l.id))
    .reduce((acc, l) => acc + allocation(l), 0);

  return Math.max(0, Math.floor(share) - knownPriorSum);
}
