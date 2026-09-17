import { ORDER_STREAM } from '@packages/event-contracts/streams';
import { DemoOrderProvider, fixtureIdentityForVariant } from './demo-order.provider';

describe('DemoOrderProvider', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const createdAt = new Date('2026-09-16T12:00:00.000Z');

  it('builds stable item/order identities and a schema-valid confirmed order', async () => {
    const providerA = DemoOrderProvider.forRun({
      requestId,
      scenario: 'happy_path',
      count: 1,
      variantId: '019f1003-0001-7000-a000-000000000001',
      quantity: 2,
      createdAt,
    });
    const providerB = DemoOrderProvider.forRun({
      requestId,
      scenario: 'happy_path',
      count: 1,
      variantId: '019f1003-0001-7000-a000-000000000001',
      quantity: 2,
      createdAt,
    });

    const first = (await providerA.fetchOrders(null)).orders[0];
    const replay = (await providerB.fetchOrders(null)).orders[0];

    expect(first.createPayload).toEqual(replay.createPayload);
    expect(first.createPayload.status).toBe('confirmed');
    expect(first.createPayload.salesChannel).toBe('medusa');
    expect(first.createPayload.items[0]).toMatchObject({
      variantId: '019f1003-0001-7000-a000-000000000001',
      masterId: '019f1001-0001-7000-a000-000000000001',
      versionId: '019f1002-0001-7000-a000-000000000001',
      channelProductId: 'DEMO-SKU-001',
      productName: '데모 물류 상품 01',
      quantity: 2,
      unitPrice: 10_000,
      totalPrice: 20_000,
    });
    expect(ORDER_STREAM.events.OrderCreated.schema?.safeParse(first.createPayload).success).toBe(true);
  });

  it('rejects variant ids outside the versioned demo fixture namespace', () => {
    expect(() => fixtureIdentityForVariant('11111111-1111-4111-8111-111111111111')).toThrow(
      'variantId is not part of demo-logistics-v1',
    );
  });

  it('emits multiple persisted lines with stable line identities and correct totals', async () => {
    const lines = [
      {
        orderItemId: 'demo-line-a',
        skuId: '44444444-4444-4444-8444-444444444444',
        masterId: '22222222-2222-4222-8222-222222222222',
        versionId: '33333333-3333-4333-8333-333333333333',
        variantId: '11111111-1111-4111-8111-111111111111',
        sku: 'SKU-A',
        productName: '상품 A',
        availableQuantity: 8,
        components: [{ skuId: '44444444-4444-4444-8444-444444444444', quantity: 1, availableQuantity: 8 }],
        quantity: 2,
        unitPrice: 12000,
        totalPrice: 24000,
      },
      {
        orderItemId: 'demo-line-b',
        skuId: '88888888-8888-4888-8888-888888888888',
        masterId: '66666666-6666-4666-8666-666666666666',
        versionId: '77777777-7777-4777-8777-777777777777',
        variantId: '55555555-5555-4555-8555-555555555555',
        sku: 'SKU-B',
        productName: '상품 B',
        availableQuantity: 9,
        components: [{ skuId: '88888888-8888-4888-8888-888888888888', quantity: 1, availableQuantity: 9 }],
        quantity: 3,
        unitPrice: 7000,
        totalPrice: 21000,
      },
    ];
    const provider = DemoOrderProvider.forPersistedItem(
      {
        requestId,
        scenario: 'happy_path',
        count: 1,
        variantId: lines[0].variantId,
        quantity: lines[0].quantity,
        createdAt,
      },
      1,
      lines,
    );

    const order = (await provider.fetchOrders(null)).orders[0].createPayload;

    expect(order.items.map((item) => item.orderItemId)).toEqual(['demo-line-a', 'demo-line-b']);
    expect(order.subtotalAmount).toBe(45000);
    expect(order.totalAmount).toBe(45000);
    expect(ORDER_STREAM.events.OrderCreated.schema?.safeParse(order).success).toBe(true);
  });
});
