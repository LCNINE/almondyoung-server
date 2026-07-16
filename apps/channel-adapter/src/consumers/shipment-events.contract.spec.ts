jest.mock('@medusajs/js-sdk', () => function Medusa() {});
jest.mock('../adapters/medusa/medusa-sdk.config', () => ({ createMedusaSdk: jest.fn() }));

import type { ShipmentEventOrder, ShipmentShippedPayload } from '@packages/event-contracts/streams';
import { MedusaClient } from '../adapters/medusa/medusa.client';
import { inboxEvents } from '../schema';
import { ShipmentDispatchInboxWorker } from '../services/shipment-dispatch-inbox.worker';
import { ShipmentEventsConsumer } from './shipment-events.consumer';

const ATTEMPT_ID = '22222222-2222-4222-8222-222222222222';

function order(
  channel: ShipmentEventOrder['salesChannel'],
  salesOrderId: string,
  channelOrderId: string,
  channelOrderItemId: string,
  isPartial: boolean,
): ShipmentEventOrder {
  return {
    salesOrderId,
    fulfillmentOrderId:
      channel === 'naver' ? '55555555-5555-4555-8555-555555555555' : '66666666-6666-4666-8666-666666666666',
    salesChannel: channel,
    channelOrderId,
    isPartial,
    lines: [
      {
        shipmentLineId:
          channel === 'naver' ? '77777777-7777-4777-8777-777777777777' : '88888888-8888-4888-8888-888888888888',
        fulfillmentOrderItemId:
          channel === 'naver' ? '99999999-9999-4999-8999-999999999999' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        salesOrderLineId:
          channel === 'naver' ? 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' : 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        channelOrderItemId,
        skuId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        qty: 1,
        isPartialQuantity: false,
      },
    ],
  };
}

const NAVER_ORDER = order('naver', '33333333-3333-4333-8333-333333333333', '1000000001', '100000001', true);
const COUPANG_ORDER = order('coupang', '44444444-4444-4444-8444-444444444444', '9001', '3001', false);

const SHIPPED: ShipmentShippedPayload = {
  shipmentId: '11111111-1111-4111-8111-111111111111',
  dispatchAttemptId: ATTEMPT_ID,
  attemptNo: 1,
  warehouseId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  dispatchedAt: '2026-07-15T00:00:00.000Z',
  invoice: {
    invoiceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    carrier: 'HANJIN',
    trackingNo: 'TRACK-1',
  },
  orders: [NAVER_ORDER, COUPANG_ORDER],
};

