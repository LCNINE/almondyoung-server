import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { SHIPMENT_STREAM } from '@packages/event-contracts/streams';
import { DbTx, returnExchangeTables, wmsSchema, wmsTables } from './inventory.schema';
import { OutboxService as FulfillmentOutboxService } from '../../fulfillment/outbox/outbox.service';
import { OutboxService as InventoryOutboxService } from '../shared/outbox/outbox.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('outbound-v2-schema (PostgreSQL constraints, rollback-only)', () => {
  jest.setTimeout(120_000);

  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: wmsSchema });
  });

  afterAll(async () => {
    await sql.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await fn(tx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function expectViolation(tx: DbTx, action: (savepoint: DbTx) => Promise<unknown>, expected: string | RegExp) {
    let caught: unknown;
    try {
      await tx.transaction((savepoint) => action(savepoint as unknown as DbTx));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();

    const evidence: string[] = [];
    let current = caught as
      | (Error & {
          cause?: unknown;
          constraint_name?: string;
          column_name?: string;
          data_type_name?: string;
          detail?: string;
          code?: string;
        })
      | undefined;
    for (let depth = 0; current && depth < 5; depth += 1) {
      evidence.push(
        current.message,
        current.constraint_name ?? '',
        current.column_name ?? '',
        current.data_type_name ?? '',
        current.detail ?? '',
        current.code ?? '',
      );
      current = current.cause as typeof current;
    }
    const actual = evidence.join(' ');
    if (typeof expected === 'string') {
      expect(actual).toContain(expected);
    } else {
      expect(actual).toMatch(expected);
    }
  }

  async function fixture(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `v2-schema-wh-${suffix}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `v2-schema-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'v2-schema-sku', code: `V2-SCHEMA-${suffix}`, holderId: holder.id })
      .returning();
    const [location] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `V2-ZONE-${suffix}`, locationType: 'zone' })
      .returning();
    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `v2-schema-order-${suffix}`,
        salesChannel: 'medusa',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId: salesOrder.id, warehouseId: warehouse.id })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({ warehouseId: warehouse.id, openedForFulfillmentOrderId: fulfillmentOrder.id })
      .returning();
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({ batchNumber: `V2-BATCH-${suffix}`, warehouseId: warehouse.id, pickingMethod: 'individual' })
      .returning();

    return { warehouse, sku, location, salesOrder, fulfillmentOrder, shipment, batch };
  }

  async function physicalFixture(tx: DbTx) {
    const f = await fixture(tx);
    const [fulfillmentOrderItem] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: f.fulfillmentOrder.id, skuId: f.sku.id, qty: 10 })
      .returning();
    const [shipmentLine] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: f.shipment.id,
        fulfillmentOrderItemId: fulfillmentOrderItem.id,
        skuId: f.sku.id,
        qty: 10,
      })
      .returning();
    const [secondLocation] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: f.warehouse.id, code: `V2-ZONE-${randomUUID()}`, locationType: 'zone' })
      .returning();
    return { ...f, fulfillmentOrderItem, shipmentLine, secondLocation };
  }

  it('allows only one active invoice for a shipment while retaining voided history', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(wmsTables.invoices).values({
        trackingNo: `V2-INV-A-${randomUUID()}`,
        issueMethod: 'self',
        issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
        shipmentId: f.shipment.id,
        status: 'issued',
      });

      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoices).values({
            trackingNo: `V2-INV-B-${randomUUID()}`,
            issueMethod: 'self',
            issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
            shipmentId: f.shipment.id,
            status: 'issuing',
          }),
        'uq_invoices_shipment_active',
      );
    });

    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(wmsTables.invoices).values({
        trackingNo: `V2-INV-VOID-${randomUUID()}`,
        issueMethod: 'self',
        issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
        shipmentId: f.shipment.id,
        status: 'voided',
      });
      await expect(
        tx.insert(wmsTables.invoices).values({
          trackingNo: `V2-INV-ACTIVE-${randomUUID()}`,
          issueMethod: 'self',
          issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
          shipmentId: f.shipment.id,
          status: 'issued',
        }),
      ).resolves.toBeDefined();
    });
  });

  it('allows only one active work item per shipment', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await tx
        .insert(wmsTables.outboundBatchWorkItems)
        .values({ batchId: f.batch.id, shipmentId: f.shipment.id, status: 'queued' });
      await expectViolation(
        tx,
        (sp) =>
          sp
            .insert(wmsTables.outboundBatchWorkItems)
            .values({ batchId: f.batch.id, shipmentId: f.shipment.id, status: 'picking' }),
        'uq_outbound_work_item_active_shipment',
      );
    });
  });

  it('treats NULL custody grain fields as equal for session balance uniqueness', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [session] = await tx.insert(wmsTables.batchInventorySessions).values({ batchId: f.batch.id }).returning();
      const balance = {
        sessionId: session.id,
        skuId: f.sku.id,
        sourceLocationId: f.location.id,
        custodyType: 'AT_SOURCE' as const,
        custodyRef: null,
        shipmentLineId: null,
        qty: 1,
      };
      await tx.insert(wmsTables.batchInventorySessionBalances).values(balance);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.batchInventorySessionBalances).values(balance),
        'uq_batch_inventory_session_balance_grain',
      );
    });
  });

  it('rejects duplicate dispatch attempt numbers and duplicate command keys', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await tx.insert(wmsTables.dispatchAttempts).values({
        shipmentId: f.shipment.id,
        attemptNo: 1,
        idempotencyKey: `dispatch-a-${randomUUID()}`,
      });
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: f.shipment.id,
            attemptNo: 1,
            idempotencyKey: `dispatch-b-${randomUUID()}`,
          }),
        'uq_dispatch_attempts_shipment_attempt',
      );
    });

    await inRollbackTx(async (tx) => {
      const key = `command-${randomUUID()}`;
      const request = { commandType: 'shipment.split', idempotencyKey: key, requestHash: 'a'.repeat(64) };
      await tx.insert(wmsTables.fulfillmentCommandRequests).values(request);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.fulfillmentCommandRequests).values(request),
        'uq_fulfillment_command_idempotency',
      );
    });
  });

  it('stores operation/attempt command correlation and prevents deleting its durable attempt', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const operationId = randomUUID();
      const [attempt] = await tx
        .insert(wmsTables.dispatchAttempts)
        .values({
          shipmentId: f.shipment.id,
          attemptNo: 1,
          idempotencyKey: `command-attempt-${randomUUID()}`,
        })
        .returning();
      const [request] = await tx
        .insert(wmsTables.fulfillmentCommandRequests)
        .values({
          commandType: 'shipment.dispatch',
          idempotencyKey: `command-${randomUUID()}`,
          requestHash: 'a'.repeat(64),
          operationId,
          attemptId: attempt.id,
        })
        .returning();

      expect(request).toMatchObject({ operationId, attemptId: attempt.id });
      await expectViolation(
        tx,
        (savepoint) =>
          savepoint.delete(wmsTables.dispatchAttempts).where(eq(wmsTables.dispatchAttempts.id, attempt.id)),
        'fulfillment_command_requests_attempt_id_dispatch_attempts_id_fk',
      );
      const [afterRejectedDelete] = await tx
        .select()
        .from(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.id, request.id));
      expect(afterRejectedDelete).toMatchObject({ operationId, attemptId: attempt.id });
    });

    await inRollbackTx(async (tx) => {
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.fulfillmentCommandRequests).values({
            commandType: 'shipment.dispatch',
            idempotencyKey: `invalid-attempt-${randomUUID()}`,
            requestHash: 'b'.repeat(64),
            attemptId: randomUUID(),
          }),
        'fulfillment_command_requests_attempt_id_dispatch_attempts_id_fk',
      );
    });
  });

  it('enforces trusted channel-line and provider-event idempotency while allowing legacy NULL identity', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const channelOrderItemId = `channel-item-${randomUUID()}`;
      const line = {
        salesOrderId: f.salesOrder.id,
        variantId: randomUUID(),
        productName: 'trusted channel line',
        quantity: 1,
        channelOrderItemId,
      };
      await tx.insert(wmsTables.salesOrderLines).values(line);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.salesOrderLines).values({ ...line, variantId: randomUUID() }),
        'uq_sales_order_lines_order_channel_item',
      );
    });

    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expect(
        tx.insert(wmsTables.salesOrderLines).values([
          {
            salesOrderId: f.salesOrder.id,
            variantId: randomUUID(),
            productName: 'legacy line A',
            quantity: 1,
          },
          {
            salesOrderId: f.salesOrder.id,
            variantId: randomUUID(),
            productName: 'legacy line B',
            quantity: 1,
          },
        ]),
      ).resolves.toBeDefined();
    });

    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const providerEventId = `provider-event-${randomUUID()}`;
      const attempts = await tx
        .insert(wmsTables.dispatchAttempts)
        .values([
          {
            shipmentId: f.shipment.id,
            attemptNo: 1,
            idempotencyKey: `provider-attempt-1-${randomUUID()}`,
          },
          {
            shipmentId: f.shipment.id,
            attemptNo: 2,
            idempotencyKey: `provider-attempt-2-${randomUUID()}`,
          },
        ])
        .returning();
      await tx.insert(wmsTables.shipmentTracking).values({
        shipmentId: f.shipment.id,
        dispatchAttemptId: attempts[0].id,
        status: 'in_transit',
        providerEventId,
      });
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentTracking).values({
            shipmentId: f.shipment.id,
            dispatchAttemptId: attempts[0].id,
            status: 'delivered',
            providerEventId,
          }),
        'uq_shipment_tracking_provider_event',
      );
      await expect(
        tx.insert(wmsTables.shipmentTracking).values({
          shipmentId: f.shipment.id,
          dispatchAttemptId: attempts[1].id,
          status: 'in_transit',
          providerEventId,
        }),
      ).resolves.toBeDefined();

      const legacyProviderEventId = `legacy-provider-event-${randomUUID()}`;
      await expect(
        tx.insert(wmsTables.shipmentTracking).values([
          {
            shipmentId: f.shipment.id,
            status: 'in_transit',
            providerEventId: legacyProviderEventId,
          },
          {
            shipmentId: f.shipment.id,
            status: 'delivered',
            providerEventId: legacyProviderEventId,
          },
        ]),
      ).resolves.toBeDefined();
    });
  });

  it('enforces positive/range and custody-specific checks', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: f.shipment.id,
            attemptNo: 0,
            idempotencyKey: `dispatch-invalid-${randomUUID()}`,
          }),
        'ck_dispatch_attempts_attempt_no_positive',
      );
    });

    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const [session] = await tx.insert(wmsTables.batchInventorySessions).values({ batchId: f.batch.id }).returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: session.id,
            skuId: f.sku.id,
            custodyType: 'AT_SOURCE',
            custodyRef: 'not-allowed-at-source',
            qty: 1,
          }),
        'ck_batch_inventory_session_balances_custody',
      );
    });
  });

  it('enforces every existing-table outbound V2 quantity and version check', async () => {
    await inRollbackTx(async (tx) => {
      const f = await physicalFixture(tx);
      const foiBase = { fulfillmentOrderId: f.fulfillmentOrder.id, skuId: f.sku.id };
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.fulfillmentOrderItems).values({ ...foiBase, qty: 0 }),
        'ck_fulfillment_order_items_qty_positive',
      );
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.fulfillmentOrderItems).values({ ...foiBase, qty: 1, reservedQty: -1 }),
        'ck_fulfillment_order_items_progress_nonnegative',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.fulfillmentOrderItems).values({ ...foiBase, qty: 1, shippedQty: 1, canceledQty: 1 }),
        'ck_fulfillment_order_items_settled_within_qty',
      );

      const [checkFoi] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ ...foiBase, qty: 10 })
        .returning();
      const lineBase = {
        shipmentId: f.shipment.id,
        fulfillmentOrderItemId: checkFoi.id,
        skuId: f.sku.id,
      };
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipmentLines).values({ ...lineBase, qty: 0 }),
        'ck_shipment_lines_qty_positive',
      );
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipmentLines).values({ ...lineBase, qty: 1, inspectedQty: 2 }),
        'ck_shipment_lines_inspected_range',
      );
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipmentLines).values({ ...lineBase, qty: 1, reservedQty: 2 }),
        'ck_shipment_lines_reserved_range',
      );
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipmentLines).values({ ...lineBase, qty: 1, lineVersion: 0 }),
        'ck_shipment_lines_line_version_positive',
      );

      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipments).values({ warehouseId: f.warehouse.id, manifestVersion: 0 }),
        'ck_shipments_manifest_version_positive',
      );
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipments).values({ warehouseId: f.warehouse.id, reservationVersion: 0 }),
        'ck_shipments_reservation_version_positive',
      );

      const reservationBase = {
        targetType: 'FULFILLMENT_ORDER',
        targetId: f.fulfillmentOrder.id,
        skuId: f.sku.id,
        warehouseId: f.warehouse.id,
      };
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.stockReservations).values({ ...reservationBase, quantity: 0 }),
        'ck_stock_reservations_quantity_positive',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.stockReservations).values({ ...reservationBase, quantity: 1, invalidatedAt: new Date() }),
        'ck_stock_reservations_invalidation',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.stockLedgers).values({
            skuId: f.sku.id,
            warehouseId: f.warehouse.id,
            locationId: f.location.id,
            stockState: 'ON_HAND',
            version: 0,
          }),
        'ck_stock_ledgers_version_positive',
      );

      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoices).values({
            trackingNo: `V2-INV-MANIFEST-${randomUUID()}`,
            issueMethod: 'self',
            issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
            manifestVersion: 0,
          }),
        'ck_invoices_manifest_version_positive',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoices).values({
            trackingNo: `V2-INV-RECIPIENT-${randomUUID()}`,
            issueMethod: 'self',
            issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
            recipientHash: 'bad',
          }),
        'ck_invoices_recipient_hash',
      );
      const [recipientInvoice] = await tx
        .insert(wmsTables.invoices)
        .values({
          trackingNo: `V2-INV-RECIPIENT-VALID-${randomUUID()}`,
          issueMethod: 'self',
          issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
          recipientHash: 'e'.repeat(64),
        })
        .returning();
      expect(recipientInvoice.recipientHash).toBe('e'.repeat(64));

      const [returnRequest] = await tx
        .insert(returnExchangeTables.returnRequests)
        .values({ salesOrderId: f.salesOrder.id, reasonCode: 'other' })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(returnExchangeTables.returnRequestItems).values({
            returnRequestId: returnRequest.id,
            salesOrderLineId: randomUUID(),
            quantity: 0,
          }),
        'ck_return_request_items_quantity_positive',
      );
    });
  });

  it('stores additive fulfillment, system-location and picking-capability enum values', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      for (const status of ['partially_reserved', 'processing', 'partially_shipped', 'recovery_required'] as const) {
        const [fulfillmentOrder] = await tx
          .insert(wmsTables.fulfillmentOrders)
          .values({ warehouseId: f.warehouse.id, status })
          .returning();
        expect(fulfillmentOrder.status).toBe(status);
      }

      const [configuredWarehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({
          name: `V2-CONFIGURED-WH-${randomUUID()}`,
          supportedPickingStrategies: ['discrete', 'aggregate_then_sort', 'pick_to_tote'],
        })
        .returning();
      expect(configuredWarehouse.supportedPickingStrategies).toEqual([
        'discrete',
        'aggregate_then_sort',
        'pick_to_tote',
      ]);
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.warehouses).values({
            name: `V2-INVALID-CONFIGURED-WH-${randomUUID()}`,
            supportedPickingStrategies: ['unknown'] as never,
          }),
        'picking_strategy',
      );

      const [reworkLocation] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId: f.warehouse.id,
          code: `V2-OUTBOUND-REWORK-${randomUUID()}`,
          locationType: 'zone',
          isSystem: true,
          systemRole: 'outbound_rework',
        })
        .returning();
      expect(reworkLocation.systemRole).toBe('outbound_rework');
    });
  });

  it('keeps the V2 nullable one-to-one and legacy plural sales-order fulfillment relations queryable', async () => {
    await inRollbackTx(async (tx) => {
      const [salesOrder] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: `V2-RELATION-${randomUUID()}`,
          salesChannel: 'medusa',
          shippingAddress: {},
          orderDate: new Date(),
        })
        .returning();
      const loaded = await tx.query.salesOrders.findFirst({
        where: (table, { eq: equals }) => equals(table.id, salesOrder.id),
        with: { fulfillmentOrder: true, fulfillmentOrders: true },
      });
      expect(loaded?.fulfillmentOrder).toBeNull();
      expect(loaded?.fulfillmentOrders).toEqual([]);
    });
  });

  it('enforces command, operation, work-item and picking constraints', async () => {
    await inRollbackTx(async (tx) => {
      const f = await physicalFixture(tx);

      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.fulfillmentCommandRequests).values({
            commandType: 'shipment.split',
            idempotencyKey: randomUUID(),
            requestHash: 'short',
          }),
        'ck_fulfillment_command_request_hash',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.fulfillmentCommandRequests).values({
            commandType: 'shipment.split',
            idempotencyKey: randomUUID(),
            requestHash: 'a'.repeat(64),
            status: 'completed',
          }),
        'ck_fulfillment_command_completion',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.fulfillmentCommandRequests).values({
            commandType: 'shipment.split',
            idempotencyKey: randomUUID(),
            requestHash: 'a'.repeat(64),
            status: 'completed',
            responseSnapshot: { shipmentId: f.shipment.id },
          }),
        'ck_fulfillment_command_completion',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.fulfillmentCommandRequests).values({
            commandType: 'shipment.split',
            idempotencyKey: randomUUID(),
            requestHash: 'a'.repeat(64),
            status: 'completed',
            completedAt: new Date(),
          }),
        'ck_fulfillment_command_completion',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.fulfillmentCommandRequests).values({
            commandType: 'shipment.split',
            idempotencyKey: randomUUID(),
            requestHash: 'a'.repeat(64),
            status: 'failed',
          }),
        'ck_fulfillment_command_failure',
      );
      const [completedCommand] = await tx
        .insert(wmsTables.fulfillmentCommandRequests)
        .values({
          commandType: 'shipment.split',
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          status: 'completed',
          responseSnapshot: { shipmentId: f.shipment.id },
          completedAt: new Date(),
        })
        .returning();
      expect(completedCommand.responseSnapshot).toEqual({ shipmentId: f.shipment.id });
      await expect(
        tx.insert(wmsTables.fulfillmentCommandRequests).values({
          commandType: 'shipment.split',
          idempotencyKey: randomUUID(),
          requestHash: 'a'.repeat(64),
          status: 'failed',
          lastError: 'schema test failure',
        }),
      ).resolves.toBeDefined();

      const operationKey = randomUUID();
      const operationBase = {
        type: 'split' as const,
        operatorId: randomUUID(),
        reason: 'schema test',
        idempotencyKey: operationKey,
        requestHash: 'b'.repeat(64),
      };
      const [operation] = await tx.insert(wmsTables.shipmentOperations).values(operationBase).returning();
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipmentOperations).values(operationBase),
        'uq_shipment_operation_idempotency',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp
            .insert(wmsTables.shipmentOperations)
            .values({ ...operationBase, idempotencyKey: randomUUID(), requestHash: 'bad' }),
        'ck_shipment_operation_request_hash',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentOperations).values({
            ...operationBase,
            idempotencyKey: randomUUID(),
            status: 'completed',
          }),
        'ck_shipment_operation_completion',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentOperations).values({
            ...operationBase,
            idempotencyKey: randomUUID(),
            status: 'failed',
          }),
        'ck_shipment_operation_error_context',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentOperations).values({
            ...operationBase,
            type: 'replan',
            idempotencyKey: randomUUID(),
            status: 'recovery_required',
          }),
        'ck_shipment_operation_error_context',
      );
      for (const type of ['plan', 'short_pick', 'recall'] as const) {
        await tx.insert(wmsTables.shipmentOperations).values({
          ...operationBase,
          type,
          idempotencyKey: randomUUID(),
        });
      }
      const [resumeOperation] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          ...operationBase,
          type: 'replan',
          idempotencyKey: randomUUID(),
          status: 'recovery_required',
          lastError: 'provider outcome unknown',
        })
        .returning();
      expect(resumeOperation.status).toBe('recovery_required');

      const member = { operationId: operation.id, shipmentId: f.shipment.id, role: 'source' as const };
      await tx.insert(wmsTables.shipmentOperationMembers).values(member);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipmentOperationMembers).values(member),
        /shipment_operation_members.*(pkey|pk)/i,
      );
      await expectViolation(
        tx,
        (sp) => sp.delete(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, operation.id)),
        'shipment_operation_members_operation_id',
      );
      await expect(
        tx
          .select()
          .from(wmsTables.shipmentOperationMembers)
          .where(eq(wmsTables.shipmentOperationMembers.operationId, operation.id)),
      ).resolves.toHaveLength(1);
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentOperationMembers).values({
            operationId: operation.id,
            shipmentId: f.shipment.id,
            role: 'target',
            beforeManifestVersion: 0,
          }),
        'ck_shipment_operation_member_versions',
      );

      const invoiceOperationBase = {
        shipmentId: f.shipment.id,
        operation: 'issue' as const,
        idempotencyKey: randomUUID(),
        requestHash: 'c'.repeat(64),
        manifestVersion: 1,
        recipientHash: 'd'.repeat(64),
        providerRequest: { shipmentId: f.shipment.id },
        resumeOperationId: resumeOperation.id,
      };
      const [invoiceOperation] = await tx.insert(wmsTables.invoiceOperations).values(invoiceOperationBase).returning();
      expect(invoiceOperation.providerRequest).toEqual({ shipmentId: f.shipment.id });
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.invoiceOperations).values(invoiceOperationBase),
        'uq_invoice_operation_idempotency',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoiceOperations).values({
            ...invoiceOperationBase,
            idempotencyKey: randomUUID(),
            attempts: -1,
          }),
        'ck_invoice_operations_attempts',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoiceOperations).values({
            ...invoiceOperationBase,
            idempotencyKey: randomUUID(),
            requestHash: 'bad',
          }),
        'ck_invoice_operation_request_hash',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoiceOperations).values({
            ...invoiceOperationBase,
            idempotencyKey: randomUUID(),
            manifestVersion: 0,
          }),
        'ck_invoice_operation_manifest_version',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoiceOperations).values({
            ...invoiceOperationBase,
            idempotencyKey: randomUUID(),
            recipientHash: 'bad',
          }),
        'ck_invoice_operation_recipient_hash',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoiceOperations).values({
            ...invoiceOperationBase,
            idempotencyKey: randomUUID(),
            providerRequest: null as never,
          }),
        'provider_request',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoiceOperations).values({
            ...invoiceOperationBase,
            idempotencyKey: randomUUID(),
            resumeOperationId: randomUUID(),
          }),
        'invoice_operations_resume_operation_id',
      );
      for (const status of ['failed', 'recovery_required'] as const) {
        await expectViolation(
          tx,
          (sp) =>
            sp.insert(wmsTables.invoiceOperations).values({
              ...invoiceOperationBase,
              idempotencyKey: randomUUID(),
              status,
            }),
          'ck_invoice_operation_error_context',
        );
      }
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoiceOperations).values({
            ...invoiceOperationBase,
            idempotencyKey: randomUUID(),
            status: 'succeeded',
          }),
        'ck_invoice_operation_completion',
      );

      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'completed',
            leaseVersion: -1,
            completedAt: new Date(),
          }),
        'ck_outbound_work_items_lease_version',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'excluded',
          }),
        'ck_outbound_work_items_exclusion',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'completed',
          }),
        'ck_outbound_work_items_completion',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'short_pick_recovery',
          }),
        'ck_outbound_work_items_recovery',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'completed',
            completedAt: new Date(),
            pickerReleasedAt: new Date(),
          }),
        'ck_outbound_work_items_picker_release',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'completed',
            completedAt: new Date(),
            pickerClaimedAt: new Date('2026-01-02T00:00:00.000Z'),
            pickerReleasedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        'ck_outbound_work_items_picker_release',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'completed',
            completedAt: new Date(),
            packerReleasedAt: new Date(),
          }),
        'ck_outbound_work_items_packer_release',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'completed',
            completedAt: new Date(),
            packerClaimedAt: new Date('2026-01-02T00:00:00.000Z'),
            packerReleasedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        'ck_outbound_work_items_packer_release',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboundBatchWorkItems).values({
            batchId: f.batch.id,
            shipmentId: f.shipment.id,
            status: 'excluded',
            exclusionReason: 'schema test',
            waitingOperationId: randomUUID(),
          }),
        'outbound_batch_work_items_waiting_operation_id',
      );
      await tx.insert(wmsTables.outboundBatchWorkItems).values({
        batchId: f.batch.id,
        shipmentId: f.shipment.id,
        status: 'short_pick_recovery',
        recoveryReason: 'one source was short',
        waitingOperationId: resumeOperation.id,
      });
      await expectViolation(
        tx,
        (sp) => sp.delete(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, resumeOperation.id)),
        /(?:invoice_operations_resume_operation_id|outbound_batch_work_items_waiting_operation_id)/,
      );

      const [plan] = await tx
        .insert(wmsTables.pickingPlans)
        .values({ batchId: f.batch.id, strategy: 'discrete', createdBy: randomUUID() })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlans).values({
            batchId: f.batch.id,
            strategy: 'unknown' as never,
            createdBy: randomUUID(),
            version: 2,
          }),
        'picking_strategy',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlans).values({
            batchId: f.batch.id,
            strategy: 'discrete',
            createdBy: randomUUID(),
            version: 1,
          }),
        'uq_picking_plans_batch_version',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlans).values({
            batchId: f.batch.id,
            strategy: 'discrete',
            createdBy: randomUUID(),
            version: 0,
          }),
        'ck_picking_plans_version_positive',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlans).values({
            batchId: f.batch.id,
            strategy: 'discrete',
            createdBy: randomUUID(),
            version: 2,
            status: 'invalidated',
          }),
        'ck_picking_plans_invalidation',
      );

      const planMember = {
        planId: plan.id,
        shipmentId: f.shipment.id,
        manifestVersion: 1,
        reservationVersion: 1,
      };
      await tx.insert(wmsTables.pickingPlanMembers).values(planMember);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.pickingPlanMembers).values(planMember),
        /picking_plan_members.*(pkey|pk)/i,
      );
      const [secondShipment] = await tx.insert(wmsTables.shipments).values({ warehouseId: f.warehouse.id }).returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlanMembers).values({
            planId: plan.id,
            shipmentId: secondShipment.id,
            manifestVersion: 0,
            reservationVersion: 1,
          }),
        'ck_picking_plan_member_versions',
      );

      const [shortPickOperation] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          type: 'short_pick',
          operatorId: randomUUID(),
          reason: 'source shortage',
          idempotencyKey: `retire-short-pick-${randomUUID()}`,
          requestHash: 'a'.repeat(64),
        })
        .returning();
      await tx
        .update(wmsTables.pickingPlanMembers)
        .set({
          retiredAt: new Date(),
          retireReason: 'source shortage reconciled',
          retiredByOperationId: shortPickOperation.id,
          retiredByOperationType: 'short_pick',
        })
        .where(
          and(
            eq(wmsTables.pickingPlanMembers.planId, plan.id),
            eq(wmsTables.pickingPlanMembers.shipmentId, f.shipment.id),
          ),
        );
      const [retiredMember] = await tx
        .select()
        .from(wmsTables.pickingPlanMembers)
        .where(
          and(
            eq(wmsTables.pickingPlanMembers.planId, plan.id),
            eq(wmsTables.pickingPlanMembers.shipmentId, f.shipment.id),
          ),
        );
      expect(retiredMember).toMatchObject({
        retireReason: 'source shortage reconciled',
        retiredByOperationId: shortPickOperation.id,
        retiredByOperationType: 'short_pick',
      });

      const [incompleteRetirementShipment] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: f.warehouse.id })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlanMembers).values({
            planId: plan.id,
            shipmentId: incompleteRetirementShipment.id,
            manifestVersion: 1,
            reservationVersion: 1,
            retiredAt: new Date(),
            retireReason: 'missing operation ownership',
          }),
        'ck_picking_plan_member_retirement',
      );

      const [replanOperation] = await tx
        .insert(wmsTables.shipmentOperations)
        .values({
          type: 'replan',
          operatorId: randomUUID(),
          reason: 'not a short pick',
          idempotencyKey: `retire-replan-${randomUUID()}`,
          requestHash: 'b'.repeat(64),
        })
        .returning();
      const [wrongOperationShipment] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: f.warehouse.id })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlanMembers).values({
            planId: plan.id,
            shipmentId: wrongOperationShipment.id,
            manifestVersion: 1,
            reservationVersion: 1,
            retiredAt: new Date(),
            retireReason: 'wrong operation type',
            retiredByOperationId: replanOperation.id,
            retiredByOperationType: 'short_pick',
          }),
        'fk_picking_plan_member_retirement_operation',
      );

      const [blankReasonShipment] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: f.warehouse.id })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingPlanMembers).values({
            planId: plan.id,
            shipmentId: blankReasonShipment.id,
            manifestVersion: 1,
            reservationVersion: 1,
            retiredAt: new Date(),
            retireReason: '   ',
            retiredByOperationId: shortPickOperation.id,
            retiredByOperationType: 'short_pick',
          }),
        'ck_picking_plan_member_retirement',
      );

      const allocation = {
        planId: plan.id,
        shipmentLineId: f.shipmentLine.id,
        sourceLocationId: f.location.id,
        qty: 1,
        sourceStockVersion: 1,
      };
      await tx.insert(wmsTables.pickingSourceAllocations).values(allocation);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.pickingSourceAllocations).values(allocation),
        'uq_picking_source_allocations_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingSourceAllocations).values({
            ...allocation,
            sourceLocationId: f.secondLocation.id,
            qty: 0,
          }),
        'ck_picking_source_allocations_qty_positive',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingSourceAllocations).values({
            ...allocation,
            sourceLocationId: f.secondLocation.id,
            sourceStockVersion: -1,
          }),
        'ck_picking_source_allocations_stock_version',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.pickingSourceAllocations).values({
            ...allocation,
            sourceLocationId: f.secondLocation.id,
            sourceStockVersion: null as never,
          }),
        'source_stock_version',
      );
    });
  });

  it('enforces session, custody event, tote and assignment invariants', async () => {
    await inRollbackTx(async (tx) => {
      const f = await physicalFixture(tx);
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batch.id, handedInQty: 10 })
        .returning();

      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessions).values({
            batchId: f.batch.id,
            status: 'recovery_required',
            recoveryReason: 'duplicate active session',
          }),
        'uq_batch_inventory_sessions_active_batch',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessions).values({
            batchId: f.batch.id,
            status: 'settled',
            version: 0,
          }),
        'ck_batch_inventory_sessions_version_positive',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessions).values({
            batchId: f.batch.id,
            status: 'settled',
            returnedQty: -1,
          }),
        'ck_batch_inventory_sessions_quantities',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessions).values({
            batchId: f.batch.id,
            status: 'settled',
            handedInQty: 1,
            settledQty: 2,
          }),
        'ck_batch_inventory_sessions_settlement',
      );
      const [recoveryBatch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          batchNumber: `V2-RECOVERY-BATCH-${randomUUID()}`,
          warehouseId: f.warehouse.id,
          pickingMethod: 'individual',
        })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessions).values({
            batchId: recoveryBatch.id,
            status: 'recovery_required',
          }),
        'ck_batch_inventory_sessions_recovery',
      );
      const [recoverySession] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({
          batchId: recoveryBatch.id,
          status: 'recovery_required',
          recoveryReason: 'event projection mismatch',
        })
        .returning();
      expect(recoverySession.recoveryReason).toBe('event projection mismatch');

      await tx.insert(wmsTables.batchInventorySessionBalances).values([
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'AT_SOURCE',
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'WORKER',
          custodyRef: 'worker-1',
          shipmentLineId: f.shipmentLine.id,
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'BULK_CART',
          custodyRef: 'cart-1',
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'TOTE',
          custodyRef: 'tote-1',
          shipmentLineId: f.shipmentLine.id,
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'SORTING',
          custodyRef: 'sort-1',
          shipmentLineId: f.shipmentLine.id,
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'PACKING',
          custodyRef: 'pack-1',
          shipmentLineId: f.shipmentLine.id,
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'PACKED',
          custodyRef: 'packed-1',
          shipmentLineId: f.shipmentLine.id,
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.secondLocation.id,
          custodyType: 'RETURN_PENDING',
          shipmentLineId: f.shipmentLine.id,
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: f.sku.id,
          sourceLocationId: f.location.id,
          custodyType: 'SETTLED',
          shipmentLineId: f.shipmentLine.id,
          qty: 1,
        },
      ]);
      const invalidCustodyGrains = [
        {
          sourceLocationId: f.location.id,
          custodyType: 'AT_SOURCE' as const,
          shipmentLineId: f.shipmentLine.id,
        },
        { sourceLocationId: f.location.id, custodyType: 'WORKER' as const, custodyRef: 'worker-missing-line' },
        {
          sourceLocationId: f.location.id,
          custodyType: 'BULK_CART' as const,
          custodyRef: 'cart-with-line',
          shipmentLineId: f.shipmentLine.id,
        },
        { sourceLocationId: f.location.id, custodyType: 'TOTE' as const, custodyRef: 'tote-missing-line' },
        { sourceLocationId: f.location.id, custodyType: 'SORTING' as const, custodyRef: 'sort-missing-line' },
        { sourceLocationId: f.location.id, custodyType: 'PACKING' as const, custodyRef: 'pack-missing-line' },
        { sourceLocationId: f.location.id, custodyType: 'PACKED' as const, custodyRef: 'packed-missing-line' },
        { sourceLocationId: f.location.id, custodyType: 'RETURN_PENDING' as const },
        { sourceLocationId: f.location.id, custodyType: 'SETTLED' as const },
        {
          sourceLocationId: f.location.id,
          custodyType: 'RETURN_PENDING' as const,
          custodyRef: 'forbidden-return-ref',
          shipmentLineId: f.shipmentLine.id,
        },
        {
          sourceLocationId: f.location.id,
          custodyType: 'SETTLED' as const,
          custodyRef: 'forbidden-settled-ref',
          shipmentLineId: f.shipmentLine.id,
        },
      ];
      for (const grain of invalidCustodyGrains) {
        await expectViolation(
          tx,
          (sp) =>
            sp.insert(wmsTables.batchInventorySessionBalances).values({
              sessionId: session.id,
              skuId: f.sku.id,
              qty: 1,
              ...grain,
            }),
          'ck_batch_inventory_session_balances_custody',
        );
      }
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: session.id,
            skuId: f.sku.id,
            sourceLocationId: f.secondLocation.id,
            custodyType: 'AT_SOURCE',
            qty: -1,
          }),
        'ck_batch_inventory_session_balances_qty',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: session.id,
            skuId: f.sku.id,
            sourceLocationId: f.secondLocation.id,
            custodyType: 'AT_SOURCE',
            qty: 1,
            version: 0,
          }),
        'ck_batch_inventory_session_balances_version',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: session.id,
            skuId: f.sku.id,
            custodyType: 'WORKER',
            qty: 1,
          }),
        'ck_batch_inventory_session_balances_custody',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: session.id,
            skuId: f.sku.id,
            sourceLocationId: f.location.id,
            custodyType: 'PACKED',
            custodyRef: 'missing-line',
            qty: 1,
          }),
        'ck_batch_inventory_session_balances_custody',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: session.id,
            skuId: f.sku.id,
            custodyType: 'RETURN_PENDING',
            shipmentLineId: f.shipmentLine.id,
            qty: 1,
          }),
        'ck_batch_inventory_session_balances_custody',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionBalances).values({
            sessionId: session.id,
            skuId: f.sku.id,
            sourceLocationId: f.location.id,
            custodyType: 'SETTLED',
            qty: 1,
          }),
        'ck_batch_inventory_session_balances_custody',
      );

      const aggregateToSortingKey = `aggregate-sorting-${randomUUID()}`;
      const [aggregateToSorting] = await tx
        .insert(wmsTables.batchInventorySessionEvents)
        .values({
          sessionId: session.id,
          idempotencyKey: aggregateToSortingKey,
          eventType: 'aggregate_to_sorting',
          skuId: f.sku.id,
          quantity: 1,
          fromCustodyType: 'BULK_CART',
          fromCustodyRef: 'cart-1',
          fromSourceLocationId: f.location.id,
          toCustodyType: 'SORTING',
          toCustodyRef: 'sort-1',
          toSourceLocationId: f.location.id,
          toShipmentLineId: f.shipmentLine.id,
        })
        .returning();
      expect(aggregateToSorting).toMatchObject({
        fromCustodyType: 'BULK_CART',
        fromCustodyRef: 'cart-1',
        fromSourceLocationId: f.location.id,
        fromShipmentLineId: null,
        toCustodyType: 'SORTING',
        toCustodyRef: 'sort-1',
        toSourceLocationId: f.location.id,
        toShipmentLineId: f.shipmentLine.id,
      });

      const [returnToSource] = await tx
        .insert(wmsTables.batchInventorySessionEvents)
        .values({
          sessionId: session.id,
          idempotencyKey: `return-source-${randomUUID()}`,
          eventType: 'return_to_source',
          skuId: f.sku.id,
          quantity: 1,
          fromCustodyType: 'RETURN_PENDING',
          fromSourceLocationId: f.secondLocation.id,
          fromShipmentLineId: f.shipmentLine.id,
          toCustodyType: 'AT_SOURCE',
          toSourceLocationId: f.location.id,
        })
        .returning();
      expect(returnToSource).toMatchObject({
        fromCustodyType: 'RETURN_PENDING',
        fromSourceLocationId: f.secondLocation.id,
        fromCustodyRef: null,
        fromShipmentLineId: f.shipmentLine.id,
        toCustodyType: 'AT_SOURCE',
        toSourceLocationId: f.location.id,
        toCustodyRef: null,
        toShipmentLineId: null,
      });

      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: aggregateToSortingKey,
            eventType: 'duplicate',
            skuId: f.sku.id,
            quantity: 1,
            toCustodyType: 'WORKER',
            toCustodyRef: 'worker-2',
            toSourceLocationId: f.location.id,
            toShipmentLineId: f.shipmentLine.id,
          }),
        'uq_batch_inventory_session_event_idempotency',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'invalid_quantity',
            skuId: f.sku.id,
            quantity: 0,
            toCustodyType: 'WORKER',
            toCustodyRef: 'worker-2',
            toSourceLocationId: f.location.id,
            toShipmentLineId: f.shipmentLine.id,
          }),
        'ck_batch_inventory_session_events_qty_positive',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'missing_sides',
            skuId: f.sku.id,
            quantity: 1,
          }),
        'ck_batch_inventory_session_events_sides',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'stray_absent_side_field',
            skuId: f.sku.id,
            quantity: 1,
            fromCustodyRef: 'stray',
            toCustodyType: 'WORKER',
            toCustodyRef: 'worker-2',
            toSourceLocationId: f.location.id,
            toShipmentLineId: f.shipmentLine.id,
          }),
        'ck_batch_inventory_session_events_from_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'source_missing_location',
            skuId: f.sku.id,
            quantity: 1,
            fromCustodyType: 'AT_SOURCE',
          }),
        'ck_batch_inventory_session_events_from_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'source_with_ref',
            skuId: f.sku.id,
            quantity: 1,
            fromCustodyType: 'AT_SOURCE',
            fromSourceLocationId: f.location.id,
            fromCustodyRef: 'not-source-grain',
          }),
        'ck_batch_inventory_session_events_from_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'packed_missing_line',
            skuId: f.sku.id,
            quantity: 1,
            toCustodyType: 'PACKED',
            toCustodyRef: 'packed-2',
            toSourceLocationId: f.location.id,
          }),
        'ck_batch_inventory_session_events_to_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'return_pending_with_ref',
            skuId: f.sku.id,
            quantity: 1,
            fromCustodyType: 'RETURN_PENDING',
            fromCustodyRef: 'forbidden-return-ref',
            fromSourceLocationId: f.location.id,
            fromShipmentLineId: f.shipmentLine.id,
          }),
        'ck_batch_inventory_session_events_from_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'settled_with_ref',
            skuId: f.sku.id,
            quantity: 1,
            toCustodyType: 'SETTLED',
            toCustodyRef: 'forbidden-settled-ref',
            toSourceLocationId: f.location.id,
            toShipmentLineId: f.shipmentLine.id,
          }),
        'ck_batch_inventory_session_events_to_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'invalid_from_location_fk',
            skuId: f.sku.id,
            quantity: 1,
            fromCustodyType: 'AT_SOURCE',
            fromSourceLocationId: randomUUID(),
          }),
        'batch_inventory_session_events_from_source_location_id',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'invalid_to_location_fk',
            skuId: f.sku.id,
            quantity: 1,
            toCustodyType: 'AT_SOURCE',
            toSourceLocationId: randomUUID(),
          }),
        'batch_inventory_session_events_to_source_location_id',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'invalid_from_line_fk',
            skuId: f.sku.id,
            quantity: 1,
            fromCustodyType: 'PACKED',
            fromCustodyRef: 'packed-2',
            fromSourceLocationId: f.location.id,
            fromShipmentLineId: randomUUID(),
          }),
        'batch_inventory_session_events_from_shipment_line_id',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.batchInventorySessionEvents).values({
            sessionId: session.id,
            idempotencyKey: randomUUID(),
            eventType: 'invalid_to_line_fk',
            skuId: f.sku.id,
            quantity: 1,
            toCustodyType: 'PACKED',
            toCustodyRef: 'packed-2',
            toSourceLocationId: f.location.id,
            toShipmentLineId: randomUUID(),
          }),
        'batch_inventory_session_events_to_shipment_line_id',
      );

      const [historySession] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: f.batch.id, status: 'settled' })
        .returning();
      const [historyEvent] = await tx
        .insert(wmsTables.batchInventorySessionEvents)
        .values({
          sessionId: historySession.id,
          idempotencyKey: randomUUID(),
          eventType: 'history_evidence',
          skuId: f.sku.id,
          quantity: 1,
          toCustodyType: 'WORKER',
          toCustodyRef: 'worker-history',
          toSourceLocationId: f.location.id,
          toShipmentLineId: f.shipmentLine.id,
        })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.delete(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.id, historySession.id)),
        'batch_inventory_session_events_session_id',
      );
      await expect(
        tx
          .select()
          .from(wmsTables.batchInventorySessionEvents)
          .where(eq(wmsTables.batchInventorySessionEvents.id, historyEvent.id)),
      ).resolves.toHaveLength(1);

      const barcode = `V2-TOTE-${randomUUID()}`;
      const [tote] = await tx.insert(wmsTables.totes).values({ warehouseId: f.warehouse.id, barcode }).returning();
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.totes).values({ warehouseId: f.warehouse.id, barcode }),
        'uq_totes_barcode',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.totes).values({
            warehouseId: f.warehouse.id,
            barcode: `V2-TOTE-${randomUUID()}`,
            version: 0,
          }),
        'ck_totes_version_positive',
      );

      await tx.insert(wmsTables.shipmentToteAssignments).values({
        shipmentId: f.shipment.id,
        toteId: tote.id,
        assignedBy: randomUUID(),
      });
      const [secondShipment] = await tx.insert(wmsTables.shipments).values({ warehouseId: f.warehouse.id }).returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentToteAssignments).values({
            shipmentId: secondShipment.id,
            toteId: tote.id,
            assignedBy: randomUUID(),
          }),
        'uq_shipment_tote_assignments_active_tote',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentToteAssignments).values({
            shipmentId: f.shipment.id,
            toteId: tote.id,
            assignedBy: randomUUID(),
          }),
        /uq_shipment_tote_assignments_active_(?:tote|pair)/,
      );
      const [releaseTote] = await tx
        .insert(wmsTables.totes)
        .values({ warehouseId: f.warehouse.id, barcode: `V2-TOTE-${randomUUID()}` })
        .returning();
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.shipmentToteAssignments).values({
            shipmentId: f.shipment.id,
            toteId: releaseTote.id,
            assignedBy: randomUUID(),
            assignedAt: new Date('2026-01-02T00:00:00.000Z'),
            releasedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        'ck_shipment_tote_assignments_release',
      );
    });
  });

  it('enforces dispatch attempt and exact source evidence invariants', async () => {
    await inRollbackTx(async (tx) => {
      const f = await physicalFixture(tx);
      const [secondShipment] = await tx.insert(wmsTables.shipments).values({ warehouseId: f.warehouse.id }).returning();
      const [stockJournal] = await tx.insert(wmsTables.stockJournals).values({}).returning();
      const [reversalJournal] = await tx.insert(wmsTables.stockJournals).values({}).returning();
      const [testOriginalJournal] = await tx.insert(wmsTables.stockJournals).values({}).returning();
      const [testReversalJournal] = await tx.insert(wmsTables.stockJournals).values({}).returning();
      const attemptKey = `dispatch-${randomUUID()}`;
      const [attempt] = await tx
        .insert(wmsTables.dispatchAttempts)
        .values({
          shipmentId: f.shipment.id,
          attemptNo: 1,
          idempotencyKey: attemptKey,
          stockJournalId: stockJournal.id,
          reversalJournalId: reversalJournal.id,
        })
        .returning();

      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: attemptKey,
          }),
        'uq_dispatch_attempts_idempotency',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            stockJournalId: stockJournal.id,
          }),
        'uq_dispatch_attempts_stock_journal',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            reversalJournalId: reversalJournal.id,
          }),
        'uq_dispatch_attempts_reversal_journal',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            status: 'dispatched',
            dispatchedAt: new Date(),
          }),
        'ck_dispatch_attempts_dispatched_at',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            status: 'recalled',
            stockJournalId: testOriginalJournal.id,
            dispatchedAt: new Date(),
            recalledAt: new Date(),
          }),
        'ck_dispatch_attempts_recalled_at',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            status: 'recalled',
            reversalJournalId: testReversalJournal.id,
            dispatchedAt: new Date(),
            recalledAt: new Date(),
          }),
        'ck_dispatch_attempts_dispatched_at',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            stockJournalId: testOriginalJournal.id,
            reversalJournalId: testOriginalJournal.id,
          }),
        'ck_dispatch_attempts_distinct_journals',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            status: 'recalled',
            stockJournalId: testOriginalJournal.id,
            reversalJournalId: testReversalJournal.id,
            dispatchedAt: new Date('2026-01-02T00:00:00.000Z'),
            recalledAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        'ck_dispatch_attempts_recall_chronology',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            status: 'recalled',
            stockJournalId: testOriginalJournal.id,
            reversalJournalId: testReversalJournal.id,
            dispatchedAt: new Date('2026-01-01T00:00:00.000Z'),
            carrierAcceptedAt: new Date('2026-01-01T01:00:00.000Z'),
            recalledAt: new Date('2026-01-01T02:00:00.000Z'),
          }),
        'ck_dispatch_attempts_recall_carrier',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            carrierAcceptedAt: new Date(),
          }),
        'ck_dispatch_attempts_carrier_acceptance',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            dispatchedAt: new Date('2026-01-02T00:00:00.000Z'),
            carrierAcceptedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        'ck_dispatch_attempts_carrier_acceptance',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttempts).values({
            shipmentId: secondShipment.id,
            attemptNo: 1,
            idempotencyKey: randomUUID(),
            status: 'recovery_required',
          }),
        'ck_dispatch_attempts_recovery_code',
      );

      const [stockEvent] = await tx
        .insert(wmsTables.stockEvents)
        .values({
          skuId: f.sku.id,
          fromWarehouseId: f.warehouse.id,
          fromLocationId: f.location.id,
          fromState: 'ON_HAND',
          transitionType: 'SHIP',
          quantity: 1,
          occurredAt: new Date(),
        })
        .returning();
      const source = {
        dispatchAttemptId: attempt.id,
        shipmentLineId: f.shipmentLine.id,
        sourceLocationId: f.location.id,
        qty: 1,
        stockEventId: stockEvent.id,
      };
      const [persistedSource] = await tx.insert(wmsTables.dispatchAttemptSources).values(source).returning();
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.dispatchAttemptSources).values({ ...source, stockEventId: null }),
        'uq_dispatch_attempt_sources_grain',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttemptSources).values({
            ...source,
            sourceLocationId: f.secondLocation.id,
          }),
        'uq_dispatch_attempt_sources_stock_event',
      );
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.dispatchAttemptSources).values({
            dispatchAttemptId: attempt.id,
            shipmentLineId: f.shipmentLine.id,
            sourceLocationId: f.secondLocation.id,
            qty: 0,
          }),
        'ck_dispatch_attempt_sources_qty_positive',
      );

      await expectViolation(
        tx,
        (sp) => sp.delete(wmsTables.dispatchAttempts).where(eq(wmsTables.dispatchAttempts.id, attempt.id)),
        'dispatch_attempt_sources_dispatch_attempt_id',
      );
      await expect(
        tx
          .select()
          .from(wmsTables.dispatchAttemptSources)
          .where(eq(wmsTables.dispatchAttemptSources.id, persistedSource.id)),
      ).resolves.toHaveLength(1);
    });
  });

  it('requires recovery and supersession context for new existing-table enum states', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipments).values({ warehouseId: f.warehouse.id, status: 'recovery_required' }),
        'ck_shipments_recovery_code',
      );
    });

    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectViolation(
        tx,
        (sp) => sp.insert(wmsTables.shipments).values({ warehouseId: f.warehouse.id, status: 'superseded' }),
        'ck_shipments_superseded_at',
      );
    });

    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.invoices).values({
            trackingNo: `V2-INV-RECOVERY-${randomUUID()}`,
            issueMethod: 'self',
            issuedForFulfillmentOrderId: f.fulfillmentOrder.id,
            status: 'recovery_required',
          }),
        'ck_invoices_recovery_state',
      );
    });
  });

  it('deduplicates explicitly routed outbox rows and leaves legacy topicless writes independent', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      const dbService = {
        db,
        run: <T>(fn: (inner: DbTx) => Promise<T>, inner?: DbTx) =>
          inner ? fn(inner) : db.transaction((transaction) => fn(transaction as unknown as DbTx)),
      } as unknown as DbService<typeof wmsSchema>;
      const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
      const inventoryOutbox = new InventoryOutboxService(dbService);
      const idempotencyKey = `attempt-${randomUUID()}`;
      const routed = {
        topic: SHIPMENT_STREAM.topic.topic,
        idempotencyKey,
        eventType: 'ShipmentShipped',
        aggregateType: 'Shipment',
        aggregateId: f.shipment.id,
        partitionKey: f.shipment.id,
        payload: { shipmentId: f.shipment.id },
      } as const;

      const first = await fulfillmentOutbox.enqueue(routed, tx);
      const duplicate = await inventoryOutbox.enqueue(routed, tx);
      expect(duplicate?.id).toBe(first?.id);

      const legacy = {
        eventType: 'LegacyTest',
        aggregateType: 'Fulfillment',
        aggregateId: f.fulfillmentOrder.id,
        partitionKey: f.fulfillmentOrder.id,
        payload: {},
      } as const;
      await fulfillmentOutbox.enqueue(legacy, tx);
      await fulfillmentOutbox.enqueue(legacy, tx);

      const rows = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.aggregateId, f.shipment.id),
            eq(wmsTables.outboxEvents.idempotencyKey, idempotencyKey),
          ),
        );
      expect(rows).toHaveLength(1);

      const legacyRows = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.aggregateId, f.fulfillmentOrder.id),
            eq(wmsTables.outboxEvents.eventType, 'LegacyTest'),
          ),
        );
      expect(legacyRows).toHaveLength(2);
    });
  });

  it('rejects half-specified explicit outbox routing at the database boundary', async () => {
    await inRollbackTx(async (tx) => {
      const f = await fixture(tx);
      await expectViolation(
        tx,
        (sp) =>
          sp.insert(wmsTables.outboxEvents).values({
            topic: SHIPMENT_STREAM.topic.topic,
            eventType: 'ShipmentShipped',
            aggregateType: 'Shipment',
            aggregateId: f.shipment.id,
            partitionKey: f.shipment.id,
            payload: {},
          }),
        'ck_outbox_routing_pair',
      );
    });
  });
});
