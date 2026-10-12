import { ORDER_STREAM } from '../orders.stream';

describe('OrderModified.snapshot.cancelRequests (#1016 35번 PR-C)', () => {
  const schema = ORDER_STREAM.events.OrderModified.schema!;
  const base = {
    orderId: 'wms-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_1',
    modifiedAt: '2026-10-07T00:00:00.000Z',
    snapshot: {
      lines: [{ channelOrderItemId: 'item_1', channelProductId: 'v_1', quantity: 1, unitPrice: 1000, cancelled: false }],
      shippingAddress: { recipientName: '김', phone: '010', postalCode: '1', roadAddress: '서울', detailAddress: '1' },
    },
  };
  const record = {
    requestId: 'req-1',
    stage: 'refunded',
    refundAmount: 27500,
    shippingCharge: 3000,
    shippingRefund: 0,
    shippingNotAdjusted: false,
  };

  it('없으면 예전 모양 그대로 통과한다', () => {
    expect(schema.parse(base)).toEqual(base);
  });

  it('진행 기록을 그대로 싣는다', () => {
    const payload = { ...base, snapshot: { ...base.snapshot, cancelRequests: [record] } };
    expect(schema.parse(payload)).toEqual(payload);
  });

  it.each([
    ['모르는 단계', { stage: 'canceled' }],
    ['빈 requestId', { requestId: '' }],
    ['음수 환불액', { refundAmount: -1 }],
  ])('%s 는 거절한다', (_label, over) => {
    const payload = { ...base, snapshot: { ...base.snapshot, cancelRequests: [{ ...record, ...over }] } };
    expect(() => schema.parse(payload)).toThrow();
  });
});