describe('shipment event channel ownership contract', () => {
  it('stores one inbox row per dispatch attempt, passing every order isPartial flag through unchanged', async () => {
    const accepted: Array<Record<string, unknown>> = [];
    const db = {
      insert: jest.fn((table: unknown) => {
        expect(table).toBe(inboxEvents);
        return {
          values: jest.fn((value: Record<string, unknown>) => {
            accepted.push(value);
            return { onConflictDoNothing: jest.fn().mockResolvedValue(undefined) };
          }),
        };
      }),
    };
    const consumer = new ShipmentEventsConsumer({ db } as never);

    await consumer.handleShipmentShipped(SHIPPED, {
      correlationId: 'correlation-1',
      causationId: 'causation-1',
      messageId: 'message-1',
    } as never);

    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.eventType).toBe('ShipmentShipped');
    expect(accepted[0]?.idempotencyKey).toBe(ATTEMPT_ID);
    const acceptedPayload = accepted[0]?.payload as ShipmentShippedPayload;
    // Both flags, not just the partial one: a consumer that hardcoded isPartial in
    // either direction would still satisfy a one-sided arrayContaining check.
    expect(
      acceptedPayload.orders.map((order) => ({ salesOrderId: order.salesOrderId, isPartial: order.isPartial })),
    ).toEqual([
      { salesOrderId: NAVER_ORDER.salesOrderId, isPartial: true },
      { salesOrderId: COUPANG_ORDER.salesOrderId, isPartial: false },
    ]);
    // Scope note: this proves the V2 inbox stores isPartial as sent — nothing more.
    // It does NOT prove "a partial shipment is not a full order shipped". That guard is
    // Core-side: the fullyShipped gate in ShipmentDispatchService
    // (apps/core/src/modules/fulfillment/services/shipment-dispatch.service.ts:1154,
    // `if (summary.fullyShipped && summary.salesOrderId && eventLine)`, where
    // fullyShipped = outstandingQty === 0 && canceledQty === 0). It is owned and proven by
    // outbound-v2-scenarios.integration.spec.ts '02. dispatches FOI 10 as 6/4 with two
    // invoices and attempts': after the 6-of-10 partial dispatch, checkpoint() passes no
    // fullyShippedFulfillmentOrderIds, so expectExactOutboxTopology's set-equality
    //   expect(fulfillmentRows.map(encode).sort()).toEqual(expectedRows.map(encode).sort())
    // pins the partial to exactly ShipmentShipped + FulfillmentProgressed and fails on any
    // FulfillmentShipped row. Re-asserting that here against an already-pinned eventType
    // could not fail.
  });

  it('derives partially_shipped, never shipped, from a partial Medusa shipment attempt', async () => {
    let metadata: Record<string, unknown> = {};
    const fetch = jest.fn(
      (_path: string, options: { method: string; body?: { metadata: Record<string, unknown> } }) => {
        if (options.method === 'GET') return Promise.resolve({ order: { metadata } });
        metadata = options.body!.metadata;
        return Promise.resolve({ order: { metadata } });
      },
    );
    const client = Object.create(MedusaClient.prototype) as MedusaClient;
    Object.defineProperties(client, {
      sdk: { value: { client: { fetch } } },
      logger: { value: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    });
    const medusaOrder = order(
      'medusa',
      '33333333-3333-4333-8333-333333333333',
      'order_medusa_1',
      'item_medusa_1',
      true,
    );

    await client.updateOrderShipmentAttemptProjection(medusaOrder.channelOrderId, {
      operation: 'dispatch',
      payload: { ...SHIPPED, orders: [medusaOrder] },
      order: medusaOrder,
    });

    expect(metadata).toEqual(
      expect.objectContaining({
        coreShippingStatus: 'partially_shipped',
        coreShipmentAttempts: [expect.objectContaining({ dispatchAttemptId: ATTEMPT_ID, isPartial: true })],
      }),
    );
  });

  it('fans one mixed-channel attempt out to one operation per sales order, each routed to exactly one adapter', async () => {
    const operations: Array<Record<string, unknown>> = [];
    const onConflictDoNothing = jest.fn().mockResolvedValue(undefined);
    const insert = jest.fn(() => ({
      values: jest.fn((values: Array<Record<string, unknown>>) => {
        operations.push(...values);
        return { onConflictDoNothing };
      }),
    }));
    const naverExecute = jest.fn().mockResolvedValue({ success: true });
    const coupangExecute = jest.fn().mockResolvedValue({ success: true });
    const factory = {
      getAdapter: jest.fn((adapter: string) => ({
        executeCommand: adapter === 'naver_smartstore' ? naverExecute : coupangExecute,
      })),
    };
    const worker = new ShipmentDispatchInboxWorker(
      { db: { insert } } as never,
      factory as never,
      { updateOrderShipmentAttemptProjection: jest.fn() } as never,
    );
    const workerInternals = worker as unknown as {
      ensureOperations(inboxId: string, eventType: 'ShipmentShipped', payload: ShipmentShippedPayload): Promise<void>;
      executeOperation(operation: Record<string, unknown>): Promise<unknown>;
    };

    await workerInternals.ensureOperations('inbox-1', 'ShipmentShipped', SHIPPED);

    expect(operations).toHaveLength(2);
    expect(operations.map((operation) => operation.salesOrderId)).toEqual([
      NAVER_ORDER.salesOrderId,
      COUPANG_ORDER.salesOrderId,
    ]);
    expect(new Set(operations.map((operation) => operation.salesOrderId))).toHaveProperty('size', 2);
    // Scope note: this insert is a mock, so the fan-out above is only the shape of a single
    // in-memory call — it cannot prove a duplicate operation is impossible under replay or
    // concurrency. What is provable here is that the write defers to the DB rather than
    // blindly inserting: the operation insert must go through onConflictDoNothing().
    // The guarantee itself is the uq_channel_dispatch_attempt_order_operation unique index
    // on (dispatch_attempt_id, sales_order_id, operation) (apps/channel-adapter/src/schema.ts:344),
    // owned by shipment-dispatch-persistence.integration.spec.ts 'enforces inbox idempotency
    // and one operation per attempt/order/operation':
    //   await expect(insertOperation(randomUUID(), operationInboxId)).rejects.toMatchObject({ code: '23505' });
    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);

    for (const [index, operation] of operations.entries()) {
      await workerInternals.executeOperation({
        ...operation,
        id: `operation-${index + 1}`,
        status: 'processing',
        attempts: 1,
      });
    }

    expect(factory.getAdapter.mock.calls).toEqual([['naver_smartstore'], ['coupang']]);
    expect(naverExecute).toHaveBeenCalledTimes(1);
    expect(coupangExecute).toHaveBeenCalledTimes(1);
    expect(naverExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `shipment:${ATTEMPT_ID}:${NAVER_ORDER.salesOrderId}:dispatch`,
        orderId: NAVER_ORDER.channelOrderId,
      }),
    );
    expect(coupangExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: `shipment:${ATTEMPT_ID}:${COUPANG_ORDER.salesOrderId}:dispatch`,
        orderId: COUPANG_ORDER.channelOrderId,
      }),
    );
  });
});
