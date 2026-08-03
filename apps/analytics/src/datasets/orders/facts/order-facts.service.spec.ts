import type { DomainEvent } from '@packages/event-contracts/types';
import type { OrderCreatedPayload } from '@packages/event-contracts/streams/orders.stream';
import { factOrderEvents, factOrderItems } from '../../../schema';
import { OrderFactsService } from './order-facts.service';

function orderPayload(): OrderCreatedPayload {
  return {
    orderId: 'order-event-1',
    externalOrderId: 'channel-order-1',
    salesChannel: 'naver',
    customerId: null,
    items: [
      {
        skuId: 'sku-1',
        masterId: 'master-1',
        versionId: 'version-1',
        variantId: 'variant-1',
        productName: 'Legacy product',
        quantity: 2,
        unitPrice: 1000,
        totalPrice: 2000,
      },
    ],
    totalAmount: 2000,
    subtotalAmount: 2000,
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

function envelope(payload: OrderCreatedPayload): DomainEvent<OrderCreatedPayload> {
  return {
    messageId: '01J00000000000000000000001',
    messageType: 'OrderCreated',
    messageVersion: 1,
    messageKind: 'event',
    correlationId: '01J00000000000000000000002',
    timestamp: '2026-07-14T01:00:00.000Z',
    source: {
      service: 'channel-adapter',
      aggregateType: 'Order',
      aggregateId: payload.orderId,
    },
    payload,
  };
}

describe('OrderFactsService', () => {
  function makeService() {
    const claimedMessageIds = new Set<string>();
    const factEventValues: Array<Record<string, unknown>> = [];
    const factItemValues: Array<Record<string, unknown>> = [];

    const executor = {
      insert: jest.fn((table: unknown) => ({
        values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
          if (table === factOrderEvents) {
            const event = values as Record<string, unknown>;
            return {
              onConflictDoNothing: () => ({
                returning: () => {
                  const messageId = String(event.messageId);
                  if (claimedMessageIds.has(messageId)) return Promise.resolve([]);
                  claimedMessageIds.add(messageId);
                  factEventValues.push(event);
                  return Promise.resolve([{ messageId }]);
                },
              }),
            };
          }

          if (table === factOrderItems) {
            const items = Array.isArray(values) ? values : [values];
            return {
              onConflictDoNothing: () => ({
                returning: () => {
                  factItemValues.push(...items);
                  return Promise.resolve(
                    items.map((item) => ({
                      masterId: item.masterId,
                      variantId: item.variantId,
                      quantity: item.quantity,
                      totalPrice: item.totalPrice,
                    })),
                  );
                },
              }),
            };
          }

          throw new Error('Unexpected analytics table');
        },
      })),
    };
    const dbService = { db: { transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(executor)) } };
    const service = new OrderFactsService(dbService as never);
    return { service, factEventValues, factItemValues };
  }

  it('persists unavailable provider identities as null without manufacturing an order or product ID', async () => {
    const { service, factItemValues } = makeService();
    const payload = orderPayload();

    const result = await service.recordOrderCreated(envelope(payload), payload);

    expect(result).toEqual({
      claimed: true,
      seeds: [
        {
          masterId: 'master-1',
          salesChannel: 'naver',
          occurredDate: '2026-07-14',
          orderCount: 1,
          quantitySold: 2,
          revenue: 2000,
        },
      ],
      variantSeeds: [
        {
          variantId: 'variant-1',
          masterId: 'master-1',
          salesChannel: 'naver',
          occurredDate: '2026-07-14',
          quantitySold: 2,
          revenue: 2000,
        },
      ],
      channelSeed: {
        salesChannel: 'naver',
        occurredDate: '2026-07-14',
        ordersCount: 1,
        grossRevenue: 2000,
      },
      customerSeed: null,
    });
    expect(factItemValues).toHaveLength(1);
    expect(factItemValues[0]).toMatchObject({
      orderKey: 'channel-order-1',
      orderItemId: null,
      channelProductId: null,
    });
    expect(factItemValues[0].orderItemId).not.toBe(payload.orderId);
    expect(factItemValues[0].orderItemId).not.toBe(payload.externalOrderId);
  });

  it('claims messageId first and skips duplicate item facts and aggregate seeds', async () => {
    const { service, factEventValues, factItemValues } = makeService();
    const payload = orderPayload();
    const event = envelope(payload);

    const first = await service.recordOrderCreated(event, payload);
    const duplicate = await service.recordOrderCreated(event, payload);

    expect(first.claimed).toBe(true);
    expect(duplicate).toEqual({
      claimed: false,
      seeds: [],
      variantSeeds: [],
      channelSeed: null,
      customerSeed: null,
    });
    expect(factEventValues).toHaveLength(1);
    expect(factItemValues).toHaveLength(1);
  });
});

