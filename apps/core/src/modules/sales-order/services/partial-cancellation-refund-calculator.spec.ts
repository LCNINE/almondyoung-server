import { calculatePartialCancellationRefund } from './partial-cancellation-refund-calculator';

describe('calculatePartialCancellationRefund', () => {
  const baseInput = {
    salesChannel: 'medusa',
    walletIntentId: 'intent_123',
    totalAmount: 30000,
    shippingFee: 3000,
    allOrderLines: [
      { id: 'line1', quantity: 2, unitPrice: 10000 },
      { id: 'line2', quantity: 1, unitPrice: 10000 },
    ],
    cancelledLines: [{ salesOrderLineId: 'line1', quantity: 1 }],
  };

  // ── 환불 금액 계산 (autoRefundable은 항상 false — 수동 검토 필수) ──────────────

  it('단일 라인 부분 취소 — 비중 환불 금액 계산 후 manual_pending', () => {
    const result = calculatePartialCancellationRefund(baseInput);
    // totalLineValue = 30000, cancelledLineValue = 10000
    // productSubtotal = 30000 - 3000 = 27000
    // ratio = 1/3, grossRefund = round(9000) = 9000
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('PARTIAL_CANCEL_MANUAL_REVIEW');
    expect(result.refundAmount).toBe(9000);
    expect(result.breakdown.shippingRefund).toBe(0);
  });

  it('여러 라인 부분 취소 — 비중 합산', () => {
    const result = calculatePartialCancellationRefund({
      ...baseInput,
      cancelledLines: [
        { salesOrderLineId: 'line1', quantity: 1 },
        { salesOrderLineId: 'line2', quantity: 1 },
      ],
    });
    // cancelledLineValue = 10000 + 10000 = 20000
    // ratio = 20000/30000, grossRefund = round(2/3 * 27000) = 18000
    expect(result.autoRefundable).toBe(false);
    expect(result.refundAmount).toBe(18000);
  });

  it('부분 수량 취소 (3개 중 2개)', () => {
    const result = calculatePartialCancellationRefund({
      salesChannel: 'medusa',
      walletIntentId: 'intent_123',
      totalAmount: 55000,
      shippingFee: 5000,
      allOrderLines: [
        { id: 'line1', quantity: 3, unitPrice: 10000 },
        { id: 'line2', quantity: 2, unitPrice: 10000 },
      ],
      cancelledLines: [{ salesOrderLineId: 'line1', quantity: 2 }],
    });
    // totalLineValue = 50000, cancelledLineValue = 20000
    // productSubtotal = 50000, ratio = 0.4
    // grossRefund = round(0.4 * 50000) = 20000
    expect(result.autoRefundable).toBe(false);
    expect(result.refundAmount).toBe(20000);
  });

  it('배송비 없는 주문 — 무료배송', () => {
    const result = calculatePartialCancellationRefund({
      ...baseInput,
      shippingFee: 0,
      totalAmount: 30000,
    });
    // productSubtotal = 30000
    // ratio = 1/3, grossRefund = round(10000) = 10000
    expect(result.autoRefundable).toBe(false);
    expect(result.refundAmount).toBe(10000);
  });

  it('주문 레벨 할인이 비중으로 배분됨 (금액 참고용)', () => {
    // totalAmount = 24000: lines 30000 - order discount 6000 = 24000 (shipping 별도 0)
    const result = calculatePartialCancellationRefund({
      salesChannel: 'medusa',
      walletIntentId: 'intent_123',
      totalAmount: 24000,
      shippingFee: 0,
      allOrderLines: [
        { id: 'line1', quantity: 2, unitPrice: 10000 },
        { id: 'line2', quantity: 1, unitPrice: 10000 },
      ],
      cancelledLines: [{ salesOrderLineId: 'line1', quantity: 1 }],
    });
    // totalLineValue = 30000, cancelledLineValue = 10000
    // productSubtotal = 24000, ratio = 1/3
    // grossRefund = round(1/3 * 24000) = round(8000) = 8000
    expect(result.autoRefundable).toBe(false);
    expect(result.refundAmount).toBe(8000);
  });

  it('모든 수량 취소 — 배송비 제외한 전액 (참고용)', () => {
    const result = calculatePartialCancellationRefund({
      ...baseInput,
      cancelledLines: [
        { salesOrderLineId: 'line1', quantity: 2 },
        { salesOrderLineId: 'line2', quantity: 1 },
      ],
    });
    // ratio = 1.0, productSubtotal = 27000
    // 배송비(3000)는 환불 안 함
    expect(result.autoRefundable).toBe(false);
    expect(result.refundAmount).toBe(27000);
    expect(result.breakdown.shippingRefund).toBe(0);
  });

  it('소수점 반올림 처리 — 3으로 나눌 때', () => {
    const result = calculatePartialCancellationRefund({
      salesChannel: 'medusa',
      walletIntentId: 'intent_123',
      totalAmount: 10000,
      shippingFee: 0,
      allOrderLines: [{ id: 'line1', quantity: 3, unitPrice: 1000 }],
      cancelledLines: [{ salesOrderLineId: 'line1', quantity: 1 }],
    });
    // totalLineValue = 3000, cancelledLineValue = 1000
    // ratio = 1/3, productSubtotal = 10000
    // grossRefund = round(10000/3) = round(3333.33) = 3333
    expect(result.autoRefundable).toBe(false);
    expect(result.refundAmount).toBe(3333);
  });

  // ── manual_pending 케이스 ──────────────────────────────────────────────────

  it('채널 주문(naver) — CHANNEL_ORDER', () => {
    const result = calculatePartialCancellationRefund({ ...baseInput, salesChannel: 'naver' });
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('CHANNEL_ORDER');
  });

  it('채널 주문(coupang) — CHANNEL_ORDER', () => {
    const result = calculatePartialCancellationRefund({ ...baseInput, salesChannel: 'coupang' });
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('CHANNEL_ORDER');
  });

  it('walletIntentId 없음 — NO_WALLET_INTENT', () => {
    const result = calculatePartialCancellationRefund({ ...baseInput, walletIntentId: null });
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('NO_WALLET_INTENT');
  });

  it('totalAmount null — NO_ORDER_TOTAL', () => {
    const result = calculatePartialCancellationRefund({ ...baseInput, totalAmount: null });
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('NO_ORDER_TOTAL');
  });

  it('totalAmount 0 — NO_ORDER_TOTAL', () => {
    const result = calculatePartialCancellationRefund({ ...baseInput, totalAmount: 0 });
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('NO_ORDER_TOTAL');
  });

  it('취소 라인 unitPrice null — NO_LINE_PRICING', () => {
    const result = calculatePartialCancellationRefund({
      ...baseInput,
      allOrderLines: [
        { id: 'line1', quantity: 2, unitPrice: null },
        { id: 'line2', quantity: 1, unitPrice: 10000 },
      ],
    });
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('NO_LINE_PRICING');
  });

  it('취소 안 한 라인의 unitPrice null은 무시 (취소 라인만 검사)', () => {
    const result = calculatePartialCancellationRefund({
      ...baseInput,
      allOrderLines: [
        { id: 'line1', quantity: 2, unitPrice: 10000 },
        { id: 'line2', quantity: 1, unitPrice: null }, // 취소 안 한 라인
      ],
      cancelledLines: [{ salesOrderLineId: 'line1', quantity: 1 }],
    });
    // line2는 취소 안 함 → unitPrice null 무시
    // cancelledLineValue = 10000, totalLineValue = 2*10000 + 1*0 = 20000
    // productSubtotal = 27000, ratio = 10000/20000 = 0.5
    // grossRefund = round(0.5 * 27000) = 13500
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('PARTIAL_CANCEL_MANUAL_REVIEW');
    expect(result.refundAmount).toBe(13500);
  });

  it('전액 할인으로 상품 소계 0 — ZERO_REFUND_AMOUNT', () => {
    const result = calculatePartialCancellationRefund({
      ...baseInput,
      totalAmount: 3000, // 배송비만 결제, 상품 전액 무료
      shippingFee: 3000,
    });
    expect(result.autoRefundable).toBe(false);
    expect(result.manualReason).toBe('ZERO_REFUND_AMOUNT');
  });

  // ── breakdown 필드 검증 ────────────────────────────────────────────────────

  it('breakdown 필드가 올바르게 채워짐', () => {
    const result = calculatePartialCancellationRefund(baseInput);
    expect(result.breakdown.cancelledLineValue).toBe(10000);
    expect(result.breakdown.totalLineValue).toBe(30000);
    expect(result.breakdown.productSubtotal).toBe(27000);
    expect(result.breakdown.shippingRefund).toBe(0);
    expect(result.breakdown.grossRefund).toBe(result.refundAmount);
    expect(result.breakdown.ratio).toBeCloseTo(1 / 3);
  });

  it('자동환불 불가 케이스에도 warnings 배열이 있음', () => {
    const result = calculatePartialCancellationRefund({ ...baseInput, walletIntentId: null });
    expect(Array.isArray(result.warnings)).toBe(true);
  });
});
