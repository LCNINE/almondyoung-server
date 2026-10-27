import { CustomerReturnAttentionInput, customerReturnAttention, refundDueAt } from './customer-return-attention';

describe('refundDueAt', () => {
  it.each([
    ['2026-10-26T03:00:00Z', '2026-10-29T14:59:59.999Z'],
    ['2026-10-30T03:00:00Z', '2026-11-04T14:59:59.999Z'],
    ['2026-10-31T03:00:00Z', '2026-11-04T14:59:59.999Z'],
    ['2026-11-01T03:00:00Z', '2026-11-04T14:59:59.999Z'],
    ['2026-10-25T14:30:00Z', '2026-10-28T14:59:59.999Z'],
    ['2026-10-25T15:30:00Z', '2026-10-29T14:59:59.999Z'],
  ])('%s -> %s', (arrived, due) => {
    expect(refundDueAt(new Date(arrived)).toISOString()).toBe(due);
  });
});

describe('customerReturnAttention', () => {
  const arrivedAt = new Date('2026-10-26T03:00:00Z');
  const due = refundDueAt(arrivedAt);
  const base: CustomerReturnAttentionInput = {
    status: 'arrived',
    arrivedAt,
    settlementState: null,
    prepaymentState: null,
    expectedQty: 1,
    arrivedQty: 1,
    missingQty: 0,
  };
  const early = new Date('2026-10-27T00:00:00Z');
  const late = new Date('2026-11-05T00:00:00Z');

  it('held', () => {
    expect(customerReturnAttention({ ...base, status: 'held' }, early)).toEqual(['held']);
  });
  it('정산 stalled + 기한 지남', () => {
    expect(customerReturnAttention({ ...base, status: 'refund_pending', settlementState: 'stalled' }, late)).toEqual([
      'settlement_failed',
      'refund_overdue',
    ]);
  });
  it('정산 refused 도 실패', () => {
    expect(customerReturnAttention({ ...base, status: 'refund_pending', settlementState: 'refused' }, early)).toEqual([
      'settlement_failed',
    ]);
  });
  it('일부 도착', () => {
    const partial = { ...base, expectedQty: 2, arrivedQty: 1 };
    expect(customerReturnAttention(partial, early)).toEqual(['partial_arrival']);
    expect(customerReturnAttention({ ...partial, missingQty: 1 }, early)).toEqual([]);
  });
  it('환불이 나간 반품은 기한이 지나도 조용하다', () => {
    expect(customerReturnAttention({ ...base, status: 'settled', settlementState: 'done' }, late)).toEqual([]);
    expect(customerReturnAttention({ ...base, prepaymentState: 'done' }, late)).toEqual([]);
  });
  it('기한 그 밀리초까지는 정상, 1ms 뒤 지남', () => {
    expect(customerReturnAttention(base, due)).toEqual([]);
    expect(customerReturnAttention(base, new Date(due.getTime() + 1))).toEqual(['refund_overdue']);
  });
  it('선환불 refused', () => {
    expect(customerReturnAttention({ ...base, prepaymentState: 'refused' }, early)).toEqual(['prepayment_failed']);
  });
  it('도착 없음은 기한 판정 없음', () => {
    expect(customerReturnAttention({ ...base, status: 'expected', arrivedAt: null }, late)).toEqual([]);
  });
});
