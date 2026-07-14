import type { DomainEvent } from '@packages/event-contracts/types';
import type { OrderCreatedPayload } from '@packages/event-contracts/streams/orders.stream';
import { OrderEventsConsumer } from './order-events.consumer';

const payload: OrderCreatedPayload = {
  orderId: 'order-event-1',
  externalOrderId: 'channel-order-1',
  salesChannel: 'naver',
  customerId: 'customer-1',
  items: [],
  totalAmount: 0,
  subtotalAmount: 0,
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

const envelope: DomainEvent<OrderCreatedPayload> = {
  messageId: '01J00000000000000000000001',
  messageType: 'OrderCreated',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000002',
  timestamp: '2026-07-14T01:00:00.000Z',
  source: { service: 'channel-adapter', aggregateType: 'Order', aggregateId: payload.orderId },
  payload,
};

describe('OrderEventsConsumer message claim', () => {
  function makeConsumer(claimed: boolean) {
    const tx = { id: 'analytics-tx' };
    const dbService = { db: { transaction: jest.fn((fn: (executor: unknown) => unknown) => fn(tx)) } };
    const orderFactsService = {
      recordOrderCreated: jest.fn().mockResolvedValue({
        claimed,
        seeds: claimed
          ? [
              {
                masterId: 'master-1',
                salesChannel: 'naver',
                occurredDate: '2026-07-14',
                orderCount: 1,
                quantitySold: 1,
              },
            ]
          : [],
      }),
    };
    const orderAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const userPurchaseAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const consumer = new OrderEventsConsumer(
      dbService as never,
      orderFactsService as never,
      orderAggregatesService as never,
      userPurchaseAggregatesService as never,
    );
    return { consumer, tx, orderFactsService, orderAggregatesService, userPurchaseAggregatesService };
  }

  it('skips every aggregate when the messageId was already claimed', async () => {
    const { consumer, orderFactsService, orderAggregatesService, userPurchaseAggregatesService } = makeConsumer(false);

    await consumer.onOrderCreated(envelope, payload);

    expect(orderFactsService.recordOrderCreated).toHaveBeenCalledTimes(1);
    expect(orderAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
    expect(userPurchaseAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
  });

  it('uses one transaction for the claim, item facts, and both aggregate updates', async () => {
    const { consumer, tx, orderFactsService, orderAggregatesService, userPurchaseAggregatesService } =
      makeConsumer(true);

    await consumer.onOrderCreated(envelope, payload);

    expect(orderFactsService.recordOrderCreated).toHaveBeenCalledWith(envelope, payload, tx);
    expect(orderAggregatesService.applyOrderCreated).toHaveBeenCalledWith(expect.any(Array), tx);
    expect(userPurchaseAggregatesService.applyOrderCreated).toHaveBeenCalledWith(
      payload.customerId,
      payload.items,
      new Date(payload.createdAt),
      tx,
    );
  });
});
