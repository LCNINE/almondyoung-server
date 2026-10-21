import { RefundCapLine, returnRefundCap } from './return-refund-cap';

const lineA = (over: Partial<RefundCapLine> = {}): RefundCapLine => ({
  id: 'A',
  quantity: 3,
  remaining: 3,
  unitPrice: 1000,
  totalPrice: 3000,
  ...over,
});
const lineB = (over: Partial<RefundCapLine> = {}): RefundCapLine => ({
  id: 'B',
  quantity: 1,
  remaining: 1,
  unitPrice: 1000,
  totalPrice: 1000,
  ...over,
});

// 상품 소계 4000, 배송비 500, 결제총액 4500.
const base = () => ({
  orderLines: [lineA(), lineB()],
  touchedLineIds: new Set(['A']),
  priorReturns: [] as { lineIds: readonly string[]; refundedAmount: number | null }[],
  totalAmount: 4500 as number | null,
  shippingFee: 500,
});

describe('returnRefundCap', () => {
  it('touched line gets its weighted share', () => {
    expect(returnRefundCap(base())).toBe(3000);
  });

  it('cancellation scales the line allocation', () => {
    expect(returnRefundCap({ ...base(), orderLines: [lineA({ remaining: 1 }), lineB()] })).toBe(1000);
  });

  it('known prior refund on a touched line is subtracted', () => {
    expect(returnRefundCap({ ...base(), priorReturns: [{ lineIds: ['A'], refundedAmount: 400 }] })).toBe(2600);
  });

  it('prior refund on an untouched line is ignored', () => {
    expect(returnRefundCap({ ...base(), priorReturns: [{ lineIds: ['B'], refundedAmount: 400 }] })).toBe(3000);
  });

  it('prior refund touching A and B is subtracted whole', () => {
    expect(
      returnRefundCap({
        ...base(),
        priorReturns: [{ lineIds: ['A', 'B'], refundedAmount: 1500 }],
      }),
    ).toBe(1500);
  });

  it('unknown prior zeroes only the lines it touched', () => {
    expect(
      returnRefundCap({
        ...base(),
        touchedLineIds: new Set(['A', 'B']),
        priorReturns: [{ lineIds: ['A'], refundedAmount: null }],
      }),
    ).toBe(1000);
  });

  it('never negative', () => {
    expect(returnRefundCap({ ...base(), priorReturns: [{ lineIds: ['A'], refundedAmount: 5000 }] })).toBe(0);
  });

  it('floors fractional share', () => {
    expect(
      returnRefundCap({
        ...base(),
        orderLines: [lineA({ totalPrice: 1 }), lineB({ totalPrice: 2 })],
        totalAmount: 1500,
        shippingFee: 500,
      }),
    ).toBe(333);
  });

  it('falls back to unit price without order total', () => {
    expect(returnRefundCap({ ...base(), orderLines: [lineA({ remaining: 2 }), lineB()], totalAmount: null })).toBe(2000);
  });
});
