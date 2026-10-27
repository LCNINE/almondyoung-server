import { CUSTOMER_RETURN_REASONS, ORDER_STREAM, type OrderCreatedPayload } from './orders.stream';

const BASE_ITEM = {
  skuId: 'sku-1',
  masterId: 'master-1',
  versionId: 'version-1',
  variantId: 'variant-1',
  productName: 'Product',
  quantity: 1,
  unitPrice: 1000,
  totalPrice: 1000,
};

function payload(items: OrderCreatedPayload['items']): OrderCreatedPayload {
  return {
    orderId: 'internal-event-order-1',
    externalOrderId: 'channel-order-1',
    salesChannel: 'naver',
    customerId: null,
    items,
    totalAmount: 1000,
    subtotalAmount: 1000,
    shippingAmount: 0,
    discountAmount: 0,
    currency: 'KRW',
    shippingAddress: {
      recipientName: 'Recipient',
      phone: '',
      postalCode: '',
      roadAddress: '',
      detailAddress: '',
    },
    status: 'confirmed',
    createdAt: '2026-07-14T01:00:00.000Z',
  };
}

describe('ORDER_STREAM external line identity', () => {
  const schema = ORDER_STREAM.events.OrderCreated.schema!;

  it('preserves provider order-line and product identities independently', () => {
    const event = payload([
      {
        ...BASE_ITEM,
        orderItemId: 'naver-product-order-1',
        channelProductId: 'naver-product-9',
      },
    ]);

    expect(schema.parse(event)).toEqual(event);
  });

  it.each([
    { ...BASE_ITEM, orderItemId: 'provider-order-line-only' },
    { ...BASE_ITEM, channelProductId: 'provider-product-only' },
    { ...BASE_ITEM },
  ])('accepts legacy/manual items without fabricating the unavailable identity', (item) => {
    expect(schema.parse(payload([item]))).toEqual(payload([item]));
  });

  it.each([
    { ...BASE_ITEM, orderItemId: '' },
    { ...BASE_ITEM, channelProductId: '   ' },
  ])('rejects an explicitly supplied empty provider identity', (item) => {
    expect(() => schema.parse(payload([item]))).toThrow();
  });
});

