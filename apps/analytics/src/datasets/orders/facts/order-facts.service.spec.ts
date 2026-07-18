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
                  return Promise.resolve(items.map((item) => ({ masterId: item.masterId, quantity: item.quantity })));
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
        },
      ],
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
    expect(duplicate).toEqual({ claimed: false, seeds: [] });
    expect(factEventValues).toHaveLength(1);
    expect(factItemValues).toHaveLength(1);
  });
});
