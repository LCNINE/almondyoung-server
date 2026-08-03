import type { DomainEvent } from '@packages/event-contracts/types';
import type {
  OrderCreatedPayload,
  OrderCancelledPayload,
  OrderRefundCreatedPayload,
} from '@packages/event-contracts/streams/orders.stream';
import { OrderEventsConsumer } from './order-events.consumer';
import type { OrderCancelledFactResult, OrderRefundFactResult } from '../facts/order-facts.service';

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
                revenue: 1000,
              },
            ]
          : [],
        variantSeeds: [],
        channelSeed: claimed
          ? { salesChannel: 'naver', occurredDate: '2026-07-14', ordersCount: 1, grossRevenue: 1000 }
          : null,
        customerSeed: null,
      }),
    };
    const orderAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const userPurchaseAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const channelAggregatesService = {
      applyOrderCreated: jest.fn().mockResolvedValue(undefined),
      applyCancellation: jest.fn().mockResolvedValue(undefined),
      applyRefund: jest.fn().mockResolvedValue(undefined),
    };
    const variantAggregatesService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const customerLifetimeService = { applyOrderCreated: jest.fn().mockResolvedValue(undefined) };
    const consumer = new OrderEventsConsumer(
      dbService as never,
      orderFactsService as never,
      orderAggregatesService as never,
      userPurchaseAggregatesService as never,
      channelAggregatesService as never,
      variantAggregatesService as never,
      customerLifetimeService as never,
    );
    return {
      consumer,
      tx,
      orderFactsService,
      orderAggregatesService,
      userPurchaseAggregatesService,
      channelAggregatesService,
      variantAggregatesService,
      customerLifetimeService,
    };
  }

  it('skips every aggregate when the messageId was already claimed', async () => {
    const {
      consumer,
      orderFactsService,
      orderAggregatesService,
      userPurchaseAggregatesService,
      channelAggregatesService,
      variantAggregatesService,
      customerLifetimeService,
    } = makeConsumer(false);

    await consumer.onOrderCreated(envelope, payload);

    expect(orderFactsService.recordOrderCreated).toHaveBeenCalledTimes(1);
    expect(orderAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
    expect(userPurchaseAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
    expect(channelAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
    expect(variantAggregatesService.applyOrderCreated).not.toHaveBeenCalled();
    expect(customerLifetimeService.applyOrderCreated).not.toHaveBeenCalled();
  });

  it('uses one transaction for the claim, item facts, and both aggregate updates', async () => {
    const {
      consumer,
      tx,
      orderFactsService,
      orderAggregatesService,
      userPurchaseAggregatesService,
      channelAggregatesService,
      variantAggregatesService,
      customerLifetimeService,
    } = makeConsumer(true);

    await consumer.onOrderCreated(envelope, payload);

    expect(orderFactsService.recordOrderCreated).toHaveBeenCalledWith(envelope, payload, tx);
    expect(orderAggregatesService.applyOrderCreated).toHaveBeenCalledWith(expect.any(Array), tx);
    expect(userPurchaseAggregatesService.applyOrderCreated).toHaveBeenCalledWith(
      payload.customerId,
      payload.items,
      new Date(payload.createdAt),
      tx,
    );
    expect(variantAggregatesService.applyOrderCreated).toHaveBeenCalledWith([], tx);
    expect(channelAggregatesService.applyOrderCreated).toHaveBeenCalledWith(
      { salesChannel: 'naver', occurredDate: '2026-07-14', ordersCount: 1, grossRevenue: 1000 },
      tx,
    );
    expect(customerLifetimeService.applyOrderCreated).not.toHaveBeenCalled();
  });
});

const cancelPayload: OrderCancelledPayload = {
  orderId: 'order-20',
  reason: 'CUSTOMER_REQUEST',
  cancelledBy: 'admin',
  cancelledAt: '2026-07-15T01:00:00.000Z',
  refundRequired: false,
};

const cancelEnvelope: DomainEvent<OrderCancelledPayload> = {
  messageId: '01J00000000000000000000020',
  messageType: 'OrderCancelled',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000021',
  timestamp: '2026-07-15T01:00:00.000Z',
  source: { service: 'channel-adapter', aggregateType: 'Order', aggregateId: cancelPayload.orderId },
  payload: cancelPayload,
};

describe('OrderEventsConsumer.onOrderCancelled', () => {
  function makeConsumer(result: OrderCancelledFactResult) {
    const tx = { id: 'analytics-tx' };
    const dbService = { db: { transaction: jest.fn((fn: (executor: unknown) => unknown) => fn(tx)) } };
    const orderFactsService = { recordOrderCancelled: jest.fn().mockResolvedValue(result) };
    const orderAggregatesService = { applyCancellation: jest.fn().mockResolvedValue(undefined) };
    const userPurchaseAggregatesService = {};
    const channelAggregatesService = { applyCancellation: jest.fn().mockResolvedValue(undefined) };
    const variantAggregatesService = {};
    const customerLifetimeService = {};
    const consumer = new OrderEventsConsumer(
      dbService as never,
      orderFactsService as never,
      orderAggregatesService as never,
      userPurchaseAggregatesService as never,
      channelAggregatesService as never,
      variantAggregatesService as never,
      customerLifetimeService as never,
    );
    return { consumer, tx, orderFactsService, orderAggregatesService, channelAggregatesService };
  }

  it('orphan(원본 없음) 이면 상품·채널 집계를 둘 다 건너뛴다', async () => {
    // salesChannel is deliberately non-null here so this test isolates the
    // `result.orphan` guard from the `!result.salesChannel` guard — if orphan were
    // dropped from the implementation's condition, a non-null salesChannel means
    // nothing else would stop the call, so this would correctly fail.
    const { consumer, orderFactsService, orderAggregatesService, channelAggregatesService } = makeConsumer({
      claimed: true,
      orphan: true,
      salesChannel: 'naver',
      occurredDate: '2026-07-15',
      masterAmounts: [],
      totalAmount: 0,
    });

    await consumer.onOrderCancelled(cancelEnvelope, cancelPayload);

    expect(orderFactsService.recordOrderCancelled).toHaveBeenCalledTimes(1);
    expect(orderAggregatesService.applyCancellation).not.toHaveBeenCalled();
    expect(channelAggregatesService.applyCancellation).not.toHaveBeenCalled();
  });

  it('중복 메시지(claimed=false) 면 상품·채널 집계를 둘 다 건너뛴다', async () => {
    // salesChannel is deliberately non-null here so this test isolates the
    // `!result.claimed` guard — if salesChannel were null too, this would pass
    // even if the claimed check were dropped from the implementation.
    const { orderAggregatesService, channelAggregatesService, consumer } = makeConsumer({
      claimed: false,
      orphan: false,
      salesChannel: 'naver',
      occurredDate: '2026-07-15',
      masterAmounts: [],
      totalAmount: 0,
    });

    await consumer.onOrderCancelled(cancelEnvelope, cancelPayload);

    expect(orderAggregatesService.applyCancellation).not.toHaveBeenCalled();
    expect(channelAggregatesService.applyCancellation).not.toHaveBeenCalled();
  });

  it('salesChannel 이 없으면(orphan 이 아니어도) 상품·채널 집계를 둘 다 건너뛴다', async () => {
    const { orderAggregatesService, channelAggregatesService, consumer } = makeConsumer({
      claimed: true,
      orphan: false,
      salesChannel: null,
      occurredDate: '2026-07-15',
      masterAmounts: [{ masterId: 'm1', amount: 100 }],
      totalAmount: 100,
    });

    await consumer.onOrderCancelled(cancelEnvelope, cancelPayload);

    expect(orderAggregatesService.applyCancellation).not.toHaveBeenCalled();
    expect(channelAggregatesService.applyCancellation).not.toHaveBeenCalled();
  });

  it('정상 취소는 상품 집계엔 masterAmounts, 채널 집계엔 totalAmount 를 각각 전달하고 같은 tx 를 공유한다', async () => {
    const masterAmounts = [
      { masterId: 'm1', amount: 3000 },
      { masterId: 'm2', amount: 500 },
    ];
    const { consumer, tx, orderAggregatesService, channelAggregatesService } = makeConsumer({
      claimed: true,
      orphan: false,
      salesChannel: 'naver',
      occurredDate: '2026-07-15',
      masterAmounts,
      totalAmount: 3500,
    });

    await consumer.onOrderCancelled(cancelEnvelope, cancelPayload);

    // Guards against a swapped-argument regression: applyCancellation on the product-level
    // service takes the per-masterId array; on the channel-level service it takes the
    // single summed total. Swapping them would send an array where a number is expected
    // (and vice versa) — this assertion pins each call's third argument independently.
    expect(orderAggregatesService.applyCancellation).toHaveBeenCalledWith('2026-07-15', 'naver', masterAmounts, tx);
    expect(channelAggregatesService.applyCancellation).toHaveBeenCalledWith('2026-07-15', 'naver', 3500, tx);
  });
});

const refundPayload: OrderRefundCreatedPayload = {
  orderId: 'order-30',
  refundId: 'refund-1',
  paymentId: 'payment-1',
  amount: 1500,
  currency: 'KRW',
  reason: 'CUSTOMER_REQUEST',
  createdBy: 'admin',
  createdAt: '2026-07-16T01:00:00.000Z',
};

const refundEnvelope: DomainEvent<OrderRefundCreatedPayload> = {
  messageId: '01J00000000000000000000030',
  messageType: 'OrderRefundCreated',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: '01J00000000000000000000031',
  timestamp: '2026-07-16T01:00:00.000Z',
  source: { service: 'wallet', aggregateType: 'Order', aggregateId: refundPayload.orderId },
  payload: refundPayload,
};

describe('OrderEventsConsumer.onOrderRefundCreated', () => {
  function makeConsumer(overrides: Partial<OrderRefundFactResult>) {
    const result: OrderRefundFactResult = {
      claimed: true,
      orphan: false,
      supersededByCancellation: false,
      salesChannel: 'coupang',
      occurredDate: '2026-07-16',
      masterAmounts: [{ masterId: 'm1', amount: 1500 }],
      ...overrides,
    };
    const tx = { id: 'analytics-tx' };
    const dbService = { db: { transaction: jest.fn((fn: (executor: unknown) => unknown) => fn(tx)) } };
    const orderFactsService = { recordOrderRefund: jest.fn().mockResolvedValue(result) };
    const orderAggregatesService = { applyRefund: jest.fn().mockResolvedValue(undefined) };
    const userPurchaseAggregatesService = {};
    const channelAggregatesService = { applyRefund: jest.fn().mockResolvedValue(undefined) };
    const variantAggregatesService = {};
    const customerLifetimeService = {};
    const consumer = new OrderEventsConsumer(
      dbService as never,
      orderFactsService as never,
      orderAggregatesService as never,
      userPurchaseAggregatesService as never,
      channelAggregatesService as never,
      variantAggregatesService as never,
      customerLifetimeService as never,
    );
    return { consumer, tx, orderFactsService, orderAggregatesService, channelAggregatesService };
  }

  it('orphan(원본 없음) 이면 채널 집계를 건너뛴다', async () => {
    // salesChannel is deliberately non-null here so this test isolates the
    // `result.orphan` guard from the `!result.salesChannel` guard — if orphan were
    // dropped from the implementation's condition, salesChannel being non-null means
    // nothing else would stop the call, so this would correctly fail.
    const { consumer, orderFactsService, channelAggregatesService } = makeConsumer({
      claimed: true,
      orphan: true,
      salesChannel: 'coupang',
      occurredDate: '2026-07-16',
    });

    await consumer.onOrderRefundCreated(refundEnvelope, refundPayload);

    expect(orderFactsService.recordOrderRefund).toHaveBeenCalledTimes(1);
    expect(channelAggregatesService.applyRefund).not.toHaveBeenCalled();
  });

  it('중복 메시지(claimed=false) 면 채널 집계를 건너뛴다', async () => {
    // salesChannel is deliberately non-null here so this test isolates the
    // `!result.claimed` guard — if salesChannel were null too, this would pass
    // even if the claimed check were dropped from the implementation.
    const { orderFactsService, channelAggregatesService, consumer } = makeConsumer({
      claimed: false,
      orphan: false,
      salesChannel: 'coupang',
      occurredDate: '2026-07-16',
    });

    await consumer.onOrderRefundCreated(refundEnvelope, refundPayload);

    expect(orderFactsService.recordOrderRefund).toHaveBeenCalledTimes(1);
    expect(channelAggregatesService.applyRefund).not.toHaveBeenCalled();
  });

  it('salesChannel 이 없으면(orphan 이 아니어도) 채널 집계를 건너뛴다', async () => {
    const { channelAggregatesService, consumer } = makeConsumer({
      claimed: true,
      orphan: false,
      salesChannel: null,
      occurredDate: '2026-07-16',
    });

    await consumer.onOrderRefundCreated(refundEnvelope, refundPayload);

    expect(channelAggregatesService.applyRefund).not.toHaveBeenCalled();
  });

  it('취소가 이미 차감한 주문(supersededByCancellation)이면 채널 집계를 건너뛴다', async () => {
    // Isolated from every sibling guard: claimed=true, orphan=false and salesChannel is a
    // live string, so `supersededByCancellation` is the only thing that can stop the write.
    // Drop it from the consumer's condition and this test fails — which is the point, since
    // letting it through is exactly the gross - 2×gross double deduction.
    const { consumer, orderFactsService, channelAggregatesService } = makeConsumer({
      supersededByCancellation: true,
    });

    await consumer.onOrderRefundCreated(refundEnvelope, refundPayload);

    expect(orderFactsService.recordOrderRefund).toHaveBeenCalledTimes(1);
    expect(channelAggregatesService.applyRefund).not.toHaveBeenCalled();
  });

  it('정상 환불은 채널 집계엔 payload.amount, 상품 집계엔 배분값을 각각 전달하고 같은 tx 를 공유한다', async () => {
    const { consumer, tx, orderFactsService, orderAggregatesService, channelAggregatesService } = makeConsumer({});

    await consumer.onOrderRefundCreated(refundEnvelope, refundPayload);

    expect(orderFactsService.recordOrderRefund).toHaveBeenCalledWith(refundEnvelope, refundPayload, tx);
    // Guards against a swapped-argument regression, mirroring the onOrderCancelled test:
    // the channel-level service takes the single refund amount from the payload, while the
    // product-level service takes the per-masterId allocation array. Sending one where the
    // other is expected would silently write nonsense; pinning each call's third argument
    // independently catches it.
    expect(channelAggregatesService.applyRefund).toHaveBeenCalledWith('2026-07-16', 'coupang', 1500, tx);
    expect(orderAggregatesService.applyRefund).toHaveBeenCalledWith(
      '2026-07-16',
      'coupang',
      [{ masterId: 'm1', amount: 1500 }],
      tx,
    );
  });

  it.each([
    ['claimed=false', { claimed: false }],
    ['orphan', { orphan: true }],
    ['supersededByCancellation', { supersededByCancellation: true }],
    ['salesChannel 없음', { salesChannel: null }],
  ])('%s 이면 상품 집계도 채널 집계와 함께 건너뛴다', async (_label, overrides) => {
    // The product-level writer must sit behind the *same* gate as the channel-level one.
    // A refund that is skipped for the channel but applied to products would reintroduce
    // the table-to-table mismatch from the opposite direction.
    const { consumer, orderAggregatesService, channelAggregatesService } = makeConsumer(overrides);

    await consumer.onOrderRefundCreated(refundEnvelope, refundPayload);

    expect(channelAggregatesService.applyRefund).not.toHaveBeenCalled();
    expect(orderAggregatesService.applyRefund).not.toHaveBeenCalled();
  });
});