describe('OrderCancelled 계약', () => {
  const schema = ORDER_STREAM.events.OrderCancelled.schema!;

  const base = {
    orderId: 'ord_1',
    reason: 'CUSTOMER_REQUEST' as const,
    cancelledBy: 'naver',
    cancelledAt: '2026-08-19T00:00:00.000Z',
    refundRequired: true,
  };

  it('cancelledLines 없이도 통과한다 (전체 취소)', () => {
    expect(schema.safeParse(base).success).toBe(true);
  });

  it('cancelledLines 가 있으면 통과한다 (부분 취소)', () => {
    const result = schema.safeParse({
      ...base,
      cancelledLines: [{ channelOrderItemId: '2026081900001', quantity: 2 }],
    });
    expect(result.success).toBe(true);
  });

  it('빈 배열은 거부한다 — 전체 취소는 필드를 생략해서 표현한다', () => {
    expect(schema.safeParse({ ...base, cancelledLines: [] }).success).toBe(false);
  });

  it('수량 0 이하를 거부한다', () => {
    const result = schema.safeParse({
      ...base,
      cancelledLines: [{ channelOrderItemId: '2026081900001', quantity: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('OrderCreated 계약 — entrancePassword', () => {
  const base = {
    orderId: 'order_1',
    salesChannel: 'medusa' as const,
    customerId: null,
    items: [],
    totalAmount: 1000,
    subtotalAmount: 1000,
    shippingAmount: 0,
    discountAmount: 0,
    currency: 'KRW',
    shippingAddress: {
      recipientName: '홍길동',
      phone: '01000000000',
      postalCode: '00000',
      roadAddress: '서울시 어딘가',
      detailAddress: '101호',
    },
    status: 'pending' as const,
    createdAt: '2026-08-21T00:00:00.000Z',
  };

  it('entrancePassword 를 실으면 파싱 결과에 남는다', () => {
    const parsed = ORDER_STREAM.events.OrderCreated.schema!.parse({ ...base, entrancePassword: '#1234' });
    expect(parsed.entrancePassword).toBe('#1234');
  });

  it('entrancePassword 는 선택 필드다 — 없어도 통과한다', () => {
    expect(ORDER_STREAM.events.OrderCreated.schema!.safeParse(base).success).toBe(true);
  });

  it('배송지 스냅샷 안에는 비번 자리가 없다', () => {
    const withNested = {
      ...base,
      shippingAddress: { ...base.shippingAddress, entrancePassword: '#1234' },
    };
    const parsed = ORDER_STREAM.events.OrderCreated.schema!.parse(withNested);
    expect((parsed.shippingAddress as unknown as Record<string, unknown>).entrancePassword).toBeUndefined();
  });
});

describe('ORDER_STREAM OrderModified snapshot', () => {
  const schema = ORDER_STREAM.events.OrderModified.schema!;
  const base = {
    orderId: 'wms-order-1',
    salesChannel: 'naver' as const,
    externalOrderId: 'channel-order-1',
    modifiedAt: '2026-10-05T10:00:00+09:00',
    snapshot: {
      lines: [
        { channelOrderItemId: 'po-1', channelProductId: 'p-1', quantity: 0, unitPrice: 5000, cancelled: false },
        { channelOrderItemId: null, channelProductId: null, quantity: 1, unitPrice: 0, cancelled: true },
      ],
      shippingAddress: { recipientName: 'R', phone: '', postalCode: '', roadAddress: '', detailAddress: '' },
    },
  };

  it('네이버 +09:00 시각·수량 0·식별 없는 라인을 받는다', () => {
    expect(schema.parse(base)).toEqual(base);
  });

  it('채널 키가 없으면 거부한다 — core 가 판매주문을 못 찾는다', () => {
    const { externalOrderId: _drop, ...withoutKey } = base;
    expect(() => schema.parse(withoutKey)).toThrow();
  });

  it('음수 수량은 거부한다', () => {
    const bad = { ...base, snapshot: { ...base.snapshot, lines: [{ ...base.snapshot.lines[0], quantity: -1 }] } };
    expect(() => schema.parse(bad)).toThrow();
  });
});

describe('ChannelReturnRequested / ChannelReturnCancelled', () => {
  const requested = ORDER_STREAM.events.ChannelReturnRequested.schema!;
  const cancelled = ORDER_STREAM.events.ChannelReturnCancelled.schema!;

  const requestedPayload = {
    orderId: 'wms-order-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_01',
    returnId: 'ret_01',
    requestId: 'req-1',
    reason: 'defective',
    feeBearer: 'seller',
    requestedBy: 'customer',
    requestedAt: '2026-10-27T01:00:00.000Z',
    items: [{ channelOrderItemId: 'item_01', quantity: 1 }],
  };
  const cancelledPayload = {
    orderId: 'wms-order-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_01',
    returnId: 'ret_01',
    cancelledAt: '2026-10-27T02:00:00.000Z',
  };

  it('정상 payload 를 통과시킨다', () => {
    expect(() => requested.parse(requestedPayload)).not.toThrow();
    expect(() => requested.parse({ ...requestedPayload, windowOverrideReason: '고객 센터 승인' })).not.toThrow();
    expect(() => cancelled.parse(cancelledPayload)).not.toThrow();
  });

  it('사유 어휘가 Medusa RETURN_REASONS 와 같다', () => {
    expect([...CUSTOMER_RETURN_REASONS]).toEqual([
      'change_of_mind',
      'defective',
      'not_as_described',
      'wrong_item',
      'damaged_in_shipping',
      'other',
    ]);
  });

  it.each([
    ['빈 items', { items: [] }],
    ['수량 0', { items: [{ channelOrderItemId: 'item_01', quantity: 0 }] }],
    ['옛 사유', { reason: 'SIZE_NOT_FIT' }],
    ['salesChannel 누락', { salesChannel: undefined }],
    ['externalOrderId 누락', { externalOrderId: undefined }],
    ['requestedAt 형식', { requestedAt: '2026-10-27' }],
  ])('요청: %s 는 거절한다', (_n, patch) => {
    expect(() => requested.parse({ ...requestedPayload, ...patch })).toThrow();
  });

  it.each([
    ['cancelledAt 형식', { cancelledAt: 'yesterday' }],
    ['salesChannel 누락', { salesChannel: undefined }],
  ])('취소: %s 는 거절한다', (_n, patch) => {
    expect(() => cancelled.parse({ ...cancelledPayload, ...patch })).toThrow();
  });

  it('옛 OrderReturnRequested 는 계약에 없다', () => {
    expect(Object.keys(ORDER_STREAM.events)).not.toContain('OrderReturnRequested');
  });
});

describe('ChannelReturnSettled / ChannelReturnSettlementFailed (K8 PR6)', () => {
  const settled = ORDER_STREAM.events.ChannelReturnSettled.schema!;
  const failed = ORDER_STREAM.events.ChannelReturnSettlementFailed.schema!;
  const settledPayload = {
    orderId: 'wms-order-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_01',
    returnId: 'ret_01',
    requestId: 'req-1',
    refundAmount: 9000,
    deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0 },
    feeNotAdjusted: false,
    refundMode: 'auto',
    settledAt: '2026-10-27T03:00:00.000Z',
    items: [{ channelOrderItemId: 'item_01', received: 1, dismissed: 0 }],
  };
  const failedPayload = {
    requestId: 'req-1',
    salesChannel: 'medusa',
    externalOrderId: 'order_01',
    returnId: 'ret_01',
    received: true,
    retryable: true,
    failureCode: 'http_502',
    message: 'bad gateway',
    at: '2026-10-27T03:00:00.000Z',
  };

  it('정상 payload 를 통과시킨다', () => {
    expect(() => settled.parse(settledPayload)).not.toThrow();
    expect(() => failed.parse(failedPayload)).not.toThrow();
  });

  it('정산 사실의 음수 환불액·정수 아닌 공제·채널 누락은 거부한다', () => {
    expect(() => settled.parse({ ...settledPayload, refundAmount: -1 })).toThrow();
    expect(() =>
      settled.parse({ ...settledPayload, deduction: { ...settledPayload.deduction, roundTrip: 1.5 } }),
    ).toThrow();
    const { salesChannel: _omit, ...noChannel } = settledPayload;
    expect(() => settled.parse(noChannel)).toThrow();
  });

  it('실패 사실은 received 가 필수다', () => {
    const { received: _omit, ...noReceived } = failedPayload;
    expect(() => failed.parse(noReceived)).toThrow();
  });
});
