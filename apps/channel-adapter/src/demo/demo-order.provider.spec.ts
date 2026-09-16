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
});
