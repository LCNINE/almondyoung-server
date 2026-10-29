import type { MedusaOrder, MedusaReturn } from '../../adapters/medusa/medusa.client';
import { medusaReturnObservations } from './medusa-return-observations';

const record = (over: Record<string, unknown> = {}) => ({
  almondReturn: {
    requestId: 'req_1',
    requestHash: 'h',
    requestedBy: 'customer',
    reasonValue: 'change_of_mind',
    feeBearer: 'customer',
    windowOverride: null,
    ...over,
  },
});

const ret = (over: Partial<MedusaReturn> = {}): MedusaReturn => ({
  id: 'ret_1',
  status: 'requested',
  requested_at: '2026-10-27T01:00:00.000Z',
  canceled_at: null,
  metadata: record(),
  items: [{ item_id: 'item_1', quantity: 1 }],
  ...over,
});

const order = (returns?: MedusaReturn[]): MedusaOrder =>
  ({ id: 'order_1', updated_at: '2026-10-27T02:00:00.000Z', ...(returns ? { returns } : {}) }) as MedusaOrder;

describe('medusaReturnObservations', () => {
  it('메모를 다듬어 requested 관측에 싣는다', () => {
    const { observations, skipped } = medusaReturnObservations(
      order([ret({ metadata: record({ note: '  포장이 찢어졌어요\n ' }) })]),
    );

    expect(skipped).toEqual([]);
    expect(observations[0]).toMatchObject({ payload: { note: '포장이 찢어졌어요' } });
  });

  it.each([undefined, null, '', ' \n ', 42, {}])('메모 %p는 생략하고 반품은 관측한다', (note) => {
    const { observations, skipped } = medusaReturnObservations(order([ret({ metadata: record({ note }) })]));

    expect(skipped).toEqual([]);
    expect(observations).toHaveLength(1);
    expect(observations[0].payload).not.toHaveProperty('note');
  });

  it('확정된 반품 하나 → requested 관측 하나', () => {
    const { observations, skipped } = medusaReturnObservations(order([ret()]));
    expect(skipped).toEqual([]);
    expect(observations).toHaveLength(1);
    expect(observations[0].payload).not.toHaveProperty('note');
    expect(observations[0]).toMatchObject({
      eventType: 'ChannelReturnRequested',
      eventKey: 'return:ret_1:requested',
      payload: {
        returnId: 'ret_1',
        requestId: 'req_1',
        reason: 'change_of_mind',
        feeBearer: 'customer',
        requestedBy: 'customer',
        requestedAt: '2026-10-27T01:00:00.000Z',
        items: [{ channelOrderItemId: 'item_1', quantity: 1 }],
      },
    });
  });

  it('취소된 반품 → requested 다음 cancelled', () => {
    const { observations } = medusaReturnObservations(
      order([ret({ status: 'canceled', canceled_at: '2026-10-27T01:30:00.000Z' })]),
    );
    expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested', 'return:ret_1:cancelled']);
    expect(observations[1]).toMatchObject({
      eventType: 'ChannelReturnCancelled',
      payload: { returnId: 'ret_1', cancelledAt: '2026-10-27T01:30:00.000Z' },
    });
  });

  it('canceled_at 이 비면 주문의 갱신 시각으로 대신한다', () => {
    const { observations } = medusaReturnObservations(order([ret({ status: 'canceled', canceled_at: null })]));
    expect(observations[1]).toMatchObject({ payload: { cancelledAt: '2026-10-27T02:00:00.000Z' } });
  });

  it('CS 가 기한을 넘긴 반품은 windowOverrideReason 을 싣는다', () => {
    const { observations } = medusaReturnObservations(
      order([
        ret({
          metadata: record({ requestedBy: 'operator', windowOverride: { reason: '고객 사정', actorId: 'u1' } }),
        }),
      ]),
    );
    expect(observations[0]).toMatchObject({
      payload: { requestedBy: 'operator', windowOverrideReason: '고객 사정' },
    });
  });

  it('확정 전·기록 없음·사유 6종 밖·품목 0 반품은 관측하지 않고 이유를 남긴다', () => {
    const { observations, skipped } = medusaReturnObservations(
      order([
        ret({ id: 'r_open', status: 'open', requested_at: null }),
        ret({ id: 'r_norec', metadata: {} }),
        ret({ id: 'r_badreason', metadata: record({ reasonValue: 'nope' }) }),
        ret({ id: 'r_noitems', items: [{ item_id: 'item_1', quantity: 0 }, { quantity: 2 }] }),
      ]),
    );
    expect(observations).toEqual([]);
    expect(skipped).toEqual([
      { returnId: 'r_open', reason: 'unconfirmed' },
      { returnId: 'r_norec', reason: 'no_record' },
      { returnId: 'r_badreason', reason: 'no_record' },
      { returnId: 'r_noitems', reason: 'no_items' },
    ]);
  });

  it('반품이 여럿이면 requested_at 오름차순', () => {
    const { observations } = medusaReturnObservations(
      order([
        ret({ id: 'ret_b', requested_at: '2026-10-27T03:00:00.000Z' }),
        ret({ id: 'ret_a', requested_at: '2026-10-27T01:00:00.000Z' }),
      ]),
    );
    expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_a:requested', 'return:ret_b:requested']);
  });

  it('returns 칸이 없는 옛 응답 → 관측 0, skipped 0', () => {
    expect(medusaReturnObservations(order())).toEqual({ observations: [], skipped: [] });
  });

  describe('정산 (K8 PR6)', () => {
    const settlement = (over: Record<string, unknown> = {}) => ({
      ...record(),
      almondReturnSettlement: {
        requestId: 'cr_1',
        requestHash: 'h',
        stage: 'refunded',
        items: [{ itemId: 'item_1', received: 1, dismissed: 0 }],
        deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
        feeNotAdjusted: false,
        refundAmount: 24000,
        refundedAt: '2026-10-27T05:00:00.000Z',
        refundMode: 'auto',
        ...over,
      },
    });

    it('정산 끝난 반품 → requested 다음 settled', () => {
      const { observations, skipped } = medusaReturnObservations(
        order([ret({ status: 'received', metadata: settlement() })]),
      );
      expect(skipped).toEqual([]);
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested', 'return:ret_1:settled']);
      expect(observations[1]).toMatchObject({
        eventType: 'ChannelReturnSettled',
        payload: {
          returnId: 'ret_1',
          requestId: 'cr_1',
          refundAmount: 24000,
          deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
          feeNotAdjusted: false,
          refundMode: 'auto',
          settledAt: '2026-10-27T05:00:00.000Z',
          items: [{ channelOrderItemId: 'item_1', received: 1, dismissed: 0 }],
        },
      });
    });

    it('partially_received 도 settled 를 낸다', () => {
      const { observations } = medusaReturnObservations(
        order([ret({ status: 'partially_received', metadata: settlement() })]),
      );
      expect(observations.map((o) => o.eventKey)).toContain('return:ret_1:settled');
    });

    it('received 단계 기록은 settled 를 내지 않는다', () => {
      const { observations, skipped } = medusaReturnObservations(
        order([ret({ status: 'received', metadata: settlement({ stage: 'received' }) })]),
      );
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested']);
      expect(skipped).toEqual([]);
    });

    it('반품 status 가 requested 면(아직 수령 전) settled 를 내지 않는다', () => {
      const { observations } = medusaReturnObservations(order([ret({ metadata: settlement() })]));
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested']);
    });

    it.each([
      ['requestId 없음', { requestId: undefined }],
      ['환불액 소수', { refundAmount: 100.5 }],
      ['차감 한 칸 누락', { deduction: { returnShipping: 1, freeShippingBreak: 1 } }],
      ['환불 방식 모름', { refundMode: 'x' }],
      ['refundedAt 없음', { refundedAt: undefined }],
      ['줄 없음', { items: [] }],
    ])('끝난 기록의 모양이 어긋나면 no_settlement_record — %s', (_n, patch) => {
      const { observations, skipped } = medusaReturnObservations(
        order([ret({ status: 'received', metadata: settlement(patch) })]),
      );
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested']);
      expect(skipped).toEqual([{ returnId: 'ret_1', reason: 'no_settlement_record' }]);
    });
  });

  describe('선환불 (K8 PR6b)', () => {
    const prepay = (over: Record<string, unknown> = {}) => ({
      ...record(),
      almondReturnPrepay: {
        requestId: 'cr_1',
        requestHash: 'h',
        stage: 'refunded',
        amount: 8000,
        itemValue: 20000,
        feeEstimate: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
        memo: 'm',
        requestedAt: '2026-10-27T03:00:00.000Z',
        refundedAt: '2026-10-27T03:05:00.000Z',
        refundMode: 'auto',
        ...over,
      },
    });

    it('선환불 끝난 반품 → requested 다음 prepaid', () => {
      const { observations, skipped } = medusaReturnObservations(order([ret({ metadata: prepay() })]));
      expect(skipped).toEqual([]);
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested', 'return:ret_1:prepaid']);
      expect(observations[1]).toMatchObject({
        eventType: 'ChannelReturnPrepaid',
        payload: {
          returnId: 'ret_1',
          requestId: 'cr_1',
          amount: 8000,
          refundMode: 'auto',
          prepaidAt: '2026-10-27T03:05:00.000Z',
        },
      });
    });

    it('requested 단계 선환불 기록은 prepaid 를 내지 않는다', () => {
      const { observations, skipped } = medusaReturnObservations(
        order([ret({ metadata: prepay({ stage: 'requested', refundedAt: undefined, refundMode: undefined }) })]),
      );
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested']);
      expect(skipped).toEqual([]);
    });

    it.each([
      ['requestId 없음', { requestId: undefined }],
      ['금액 소수', { amount: 100.5 }],
      ['금액 0', { amount: 0 }],
      ['refundedAt 없음', { refundedAt: undefined }],
      ['환불 방식 모름', { refundMode: 'x' }],
    ])('끝난 기록의 모양이 어긋나면 no_prepay_record — %s', (_n, patch) => {
      const { observations, skipped } = medusaReturnObservations(order([ret({ metadata: prepay(patch) })]));
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested']);
      expect(skipped).toEqual([{ returnId: 'ret_1', reason: 'no_prepay_record' }]);
    });

    it('선환불 뒤 정산까지 끝나면 requested → prepaid → settled 순서', () => {
      const settled = {
        requestId: 'cr_1',
        requestHash: 'h',
        stage: 'refunded',
        items: [{ itemId: 'item_1', received: 1, dismissed: 0 }],
        deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
        feeNotAdjusted: false,
        refundAmount: 4000,
        refundedAt: '2026-10-27T05:00:00.000Z',
        refundMode: 'auto',
      };
      const { observations } = medusaReturnObservations(
        order([ret({ status: 'received', metadata: { ...prepay(), almondReturnSettlement: settled } })]),
      );
      expect(observations.map((o) => o.eventKey)).toEqual([
        'return:ret_1:requested',
        'return:ret_1:prepaid',
        'return:ret_1:settled',
      ]);
    });
  });

  describe('정산의 새 칸 (K8 PR6b)', () => {
    const settlement = (over: Record<string, unknown> = {}, deduction: Record<string, unknown> = {}) => ({
      ...record(),
      almondReturnSettlement: {
        requestId: 'cr_1',
        requestHash: 'h',
        stage: 'refunded',
        items: [{ itemId: 'item_1', received: 1, dismissed: 0 }],
        deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0, ...deduction },
        feeNotAdjusted: false,
        refundAmount: 9000,
        refundedAt: '2026-10-27T05:00:00.000Z',
        refundMode: 'auto',
        ...over,
      },
    });
    const settledOf = (metadata: Record<string, unknown>) =>
      medusaReturnObservations(order([ret({ status: 'received', metadata })])).observations.find(
        (o) => o.eventType === 'ChannelReturnSettled',
      );

    it('보류 차감·선환불 상계가 있는 정산 → settled 에 칸', () => {
      const settled = settledOf(settlement({ prepaidApplied: 8000, externalRefundApplied: 2000 }, { hold: 5000 }));
      expect(settled).toMatchObject({
        payload: {
          deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0, hold: 5000 },
          prepaidAmount: 8000,
          externalRefundApplied: 2000,
        },
      });
    });

    it.each([0, 2500])('배송비 환불 %i를 관측에 싣는다', (shippingRefund) => {
      expect(settledOf(settlement({ shippingRefund }))?.payload).toMatchObject({ shippingRefund });
    });

    it.each([-1, 0.5, '2500', null, Number.NaN])('잘못된 배송비 환불 %p는 정산 관측을 막는다', (shippingRefund) => {
      const result = medusaReturnObservations(
        order([ret({ status: 'received', metadata: settlement({ shippingRefund }) })]),
      );

      expect(result.skipped).toEqual([{ returnId: 'ret_1', reason: 'no_settlement_record' }]);
      expect(result.observations.some((o) => o.eventType === 'ChannelReturnSettled')).toBe(false);
    });

    it('새 칸이 없는 옛 기록 → 칸을 생략한다', () => {
      const settled = settledOf(settlement());
      expect(settled?.payload).not.toHaveProperty('shippingRefund');
      expect(settled?.payload).not.toHaveProperty('prepaidAmount');
      expect(settled?.payload).not.toHaveProperty('externalRefundApplied');
      expect((settled?.payload as { deduction: object }).deduction).not.toHaveProperty('hold');
    });

    it('새 칸의 모양이 어긋나면 no_settlement_record', () => {
      const { skipped } = medusaReturnObservations(
        order([ret({ status: 'received', metadata: settlement({ prepaidApplied: -1 }) })]),
      );
      expect(skipped).toEqual([{ returnId: 'ret_1', reason: 'no_settlement_record' }]);
    });
  });
  describe('교환 (K8 PR11)', () => {
    const exchangeRecord = (kind: unknown = 'exchange') => ({
      almondReturn: { ...record().almondReturn, kind, feeBearer: 'seller', reasonValue: 'defective' },
    });
    const exchanged = (over: Record<string, unknown> = {}) => ({
      ...exchangeRecord(),
      almondReturnSettlement: {
        requestId: 'cr_1',
        requestHash: 'h',
        stage: 'exchanged',
        items: [{ itemId: 'item_1', received: 1, dismissed: 0 }],
        deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0 },
        feeNotAdjusted: false,
        refundAmount: 0,
        exchangedAt: '2026-10-28T05:00:00.000Z',
        exchangeItems: [{ sourceItemId: 'item_1', itemId: 'item_x', quantity: 1 }],
        ...over,
      },
    });

    it('kind exchange 기록 -> ChannelReturnRequested.kind exchange', () => {
      const { observations } = medusaReturnObservations(order([ret({ metadata: exchangeRecord() })]));
      expect(observations[0].payload).toMatchObject({ kind: 'exchange' });
    });

    it('kind 없는 기록 -> payload 에 kind 칸 없음', () => {
      const { observations } = medusaReturnObservations(order([ret()]));
      expect(observations[0].payload).not.toHaveProperty('kind');
    });

    it('kind swap -> skipped no_record', () => {
      const { observations, skipped } = medusaReturnObservations(order([ret({ metadata: exchangeRecord('swap') })]));
      expect(observations).toEqual([]);
      expect(skipped).toEqual([{ returnId: 'ret_1', reason: 'no_record' }]);
    });

    it('exchanged 기록 -> ChannelReturnSettled { refundAmount 0, refundMode auto, settledAt = exchangedAt, exchangeItems }', () => {
      const { observations, skipped } = medusaReturnObservations(
        order([ret({ status: 'received', metadata: exchanged() })]),
      );
      expect(skipped).toEqual([]);
      expect(observations.map((o) => o.eventKey)).toEqual(['return:ret_1:requested', 'return:ret_1:settled']);
      expect(observations[1].payload).toMatchObject({
        refundAmount: 0,
        refundMode: 'auto',
        settledAt: '2026-10-28T05:00:00.000Z',
        exchangeItems: [{ sourceItemId: 'item_1', itemId: 'item_x', quantity: 1 }],
        items: [{ channelOrderItemId: 'item_1', received: 1, dismissed: 0 }],
      });
    });

    it('exchangeItems 가 빈 exchanged 기록 -> no_settlement_record', () => {
      const { skipped } = medusaReturnObservations(
        order([ret({ status: 'received', metadata: exchanged({ exchangeItems: [] }) })]),
      );
      expect(skipped).toEqual([{ returnId: 'ret_1', reason: 'no_settlement_record' }]);
    });
  });
});
