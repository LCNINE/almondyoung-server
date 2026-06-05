/**
 * 부분취소 환불 금액 산정 정책 모듈.
 *
 * 정책 요약:
 * - 환불 금액 = round((취소 라인 가치 / 전체 라인 가치) × 상품 소계)
 * - 상품 소계 = totalAmount - shippingFee (배송비는 주문 전체에 부과, 부분취소 시 환불 안 함)
 * - 주문 레벨 할인이 totalAmount에 이미 반영되어 있으므로 비중 계산으로 배분됨
 * - 쿠폰/적립금 할인도 동일하게 lineValue 비중으로 안전하게 배분됨
 *
 * 자동 환불 가능 조건:
 * - salesChannel === 'medusa' (나머지는 채널 자체 환불 정책 적용)
 * - walletIntentId 존재
 * - totalAmount > 0
 * - 취소 대상 라인 전체에 unitPrice가 존재
 * - 계산된 환불 금액 > 0
 *
 * 정책 불충족 케이스는 manualReason과 함께 manual_pending으로 기록.
 * Wallet의 refundable amount 초과 방어는 Wallet이 담당.
 */

export type PartialCancellationLine = {
  salesOrderLineId: string;
  quantity: number;
};

export type OrderLine = {
  id: string;
  quantity: number;
  unitPrice: number | null;
};

export type RefundBreakdown = {
  cancelledLineValue: number;
  totalLineValue: number;
  productSubtotal: number;
  ratio: number;
  grossRefund: number;
  shippingRefund: number;
};

export type ManualRefundReason =
  | 'NO_WALLET_INTENT'
  | 'CHANNEL_ORDER'
  | 'NO_LINE_PRICING'
  | 'NO_ORDER_TOTAL'
  | 'ZERO_REFUND_AMOUNT'
  | 'PARTIAL_CANCEL_MANUAL_REVIEW';

export type PartialCancellationRefundInput = {
  salesChannel: string;
  walletIntentId: string | null;
  totalAmount: number | null;
  shippingFee: number;
  allOrderLines: OrderLine[];
  cancelledLines: PartialCancellationLine[];
};

export type PartialCancellationRefundResult = {
  autoRefundable: boolean;
  refundAmount: number;
  breakdown: RefundBreakdown;
  manualRequired: boolean;
  manualReason: ManualRefundReason | null;
  warnings: string[];
};

const EMPTY_BREAKDOWN: RefundBreakdown = {
  cancelledLineValue: 0,
  totalLineValue: 0,
  productSubtotal: 0,
  ratio: 0,
  grossRefund: 0,
  shippingRefund: 0,
};

function manualResult(
  reason: ManualRefundReason,
  breakdown: RefundBreakdown = { ...EMPTY_BREAKDOWN },
  warnings: string[] = [],
): PartialCancellationRefundResult {
  return { autoRefundable: false, refundAmount: 0, breakdown, manualRequired: true, manualReason: reason, warnings };
}

export function calculatePartialCancellationRefund(
  input: PartialCancellationRefundInput,
): PartialCancellationRefundResult {
  // 채널 주문(나버/쿠팡)은 채널 자체 환불 정책 사용
  if (input.salesChannel !== 'medusa') {
    return manualResult('CHANNEL_ORDER');
  }

  // Wallet Intent 없으면 자동 환불 불가
  if (!input.walletIntentId) {
    return manualResult('NO_WALLET_INTENT');
  }

  // 주문 총액 없으면 계산 불가
  const orderTotal = input.totalAmount ?? 0;
  if (orderTotal <= 0) {
    return manualResult('NO_ORDER_TOTAL');
  }

  // 취소 대상 라인에 unitPrice가 없으면 계산 불가
  const cancelledLineIds = new Set(input.cancelledLines.map((l) => l.salesOrderLineId));
  const missingPriceLines = input.allOrderLines.filter(
    (l) => cancelledLineIds.has(l.id) && (l.unitPrice == null || l.unitPrice < 0),
  );
  if (missingPriceLines.length > 0) {
    return manualResult('NO_LINE_PRICING', { ...EMPTY_BREAKDOWN }, [
      `Lines missing valid unit price: ${missingPriceLines.map((l) => l.id).join(', ')}`,
    ]);
  }

  const cancelledQtyMap = new Map(input.cancelledLines.map((l) => [l.salesOrderLineId, l.quantity]));

  const cancelledLineValue = input.allOrderLines.reduce((sum, line) => {
    const qty = cancelledQtyMap.get(line.id) ?? 0;
    return sum + qty * (line.unitPrice ?? 0);
  }, 0);

  const totalLineValue = input.allOrderLines.reduce(
    (sum, line) => sum + line.quantity * (line.unitPrice ?? 0),
    0,
  );

  if (totalLineValue <= 0) {
    return manualResult(
      'NO_LINE_PRICING',
      { cancelledLineValue, totalLineValue, productSubtotal: 0, ratio: 0, grossRefund: 0, shippingRefund: 0 },
      ['Total order line value is zero — cannot compute ratio'],
    );
  }

  // 부분취소는 배송비 환불 없음 — 배송비는 주문 전체에 부과됨
  const shippingFee = Math.max(0, input.shippingFee);
  const productSubtotal = Math.max(0, orderTotal - shippingFee);
  const ratio = cancelledLineValue / totalLineValue;
  const grossRefund = Math.round(ratio * productSubtotal);

  const breakdown: RefundBreakdown = {
    cancelledLineValue,
    totalLineValue,
    productSubtotal,
    ratio,
    grossRefund,
    shippingRefund: 0,
  };

  if (grossRefund <= 0) {
    return {
      autoRefundable: false,
      refundAmount: 0,
      breakdown,
      manualRequired: true,
      manualReason: 'ZERO_REFUND_AMOUNT',
      warnings: [`Calculated refund is ${grossRefund} — check if items were fully discounted`],
    };
  }

  // Always require manual review for partial cancellations.
  // Proportional allocation does not account for coupon/point/membership discount
  // distribution, free-shipping threshold breakage, or prior refund history.
  return {
    autoRefundable: false,
    refundAmount: grossRefund,
    breakdown,
    manualRequired: true,
    manualReason: 'PARTIAL_CANCEL_MANUAL_REVIEW',
    warnings: ['Proportional estimate only — verify against actual discount allocation before issuing refund'],
  };
}
