import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ShipmentEventOrder, ShipmentShippedPayload } from '@packages/event-contracts/streams';
import { ShipmentEventsConsumer } from '../consumers/shipment-events.consumer';
import { channelAdapterSchema } from '../schema';
import { ShipmentDispatchInboxWorker } from './shipment-dispatch-inbox.worker';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_CHANNEL_DISPATCH_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the channel dispatch persistence integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('shipment dispatch persistence migration', () => {
  let sql: postgres.Sql;
  let schema: string;
  let db: PostgresJsDatabase<typeof channelAdapterSchema>;

  beforeEach(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1, prepare: false });
    schema = `channel_dispatch_${randomUUID().replaceAll('-', '')}`;
    await sql.unsafe(`CREATE SCHEMA "${schema}"`);
    await sql.unsafe(`SET search_path TO "${schema}"`);
    await sql.unsafe(`
      CREATE TABLE inbox_events (
        id uuid PRIMARY KEY,
        event_type varchar(100) NOT NULL,
        aggregate_type varchar(50) NOT NULL DEFAULT 'ChannelAdapter',
        aggregate_id varchar(255),
        partition_key varchar(255),
        payload jsonb,
        metadata jsonb,
        status varchar(20) NOT NULL DEFAULT 'pending',
        attempts integer NOT NULL DEFAULT 0,
        next_attempt_at timestamp DEFAULT now(),
        error_message text,
        event_occurred_at timestamp,
        created_at timestamp NOT NULL DEFAULT now(),
        published_at timestamp,
        failed_at timestamp
      )
    `);

    const migration = readFileSync(
      resolve(process.cwd(), 'apps/channel-adapter/drizzle/20260714040216_flawless_whirlwind.sql'),
      'utf8',
    );
    const schemaScopedMigration = migration.replaceAll('"public"."inbox_events"', `"${schema}"."inbox_events"`);
    for (const statement of schemaScopedMigration
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter(Boolean)) {
      await sql.unsafe(statement);
    }
    db = drizzle(sql, { schema: channelAdapterSchema });
  });

  afterEach(async () => {
    await sql.unsafe('SET search_path TO public');
    await sql.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await sql.end({ timeout: 5 });
  });

  it('enforces inbox idempotency and one operation per attempt/order/operation', async () => {
    const inboxId = randomUUID();
    const duplicateInboxId = randomUUID();
    await sql`
      INSERT INTO inbox_events (id, event_type, idempotency_key)
      VALUES (${inboxId}, 'ShipmentShipped', 'attempt-1')
    `;
    await expect(sql`
      INSERT INTO inbox_events (id, event_type, idempotency_key)
      VALUES (${duplicateInboxId}, 'ShipmentShipped', 'attempt-1')
    `).rejects.toMatchObject({ code: '23505' });

    const operationInboxId = randomUUID();
    await sql`
      INSERT INTO inbox_events (id, event_type, idempotency_key)
      VALUES (${operationInboxId}, 'ShipmentShipped', 'attempt-2')
    `;
    const attemptId = randomUUID();
    const shipmentId = randomUUID();
    const salesOrderId = randomUUID();
    const insertOperation = (id: string, operationInboxId: string) => sql`
      INSERT INTO channel_dispatch_operations (
        id, inbox_event_id, dispatch_attempt_id, shipment_id, sales_order_id,
        operation, channel, external_order_id, provider_idempotency_key, request_snapshot
      ) VALUES (
        ${id}, ${operationInboxId}, ${attemptId}, ${shipmentId}, ${salesOrderId},
        'dispatch', 'naver', '1000000001', 'provider-key-1', '{}'::jsonb
      )
    `;
    await insertOperation(randomUUID(), inboxId);
    await expect(insertOperation(randomUUID(), operationInboxId)).rejects.toMatchObject({ code: '23505' });
  });

  it('supports durable manual cancellation without a shipment or dispatch attempt', async () => {
    const inboxId = randomUUID();
    const salesOrderId = randomUUID();
    await sql`INSERT INTO inbox_events (id, event_type) VALUES (${inboxId}, 'CoreOrderCancelled')`;
    await sql`
      INSERT INTO channel_dispatch_operations (
        id, inbox_event_id, dispatch_attempt_id, shipment_id, sales_order_id,
        operation, channel, external_order_id, provider_idempotency_key,
        request_snapshot, status, error_message
      ) VALUES (
        ${randomUUID()}, ${inboxId}, NULL, NULL, ${salesOrderId},
        'cancel', 'coupang', '9001', 'cancel-key', '{}'::jsonb,
        'manual_adjustment_required', 'manual cancellation required'
      )
    `;

    const [row] = await sql`
      SELECT operation, status, dispatch_attempt_id, shipment_id
      FROM channel_dispatch_operations
      WHERE inbox_event_id = ${inboxId}
    `;
    expect(row).toMatchObject({
      operation: 'cancel',
      status: 'manual_adjustment_required',
      dispatch_attempt_id: null,
      shipment_id: null,
    });
  });

  it('atomically reclaims a processing operation only after its lease expires', async () => {
    const operationId = randomUUID();
    const inboxId = randomUUID();
    await sql`INSERT INTO inbox_events (id, event_type) VALUES (${inboxId}, 'ShipmentShipped')`;
    await sql`
      INSERT INTO channel_dispatch_operations (
        id, inbox_event_id, dispatch_attempt_id, shipment_id, sales_order_id,
        operation, channel, external_order_id, provider_idempotency_key,
        request_snapshot, status, attempts, processing_started_at, lease_expires_at
      ) VALUES (
        ${operationId}, ${inboxId}, ${randomUUID()}, ${randomUUID()}, ${randomUUID()},
        'dispatch', 'naver', '1000000001', 'lease-key', '{}'::jsonb,
        'processing', 1, now() - interval '10 minutes', now() - interval '1 minute'
      )
    `;

    const [claimed] = await sql`
      UPDATE channel_dispatch_operations
      SET status = 'processing',
          attempts = attempts + 1,
          processing_started_at = now(),
          lease_expires_at = now() + interval '5 minutes'
      WHERE id = (
        SELECT id FROM channel_dispatch_operations
        WHERE status = 'processing' AND lease_expires_at <= now()
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING attempts, lease_expires_at, lease_expires_at > now()::timestamp AS lease_active
    `;

    expect(claimed.attempts).toBe(2);
    expect(claimed.lease_active).toBe(true);
  });

  it('consumes a mixed-channel ShipmentShipped contract into exactly one command per source order', async () => {
    const naverExecute = jest.fn().mockResolvedValue({ success: true, data: { provider: 'naver' } });
    const coupangExecute = jest.fn().mockResolvedValue({ success: true, data: { provider: 'coupang' } });
    const factory = {
      getAdapter: jest.fn((channel: string) => ({
        executeCommand: channel === 'naver_smartstore' ? naverExecute : coupangExecute,
      })),
    };
    const consumer = new ShipmentEventsConsumer({ db } as any);
    const worker = new ShipmentDispatchInboxWorker(
      { db } as any,
      factory as any,
      { updateOrderShipmentAttemptProjection: jest.fn() } as any,
    );
    const shipmentId = randomUUID();
    const dispatchAttemptId = randomUUID();
    const orders: ShipmentEventOrder[] = [
      {
        salesOrderId: randomUUID(),
        fulfillmentOrderId: randomUUID(),
        salesChannel: 'naver',
        channelOrderId: '1000000001',
        isPartial: false,
        lines: [
          {
            shipmentLineId: randomUUID(),
            fulfillmentOrderItemId: randomUUID(),
            salesOrderLineId: randomUUID(),
            channelOrderItemId: '100000001',
            skuId: randomUUID(),
            qty: 1,
            isPartialQuantity: false,
          },
        ],
      },
      {
        salesOrderId: randomUUID(),
        fulfillmentOrderId: randomUUID(),
        salesChannel: 'coupang',
        channelOrderId: '9001',
        isPartial: false,
        lines: [
          {
            shipmentLineId: randomUUID(),
            fulfillmentOrderItemId: randomUUID(),
            salesOrderLineId: randomUUID(),
            channelOrderItemId: '3001',
            skuId: randomUUID(),
            qty: 2,
            isPartialQuantity: false,
          },
        ],
      },
    ];
    const payload: ShipmentShippedPayload = {
      shipmentId,
      dispatchAttemptId,
      attemptNo: 1,
      warehouseId: randomUUID(),
      dispatchedAt: '2026-07-14T00:00:00.000Z',
      invoice: { invoiceId: randomUUID(), carrier: 'HANJIN', trackingNo: 'TRACK-MIXED-1' },
      orders,
    };

    await consumer.handleShipmentShipped(payload, {
      messageId: randomUUID(),
      correlationId: randomUUID(),
      causationId: randomUUID(),
    } as any);
    await worker.processPending();

    expect(factory.getAdapter.mock.calls).toHaveLength(2);
    expect(factory.getAdapter.mock.calls).toEqual(expect.arrayContaining([['naver_smartstore'], ['coupang']]));
    expect(naverExecute).toHaveBeenCalledTimes(1);
    expect(coupangExecute).toHaveBeenCalledTimes(1);
    expect(naverExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: orders[0].channelOrderId,
        idempotencyKey: `shipment:${dispatchAttemptId}:${orders[0].salesOrderId}:dispatch`,
      }),
    );
    expect(coupangExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: orders[1].channelOrderId,
        idempotencyKey: `shipment:${dispatchAttemptId}:${orders[1].salesOrderId}:dispatch`,
      }),
    );

    const operationRows = await sql`
      SELECT sales_order_id, channel, status, attempts
      FROM channel_dispatch_operations
      WHERE dispatch_attempt_id = ${dispatchAttemptId}
      ORDER BY sales_order_id
    `;
    expect(operationRows).toHaveLength(2);
    expect(operationRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sales_order_id: orders[0].salesOrderId, channel: 'naver', status: 'succeeded' }),
        expect.objectContaining({ sales_order_id: orders[1].salesOrderId, channel: 'coupang', status: 'succeeded' }),
      ]),
    );
    await expect(worker.getOperationObservability(dispatchAttemptId, orders[0].salesOrderId)).resolves.toEqual([
      expect.objectContaining({
        dispatchAttemptId,
        salesOrderId: orders[0].salesOrderId,
        status: 'succeeded',
      }),
    ]);
    const [inbox] = await sql`
      SELECT status FROM inbox_events
      WHERE event_type = 'ShipmentShipped' AND idempotency_key = ${dispatchAttemptId}
    `;
    expect(inbox.status).toBe('published');

    await worker.processPending();
    expect(naverExecute).toHaveBeenCalledTimes(1);
    expect(coupangExecute).toHaveBeenCalledTimes(1);
  });

  it('terminally exposes delivery as manual when the exact prior dispatch required an operator', async () => {
    const shipmentId = randomUUID();
    const dispatchAttemptId = randomUUID();
    const salesOrderId = randomUUID();
    const dispatchInboxId = randomUUID();
    await sql`
      INSERT INTO inbox_events (id, event_type, idempotency_key, status)
      VALUES (${dispatchInboxId}, 'ShipmentShipped', ${dispatchAttemptId}, 'published')
    `;
    await sql`
      INSERT INTO channel_dispatch_operations (
        id, inbox_event_id, dispatch_attempt_id, shipment_id, sales_order_id,
        operation, channel, external_order_id, provider_idempotency_key,
        request_snapshot, status, error_message
      ) VALUES (
        ${randomUUID()}, ${dispatchInboxId}, ${dispatchAttemptId}, ${shipmentId}, ${salesOrderId},
        'dispatch', 'naver', '1000000001', 'manual-dispatch-key', '{}'::jsonb,
        'manual_adjustment_required', 'provider dispatch must be entered by an operator'
      )
    `;
    const factory = { getAdapter: jest.fn() };
    const consumer = new ShipmentEventsConsumer({ db } as any);
    const worker = new ShipmentDispatchInboxWorker(
      { db } as any,
      factory as any,
      { updateOrderShipmentAttemptProjection: jest.fn() } as any,
    );

    await consumer.handleShipmentDelivered(
      {
        shipmentId,
        dispatchAttemptId,
        attemptNo: 1,
        providerEventId: 'provider-delivered-1',
        deliveredAt: '2026-07-14T02:00:00.000Z',
      },
      { messageId: randomUUID() } as any,
    );
    await worker.processPending();

    const [delivery] = await sql`
      SELECT status, error_message
      FROM channel_dispatch_operations
      WHERE dispatch_attempt_id = ${dispatchAttemptId}
        AND sales_order_id = ${salesOrderId}
        AND operation = 'delivery'
    `;
    const [deliveryInbox] = await sql`
      SELECT status
      FROM inbox_events
      WHERE event_type = 'ShipmentDelivered'
        AND idempotency_key = ${`${dispatchAttemptId}:provider-delivered-1`}
    `;
    expect(delivery).toEqual(
      expect.objectContaining({
        status: 'manual_adjustment_required',
        error_message: expect.stringContaining('provider dispatch must be entered by an operator'),
      }),
    );
    expect(deliveryInbox.status).toBe('published');
    expect(factory.getAdapter).not.toHaveBeenCalled();
  });

  it('publishes an internal ShipmentShipped event with no orders and creates no channel work', async () => {
    const factory = { getAdapter: jest.fn() };
    const consumer = new ShipmentEventsConsumer({ db } as any);
    const worker = new ShipmentDispatchInboxWorker(
      { db } as any,
      factory as any,
      { updateOrderShipmentAttemptProjection: jest.fn() } as any,
    );
    const dispatchAttemptId = randomUUID();

    await consumer.handleShipmentShipped(
      {
        shipmentId: randomUUID(),
        dispatchAttemptId,
        attemptNo: 1,
        warehouseId: randomUUID(),
        dispatchedAt: '2026-07-14T00:00:00.000Z',
        invoice: { invoiceId: randomUUID(), carrier: 'HANJIN', trackingNo: 'TRACK-INTERNAL-1' },
        orders: [],
      },
      { messageId: randomUUID() } as any,
    );
    await worker.processPending();

    const [inbox] = await sql`
      SELECT status FROM inbox_events
      WHERE event_type = 'ShipmentShipped' AND idempotency_key = ${dispatchAttemptId}
    `;
    const [count] = await sql`
      SELECT count(*)::integer AS count
      FROM channel_dispatch_operations
      WHERE dispatch_attempt_id = ${dispatchAttemptId}
    `;
    expect(inbox.status).toBe('published');
    expect(count.count).toBe(0);
    expect(factory.getAdapter).not.toHaveBeenCalled();
  });
});
