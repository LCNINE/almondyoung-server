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
    pickupStatus: null,
    kind: 'return',
    exchangeReleasedAt: null,
  };
  const early = new Date('2026-10-27T00:00:00Z');
  const late = new Date('2026-11-05T00:00:00Z');

  it.each(['failed', 'cancelled', 'void'] as const)('expected + 회수 %s 는 pickup_failed, 맨 처음', (pickupStatus) => {
    expect(customerReturnAttention({ ...base, status: 'expected', arrivedAt: null, pickupStatus }, early)).toEqual([
      'pickup_failed',
    ]);
    expect(
      customerReturnAttention(
        { ...base, status: 'expected', arrivedAt: null, pickupStatus, settlementState: 'refused' },
        early,
      ),
    ).toEqual(['pickup_failed', 'settlement_failed']);
  });
  it.each(['pending', 'reserved', 'cancel_pending', null] as const)(
    'expected + 회수 %s 는 pickup_failed 가 아니다',
    (pickupStatus) => {
      expect(customerReturnAttention({ ...base, status: 'expected', arrivedAt: null, pickupStatus }, early)).toEqual(
        [],
      );
    },
  );
  it('arrived + 회수 failed 는 pickup_failed 가 아니다', () => {
    expect(customerReturnAttention({ ...base, pickupStatus: 'failed' }, early)).toEqual([]);
  });

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

  describe('교환 (K8 PR11b N8)', () => {
    // 2026-10-26(월) 도착 → 4평일 뒤 = 2026-10-30(금). 기한(3평일)은 10-29 23:59:59.999 KST
    const fourBusinessDaysLater = new Date('2026-10-30T03:00:00Z');
    const exchange: CustomerReturnAttentionInput = { ...base, kind: 'exchange' };

    it('교환 도착 4평일 뒤·열림 없음 → exchange_overdue 만, refund_overdue 없음', () => {
      expect(customerReturnAttention(exchange, fourBusinessDaysLater)).toEqual(['exchange_overdue']);
    });
    it('교환 열림 있음 → []', () => {
      expect(
        customerReturnAttention({ ...exchange, exchangeReleasedAt: new Date('2026-10-27T00:00:00Z') }, late),
      ).toEqual([]);
    });
    it('반품은 지금처럼 refund_overdue', () => {
      expect(customerReturnAttention(base, fourBusinessDaysLater)).toEqual(['refund_overdue']);
    });
    it('교환 held → held 다음 exchange_overdue', () => {
      expect(customerReturnAttention({ ...exchange, status: 'held' }, fourBusinessDaysLater)).toEqual([
        'held',
        'exchange_overdue',
      ]);
    });
    it('끝난 교환(settled·cancelled)은 기한을 따지지 않는다', () => {
      expect(customerReturnAttention({ ...exchange, status: 'settled' }, late)).toEqual([]);
      expect(customerReturnAttention({ ...exchange, status: 'cancelled' }, late)).toEqual([]);
    });
    it('교환 기한 그 밀리초까지는 정상', () => {
      expect(customerReturnAttention(exchange, due)).toEqual([]);
    });
  });
});
