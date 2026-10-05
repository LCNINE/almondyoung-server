import { ORDER_STREAM, type OrderCreatedPayload } from './orders.stream';

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
