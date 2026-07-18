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