describe('OrderFactsService seed 확장', () => {
  const envelope = {
    messageId: '01J00000000000000000000010',
    messageType: 'OrderCreated',
    messageVersion: 1,
    messageKind: 'event',
    correlationId: '01J00000000000000000000011',
    timestamp: '2026-07-14T01:00:00.000Z',
    source: { service: 'channel-adapter', aggregateType: 'Order', aggregateId: 'order-10' },
    payload: {},
  };

  const payload = {
    orderId: 'order-10',
    externalOrderId: 'channel-order-10',
    salesChannel: 'naver',
    customerId: 'customer-10',
    currency: 'KRW',
    createdAt: '2026-07-14T01:00:00.000Z',
    items: [
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, unitPrice: 1000, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, unitPrice: 3000, totalPrice: 3000 },
    ],
  };

  function makeService(insertedItems: unknown[]) {
    const executor = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest
              .fn()
              .mockResolvedValueOnce([{ messageId: envelope.messageId }])
              .mockResolvedValueOnce(insertedItems),
          }),
        }),
      }),
    };
    const dbService = { db: { transaction: jest.fn((fn: (e: unknown) => unknown) => fn(executor)) } };
    return new OrderFactsService(dbService as never);
  }

  it('상품 seed 에 매출을 담는다', async () => {
    const service = makeService([
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, totalPrice: 3000 },
    ]);

    const result = await service.recordOrderCreated(envelope as never, payload as never);

    expect(result.seeds).toEqual([
      {
        masterId: 'master-1',
        salesChannel: 'naver',
        occurredDate: '2026-07-14',
        orderCount: 1,
        quantitySold: 3,
        revenue: 5000,
      },
    ]);
  });

  it('옵션별 seed 를 variantId 단위로 쪼갠다', async () => {
    const service = makeService([
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, totalPrice: 3000 },
    ]);

    const result = await service.recordOrderCreated(envelope as never, payload as never);

    expect(result.variantSeeds).toHaveLength(2);
    expect(result.variantSeeds).toContainEqual({
      variantId: 'variant-1',
      masterId: 'master-1',
      salesChannel: 'naver',
      occurredDate: '2026-07-14',
      quantitySold: 2,
      revenue: 2000,
    });
  });

  it('채널 seed 와 고객 seed 를 주문 1건 기준으로 만든다', async () => {
    const service = makeService([
      { masterId: 'master-1', variantId: 'variant-1', quantity: 2, totalPrice: 2000 },
      { masterId: 'master-1', variantId: 'variant-2', quantity: 1, totalPrice: 3000 },
    ]);

    const result = await service.recordOrderCreated(envelope as never, payload as never);

    expect(result.channelSeed).toEqual({
      salesChannel: 'naver',
      occurredDate: '2026-07-14',
      ordersCount: 1,
      grossRevenue: 5000,
    });
    expect(result.customerSeed).toEqual({
      customerId: 'customer-10',
      occurredAt: new Date('2026-07-14T01:00:00.000Z'),
      revenue: 5000,
    });
  });

  it('집계 일자는 KST 기준이다 — UTC 로 전날 15:30 인 주문은 다음 날 버킷에 들어간다', async () => {
    // 2026-07-31T15:30:00Z === 2026-08-01 00:30 KST. Under the old
    // `toISOString().slice(0, 10)` every seed here would say '2026-07-31', quietly filing
    // 9 hours of each Korean business day under the previous date. Asserting on all three
    // seed kinds at once is deliberate: they each carry their own `occurredDate`, so a fix
    // applied to only one of them would still leave the aggregate tables disagreeing.
    const service = makeService([{ masterId: 'master-1', variantId: 'variant-1', quantity: 1, totalPrice: 1000 }]);

    const result = await service.recordOrderCreated(
      envelope as never,
      {
        ...payload,
        createdAt: '2026-07-31T15:30:00.000Z',
      } as never,
    );

    expect(result.seeds[0].occurredDate).toBe('2026-08-01');
    expect(result.variantSeeds[0].occurredDate).toBe('2026-08-01');
    expect(result.channelSeed?.occurredDate).toBe('2026-08-01');
  });

  it('비회원 주문이면 고객 seed 가 null 이다', async () => {
    const service = makeService([{ masterId: 'master-1', variantId: 'variant-1', quantity: 1, totalPrice: 1000 }]);

    const result = await service.recordOrderCreated(envelope as never, { ...payload, customerId: null } as never);

    expect(result.customerSeed).toBeNull();
  });
});
