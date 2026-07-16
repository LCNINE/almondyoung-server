import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { SCOPE_AUTHORIZATION_DECISION_BRAND } from '@app/authorization';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../inventory/core/services/location.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { OutboxService as FulfillmentOutboxService } from '../outbox/outbox.service';
import { inRollbackTx, makeDb, makeDbService } from './__support__';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { InvoiceOrchestrator, canonicalShipmentRecipientHash } from './invoice-orchestrator.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ShipmentDispatchService (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  function ambientDbService(tx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: tx,
      run: <T>(fn: (trx: DbTx) => Promise<T>): Promise<T> => fn(tx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function serviceFor(dbService: DbService<typeof wmsSchema>) {
    const workflow = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' }));
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const controlled = new BatchControlledStockGuard();
    const eventStore = new StockEventStore(dbService, sellable, controlled);
    const inventory = new InventoryCommandService(
      dbService,
      eventStore,
      inventoryOutbox,
      new LocationService(dbService),
      controlled,
    );
    const unified = new UnifiedReservationService(dbService, sellable);
    const shipmentReservations = new ShipmentReservationService(
      dbService,
      unified,
      new FulfillmentProgressService(),
      new FulfillmentInvariantService(),
    );
    const audit = new AuditService(dbService);
    const invoices = new InvoiceOrchestrator(
      dbService,
      new FulfillmentCommandService(dbService),
      new FulfillmentInvariantService(),
      audit,
      {} as never,
      {} as never,
      workflow,
      {} as never,
    );
    return new ShipmentDispatchService(
      dbService,
      new FulfillmentCommandService(dbService),
      inventory,
      new BatchInventorySessionService(dbService, controlled, audit),
      shipmentReservations,
      invoices,
      new BarcodeService(dbService),
      fulfillmentOutbox,
      audit,
      workflow,
    );
  }

  function services(tx: DbTx) {
    return serviceFor(ambientDbService(tx));
  }

  function isolatedDb(applicationName: string) {
    const sqlClient = postgres(DATABASE_URL as string, {
      max: 1,
      connection: { application_name: applicationName },
    });
    return { sql: sqlClient, db: drizzle(sqlClient, { schema: wmsSchema }) };
  }

  async function seedReadyShipment(tx: DbTx) {
    const suffix = randomUUID();
    const actorId = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `dispatch-warehouse-${suffix}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `dispatch-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'Dispatch SKU', code: `DISPATCH-${suffix}`, holderId: holder.id })
      .returning();
    const barcode = `880${suffix.replaceAll('-', '').slice(0, 10)}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
    const [location] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `DISPATCH-ZONE-${suffix}`, locationType: 'zone' })
      .returning();
    const [ledger] = await tx
      .insert(wmsTables.stockLedgers)
      .values({ skuId: sku.id, warehouseId: warehouse.id, locationId: location.id, stockState: 'ON_HAND', qty: 2 })
      .returning();

    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `dispatch-order-${suffix}`,
        salesChannel: 'medusa',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [salesOrderLine] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: salesOrder.id,
        variantId: randomUUID(),
        productName: 'Dispatch product',
        quantity: 2,
        channelOrderItemId: `channel-item-${suffix}`,
        channelProductId: `channel-product-${suffix}`,
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId: salesOrder.id, warehouseId: warehouse.id, status: 'processing', totalQty: 2 })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fulfillmentOrder.id,
        salesOrderId: salesOrder.id,
        salesOrderLineId: salesOrderLine.id,
        skuId: sku.id,
        qty: 2,
        reservedQty: 2,
        status: 'processing',
      })
      .returning();
    const recipientSnapshot = { recipientName: 'Dispatch Test', phone: '010-1111-2222' };
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: warehouse.id,
        status: 'planned',
        recipientSnapshot,
        plannedAt: new Date(),
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: item.id,
        skuId: sku.id,
        qty: 2,
        reservedQty: 2,
        inspectedQty: 1,
      })
      .returning();
    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'SHIPMENT_LINE',
      targetId: line.id,
      shipmentLineId: line.id,
      skuId: sku.id,
      warehouseId: warehouse.id,
      quantity: 2,
      status: 'confirmed',
      requestedAt: new Date(),
    });
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `DISPATCH-BATCH-${suffix}`,
        warehouseId: warehouse.id,
        pickingMethod: 'individual',
        status: 'picking',
      })
      .returning();
    const [workItem] = await tx
      .insert(wmsTables.outboundBatchWorkItems)
      .values({
        batchId: batch.id,
        shipmentId: shipment.id,
        status: 'packing',
        packerId: actorId,
        packerClaimedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        leaseVersion: 1,
      })
      .returning();
    const [plan] = await tx
      .insert(wmsTables.pickingPlans)
      .values({ batchId: batch.id, strategy: 'discrete', status: 'active', createdBy: actorId })
      .returning();
    await tx.insert(wmsTables.pickingPlanMembers).values({
      planId: plan.id,
      shipmentId: shipment.id,
      manifestVersion: shipment.manifestVersion,
      reservationVersion: shipment.reservationVersion,
    });
    await tx.insert(wmsTables.pickingSourceAllocations).values({
      planId: plan.id,
      shipmentLineId: line.id,
      sourceLocationId: location.id,
      qty: 2,
      sourceStockVersion: ledger.version,
    });
    const [session] = await tx
      .insert(wmsTables.batchInventorySessions)
      .values({ batchId: batch.id, status: 'active', handedInQty: 2 })
      .returning();
    await tx.insert(wmsTables.batchInventorySessionEvents).values({
      sessionId: session.id,
      idempotencyKey: `start:${plan.id}`,
      eventType: 'HAND_IN',
      skuId: sku.id,
      quantity: 2,
      toCustodyType: 'AT_SOURCE',
      toSourceLocationId: location.id,
      payload: { planId: plan.id, sequence: 0, requestHash: 'a'.repeat(64), actorId },
    });
    await tx.insert(wmsTables.batchInventorySessionBalances).values([
      {
        sessionId: session.id,
        skuId: sku.id,
        sourceLocationId: location.id,
        custodyType: 'PACKING',
        custodyRef: `work-item:${shipment.id}`,
        shipmentLineId: line.id,
        qty: 1,
      },
      {
        sessionId: session.id,
        skuId: sku.id,
        sourceLocationId: location.id,
        custodyType: 'PACKED',
        custodyRef: `work-item:${shipment.id}`,
        shipmentLineId: line.id,
        qty: 1,
      },
    ]);
    const [invoice] = await tx
      .insert(wmsTables.invoices)
      .values({
        trackingNo: `TRACK-${suffix}`,
        carrier: 'CJ',
        issueMethod: 'self',
        externalServiceId: `service-${suffix}`,
        issuedForFulfillmentOrderId: fulfillmentOrder.id,
        shipmentId: shipment.id,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalShipmentRecipientHash(recipientSnapshot),
        status: 'issued',
      })
      .returning();
    return {
      actorId,
      barcode,
      batch,
      fulfillmentOrder,
      holder,
      invoice,
      item,
      ledger,
      line,
      location,
      plan,
      salesOrder,
      salesOrderLine,
      session,
      shipment,
      sku,
      warehouse,
      workItem,
    };
  }

  async function cleanupCommittedFixture(
    fixture: Awaited<ReturnType<typeof seedReadyShipment>>,
    commandKeys: readonly string[],
  ): Promise<void> {
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const attempts = await tx
        .select({
          id: wmsTables.dispatchAttempts.id,
          stockJournalId: wmsTables.dispatchAttempts.stockJournalId,
          reversalJournalId: wmsTables.dispatchAttempts.reversalJournalId,
        })
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, fixture.shipment.id));
      const attemptIds = attempts.map((attempt) => attempt.id);
      const sources = attemptIds.length
        ? await tx
            .select({ stockEventId: wmsTables.dispatchAttemptSources.stockEventId })
            .from(wmsTables.dispatchAttemptSources)
            .where(inArray(wmsTables.dispatchAttemptSources.dispatchAttemptId, attemptIds))
        : [];
      const stockEventIds = sources.flatMap((source) => (source.stockEventId ? [source.stockEventId] : []));
      const journalIds = attempts.flatMap((attempt) =>
        [attempt.stockJournalId, attempt.reversalJournalId].filter((id): id is string => id !== null),
      );

      if (commandKeys.length > 0) {
        await tx
          .delete(wmsTables.fulfillmentCommandRequests)
          .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, [...commandKeys]));
      }
      await tx.delete(wmsTables.auditLogs).where(eq(wmsTables.auditLogs.userId, fixture.actorId));
      const outboxAggregateIds = [fixture.shipment.id, fixture.fulfillmentOrder.id, ...stockEventIds];
      await tx.delete(wmsTables.outboxEvents).where(inArray(wmsTables.outboxEvents.aggregateId, outboxAggregateIds));

      if (attemptIds.length > 0) {
        await tx
          .delete(wmsTables.dispatchAttemptSources)
          .where(inArray(wmsTables.dispatchAttemptSources.dispatchAttemptId, attemptIds));
        await tx.delete(wmsTables.dispatchAttempts).where(inArray(wmsTables.dispatchAttempts.id, attemptIds));
      }
      if (stockEventIds.length > 0) {
        await tx.delete(wmsTables.stockEvents).where(inArray(wmsTables.stockEvents.id, stockEventIds));
      }
      if (journalIds.length > 0) {
        await tx.delete(wmsTables.stockJournals).where(inArray(wmsTables.stockJournals.id, journalIds));
      }

      await tx
        .delete(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.sessionId, fixture.session.id));
      await tx
        .delete(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, fixture.session.id));
      await tx
        .delete(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, fixture.session.id));
      await tx
        .delete(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.planId, fixture.plan.id));
      await tx.delete(wmsTables.pickingPlanMembers).where(eq(wmsTables.pickingPlanMembers.planId, fixture.plan.id));
      await tx.delete(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.id, fixture.plan.id));
      await tx
        .delete(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItem.id));
      await tx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      await tx.delete(wmsTables.invoices).where(eq(wmsTables.invoices.id, fixture.invoice.id));
      await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, fixture.shipment.id));
      await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      await tx
        .delete(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fixture.fulfillmentOrder.id));
      await tx.delete(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, fixture.salesOrderLine.id));
      await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, fixture.salesOrder.id));
      await tx
        .delete(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, fixture.sku.id),
            eq(wmsTables.stockLedgers.warehouseId, fixture.warehouse.id),
            eq(wmsTables.stockLedgers.locationId, fixture.location.id),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        );
      await tx.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, fixture.sku.id));
      await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.sku.id));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holder.id));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, fixture.location.id));
      await tx.delete(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, fixture.batch.id));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
    });
  }

  async function waitForLockWaiters(applicationPrefix: string, expected: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [row] = await client<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name LIKE ${`${applicationPrefix}%`}
          AND wait_event_type = 'Lock'
      `;
      if (Number(row?.count ?? 0) >= expected) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${expected} independent dispatch lock waiters`);
  }

  async function addSplitShipment(tx: DbTx, base: Awaited<ReturnType<typeof seedReadyShipment>>, quantity: number) {
    const suffix = randomUUID();
    const [sourceBalance] = await tx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, base.session.id));
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: base.shipment.warehouseId,
        status: 'planned',
        recipientSnapshot: base.shipment.recipientSnapshot,
        plannedAt: new Date(),
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: base.item.id,
        skuId: base.sku.id,
        qty: quantity,
        reservedQty: quantity,
        inspectedQty: quantity - 1,
      })
      .returning();
    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'SHIPMENT_LINE',
      targetId: line.id,
      shipmentLineId: line.id,
      skuId: base.sku.id,
      warehouseId: base.shipment.warehouseId,
      quantity,
      status: 'confirmed',
      requestedAt: new Date(),
    });
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `DISPATCH-SPLIT-${suffix}`,
        warehouseId: base.shipment.warehouseId,
        pickingMethod: 'individual',
        status: 'picking',
      })
      .returning();
    await tx.insert(wmsTables.outboundBatchWorkItems).values({
      batchId: batch.id,
      shipmentId: shipment.id,
      status: 'packing',
      packerId: base.actorId,
      packerClaimedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseVersion: 1,
    });
    const [plan] = await tx
      .insert(wmsTables.pickingPlans)
      .values({ batchId: batch.id, strategy: 'discrete', status: 'active', createdBy: base.actorId })
      .returning();
    await tx.insert(wmsTables.pickingPlanMembers).values({
      planId: plan.id,
      shipmentId: shipment.id,
      manifestVersion: shipment.manifestVersion,
      reservationVersion: shipment.reservationVersion,
    });
    await tx.insert(wmsTables.pickingSourceAllocations).values({
      planId: plan.id,
      shipmentLineId: line.id,
      sourceLocationId: sourceBalance.sourceLocationId!,
      qty: quantity,
      sourceStockVersion: base.ledger.version,
    });
    const [session] = await tx
      .insert(wmsTables.batchInventorySessions)
      .values({ batchId: batch.id, status: 'active', handedInQty: quantity })
      .returning();
    await tx.insert(wmsTables.batchInventorySessionEvents).values({
      sessionId: session.id,
      idempotencyKey: `start:${plan.id}`,
      eventType: 'HAND_IN',
      skuId: base.sku.id,
      quantity,
      toCustodyType: 'AT_SOURCE',
      toSourceLocationId: sourceBalance.sourceLocationId,
      payload: { planId: plan.id, sequence: 0, requestHash: 'b'.repeat(64), actorId: base.actorId },
    });
    await tx.insert(wmsTables.batchInventorySessionBalances).values([
      {
        sessionId: session.id,
        skuId: base.sku.id,
        sourceLocationId: sourceBalance.sourceLocationId,
        custodyType: 'PACKING',
        custodyRef: `work-item:${shipment.id}`,
        shipmentLineId: line.id,
        qty: 1,
      },
      {
        sessionId: session.id,
        skuId: base.sku.id,
        sourceLocationId: sourceBalance.sourceLocationId,
        custodyType: 'PACKED',
        custodyRef: `work-item:${shipment.id}`,
        shipmentLineId: line.id,
        qty: quantity - 1,
      },
    ]);
    const [invoice] = await tx
      .insert(wmsTables.invoices)
      .values({
        trackingNo: `TRACK-${suffix}`,
        carrier: 'CJ',
        issueMethod: 'self',
        externalServiceId: `service-${suffix}`,
        issuedForFulfillmentOrderId: base.fulfillmentOrder.id,
        shipmentId: shipment.id,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalShipmentRecipientHash(shipment.recipientSnapshot),
        status: 'issued',
      })
      .returning();
    return { invoice, line, session, shipment };
  }

  it('commits the last scan, exact-source SHIP, reservation/session settlement, progress and outbox atomically', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedReadyShipment(tx);
      const result = await services(tx).inspectionScan(fixture.shipment.id, {
        barcode: fixture.barcode,
        quantity: 1,
        actor: { id: fixture.actorId, roles: ['logistics_worker'] },
        idempotencyKey: `dispatch-scan-${randomUUID()}`,
      });
      expect(result).toMatchObject({ status: 'shipped', attemptNo: 1 });
      expect(typeof result.dispatchAttemptId).toBe('string');

      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      const [reservation] = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      const [ledger] = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, fixture.sku.id),
            eq(wmsTables.stockLedgers.warehouseId, fixture.shipment.warehouseId),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        );
      const [attempt] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, result.dispatchAttemptId!));
      const [source] = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempt.id));
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, fixture.session.id));
      const events = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            inArray(wmsTables.outboxEvents.topic, [
              'shipments.events.v1',
              'fulfillments.events.v2',
              'fulfillments.events.v1',
            ]),
            inArray(wmsTables.outboxEvents.aggregateId, [fixture.shipment.id, fixture.fulfillmentOrder.id]),
          ),
        );

      expect(shipment).toMatchObject({ status: 'shipped' });
      expect(line).toMatchObject({ inspectedQty: 2, reservedQty: 0 });
      expect(item).toMatchObject({ shippedQty: 2, status: 'completed' });
      expect(reservation).toMatchObject({
        status: 'released',
        stateReason: `shipment-dispatch:${result.dispatchAttemptId}`,
      });
      expect(ledger.qty).toBe(0);
      expect(attempt).toMatchObject({ status: 'dispatched', invoiceId: fixture.invoice.id });
      expect(source).toMatchObject({ shipmentLineId: fixture.line.id, qty: 2 });
      expect(typeof source.stockEventId).toBe('string');
      expect(session).toMatchObject({ status: 'settled', settledQty: 2 });
      expect(events.map((event) => event.topic).sort()).toEqual([
        'fulfillments.events.v1',
        'fulfillments.events.v2',
        'shipments.events.v1',
      ]);
    });
  });

  it('redispatches the same recalled shipment as attempt 2 with a new invoice and immutable attempt-1 history', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedReadyShipment(tx);
      const oldAttemptId = randomUUID();
      const oldRecallOperationId = randomUUID();
      const [oldInvoice] = await tx
        .insert(wmsTables.invoices)
        .values({
          trackingNo: `OLD-${randomUUID()}`,
          carrier: 'CJ',
          issueMethod: 'self',
          externalServiceId: `old-service-${randomUUID()}`,
          issuedForFulfillmentOrderId: fixture.fulfillmentOrder.id,
          shipmentId: fixture.shipment.id,
          manifestVersion: fixture.shipment.manifestVersion,
          recipientHash: canonicalShipmentRecipientHash(fixture.shipment.recipientSnapshot),
          status: 'voided',
          voidedAt: new Date('2026-07-15T01:00:00.000Z'),
        })
        .returning();
      const [oldJournal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
          sourceId: oldAttemptId,
          idempotencyKey: `old-${randomUUID()}`,
        })
        .returning();
      const [oldReversalJournal] = await tx
        .insert(wmsTables.stockJournals)
        .values({
          sourceType: 'SHIPMENT_RECALL',
          sourceId: oldRecallOperationId,
          idempotencyKey: `old-recall-${randomUUID()}`,
        })
        .returning();
      const dispatchedAt = new Date('2026-07-15T00:00:00.000Z');
      const [oldAttempt] = await tx
        .insert(wmsTables.dispatchAttempts)
        .values({
          id: oldAttemptId,
          shipmentId: fixture.shipment.id,
          attemptNo: 1,
          status: 'recalled',
          idempotencyKey: `old-attempt-${randomUUID()}`,
          invoiceId: oldInvoice.id,
          stockJournalId: oldJournal.id,
          reversalJournalId: oldReversalJournal.id,
          dispatchedAt,
          recalledAt: new Date('2026-07-15T01:00:00.000Z'),
        })
        .returning();
      const [oldEvent] = await tx
        .insert(wmsTables.stockEvents)
        .values({
          journalId: oldJournal.id,
          skuId: fixture.sku.id,
          fromWarehouseId: fixture.warehouse.id,
          fromLocationId: fixture.location.id,
          fromState: 'ON_HAND',
          transitionType: 'SHIP',
          quantity: fixture.line.qty,
          occurredAt: dispatchedAt,
          idempotencyKey: `old-event-${randomUUID()}`,
          eventStatus: 'POSTED',
        })
        .returning();
      const [oldSource] = await tx
        .insert(wmsTables.dispatchAttemptSources)
        .values({
          dispatchAttemptId: oldAttempt.id,
          shipmentLineId: fixture.line.id,
          sourceLocationId: fixture.location.id,
          qty: fixture.line.qty,
          stockEventId: oldEvent.id,
        })
        .returning();
      const [oldTracking] = await tx
        .insert(wmsTables.shipmentTracking)
        .values({
          shipmentId: fixture.shipment.id,
          dispatchAttemptId: oldAttempt.id,
          providerEventId: `old-tracking-${randomUUID()}`,
          status: 'shipped',
          timestamp: dispatchedAt,
        })
        .returning();

      const result = await services(tx).inspectionScan(fixture.shipment.id, {
        barcode: fixture.barcode,
        quantity: 1,
        actor: { id: fixture.actorId, roles: ['logistics_worker'] },
        idempotencyKey: `redispatch-scan-${randomUUID()}`,
      });

      expect(result).toMatchObject({ status: 'shipped', attemptNo: 2 });
      const attempts = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, fixture.shipment.id))
        .orderBy(wmsTables.dispatchAttempts.attemptNo);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toMatchObject({
        id: oldAttempt.id,
        attemptNo: 1,
        status: 'recalled',
        invoiceId: oldInvoice.id,
      });
      expect(attempts[1]).toMatchObject({
        id: result.dispatchAttemptId,
        attemptNo: 2,
        status: 'dispatched',
        invoiceId: fixture.invoice.id,
      });
      const [sourceAfter] = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.id, oldSource.id));
      const [trackingAfter] = await tx
        .select()
        .from(wmsTables.shipmentTracking)
        .where(eq(wmsTables.shipmentTracking.id, oldTracking.id));
      expect(sourceAfter).toEqual(oldSource);
      expect(trackingAfter).toEqual(oldTracking);
    });
  });

  it('replays the same last-scan command without a second attempt or SHIP event', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedReadyShipment(tx);
      const service = services(tx);
      const input = {
        barcode: fixture.barcode,
        quantity: 1,
        actor: { id: fixture.actorId, roles: ['logistics_worker'] },
        idempotencyKey: `dispatch-replay-${randomUUID()}`,
      };
      const first = await service.inspectionScan(fixture.shipment.id, input);
      const outboxAfterFirst = await tx
        .select({
          id: wmsTables.outboxEvents.id,
          topic: wmsTables.outboxEvents.topic,
          idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
        })
        .from(wmsTables.outboxEvents)
        .where(
          and(
            inArray(wmsTables.outboxEvents.topic, [
              'shipments.events.v1',
              'fulfillments.events.v2',
              'fulfillments.events.v1',
            ]),
            inArray(wmsTables.outboxEvents.aggregateId, [fixture.shipment.id, fixture.fulfillmentOrder.id]),
          ),
        );
      const replay = await service.inspectionScan(fixture.shipment.id, input);
      const attempts = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, fixture.shipment.id));
      const shipEvents = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.transitionType, 'SHIP'));
      const outboxAfterReplay = await tx
        .select({
          id: wmsTables.outboxEvents.id,
          topic: wmsTables.outboxEvents.topic,
          idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
        })
        .from(wmsTables.outboxEvents)
        .where(
          and(
            inArray(wmsTables.outboxEvents.topic, [
              'shipments.events.v1',
              'fulfillments.events.v2',
              'fulfillments.events.v1',
            ]),
            inArray(wmsTables.outboxEvents.aggregateId, [fixture.shipment.id, fixture.fulfillmentOrder.id]),
          ),
        );

      expect(replay).toEqual(first);
      expect(attempts).toHaveLength(1);
      expect(shipEvents.filter((event) => event.journalId === attempts[0].stockJournalId)).toHaveLength(1);
      expect(outboxAfterReplay).toEqual(outboxAfterFirst);
      expect(outboxAfterReplay.map((event) => `${event.topic}:${event.idempotencyKey}`).sort()).toEqual(
        [
          `shipments.events.v1:${first.dispatchAttemptId}`,
          `fulfillments.events.v2:${first.dispatchAttemptId}:${fixture.fulfillmentOrder.id}`,
          `fulfillments.events.v1:${fixture.fulfillmentOrder.id}:fully-shipped`,
        ].sort(),
      );
    });
  });

  it('serializes different-key last scans across independent transactions so exactly one dispatches', async () => {
    const fixture = await db.transaction((tx) => seedReadyShipment(tx as unknown as DbTx));
    const applicationPrefix = `dispatch-race-${randomUUID()}`;
    const firstDb = isolatedDb(`${applicationPrefix}-first`);
    const secondDb = isolatedDb(`${applicationPrefix}-second`);
    const blockerDb = isolatedDb(`${applicationPrefix}-blocker`);
    const firstKey = `dispatch-race-a-${randomUUID()}`;
    const secondKey = `dispatch-race-b-${randomUUID()}`;
    const actor = { id: fixture.actorId, roles: ['logistics_worker'] };
    let releaseBlocker: (() => void) | undefined;
    let blocker: Promise<unknown> | undefined;
    let race: Promise<PromiseSettledResult<unknown>[]> | undefined;

    try {
      let markBlockedRowLocked: (() => void) | undefined;
      const blockedRowLocked = new Promise<void>((resolve) => {
        markBlockedRowLocked = resolve;
      });
      const blockerRelease = new Promise<void>((resolve) => {
        releaseBlocker = resolve;
      });
      blocker = blockerDb.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT id FROM shipments WHERE id = ${fixture.shipment.id}::uuid FOR UPDATE`);
        markBlockedRowLocked?.();
        await blockerRelease;
      });
      await blockedRowLocked;

      const firstService = serviceFor(makeDbService(firstDb.db));
      const secondService = serviceFor(makeDbService(secondDb.db));
      race = Promise.allSettled([
        firstService.inspectionScan(fixture.shipment.id, {
          barcode: fixture.barcode,
          quantity: 1,
          actor,
          idempotencyKey: firstKey,
        }),
        secondService.inspectionScan(fixture.shipment.id, {
          barcode: fixture.barcode,
          quantity: 1,
          actor,
          idempotencyKey: secondKey,
        }),
      ]);
      await waitForLockWaiters(applicationPrefix, 2);
      releaseBlocker();
      await blocker;
      const results = await race;

      const attempts = await db
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, fixture.shipment.id));
      const sources = await db
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempts[0].id));
      const shipEvents = await db
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, sources[0].stockEventId!));
      const outbox = await db
        .select({
          topic: wmsTables.outboxEvents.topic,
          idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
        })
        .from(wmsTables.outboxEvents)
        .where(
          inArray(wmsTables.outboxEvents.aggregateId, [
            fixture.shipment.id,
            fixture.fulfillmentOrder.id,
            sources[0].stockEventId!,
          ]),
        );

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(attempts).toHaveLength(1);
      expect(sources).toHaveLength(1);
      expect(shipEvents).toHaveLength(1);
      expect(shipEvents[0]).toMatchObject({ transitionType: 'SHIP', journalId: attempts[0].stockJournalId });
      expect(outbox.map((event) => `${event.topic}:${event.idempotencyKey}`).sort()).toEqual(
        [
          `inventory.events.v1:stock-event:${sources[0].stockEventId}`,
          `shipments.events.v1:${attempts[0].id}`,
          `fulfillments.events.v2:${attempts[0].id}:${fixture.fulfillmentOrder.id}`,
          `fulfillments.events.v1:${fixture.fulfillmentOrder.id}:fully-shipped`,
        ].sort(),
      );
    } finally {
      releaseBlocker?.();
      await blocker?.catch(() => undefined);
      await race?.catch(() => undefined);
      await Promise.all([firstDb.sql.end(), secondDb.sql.end(), blockerDb.sql.end()]);
      await cleanupCommittedFixture(fixture, [firstKey, secondKey]);
    }
  });

  it('rolls back inspection custody and every economic effect when the current invoice is stale', async () => {
    const fixture = await db.transaction((tx) => seedReadyShipment(tx as unknown as DbTx));
    const commandKey = `dispatch-stale-invoice-${randomUUID()}`;
    const commandDb = isolatedDb(`dispatch-stale-${randomUUID()}`);

    try {
      await db
        .update(wmsTables.invoices)
        .set({ manifestVersion: fixture.shipment.manifestVersion + 1 })
        .where(eq(wmsTables.invoices.id, fixture.invoice.id));

      const loadSnapshot = async () => {
        const [line] = await db
          .select({
            inspectedQty: wmsTables.shipmentLines.inspectedQty,
            reservedQty: wmsTables.shipmentLines.reservedQty,
            lineVersion: wmsTables.shipmentLines.lineVersion,
          })
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
        const balances = await db
          .select({
            custodyType: wmsTables.batchInventorySessionBalances.custodyType,
            qty: wmsTables.batchInventorySessionBalances.qty,
            version: wmsTables.batchInventorySessionBalances.version,
          })
          .from(wmsTables.batchInventorySessionBalances)
          .where(eq(wmsTables.batchInventorySessionBalances.sessionId, fixture.session.id));
        const sessionEvents = await db
          .select({
            id: wmsTables.batchInventorySessionEvents.id,
            eventType: wmsTables.batchInventorySessionEvents.eventType,
            quantity: wmsTables.batchInventorySessionEvents.quantity,
          })
          .from(wmsTables.batchInventorySessionEvents)
          .where(eq(wmsTables.batchInventorySessionEvents.sessionId, fixture.session.id));
        const [ledger] = await db
          .select({ qty: wmsTables.stockLedgers.qty, version: wmsTables.stockLedgers.version })
          .from(wmsTables.stockLedgers)
          .where(
            and(
              eq(wmsTables.stockLedgers.skuId, fixture.sku.id),
              eq(wmsTables.stockLedgers.warehouseId, fixture.warehouse.id),
              eq(wmsTables.stockLedgers.locationId, fixture.location.id),
              eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
            ),
          );
        const reservations = await db
          .select({
            id: wmsTables.stockReservations.id,
            quantity: wmsTables.stockReservations.quantity,
            status: wmsTables.stockReservations.status,
            stateReason: wmsTables.stockReservations.stateReason,
            invalidatedAt: wmsTables.stockReservations.invalidatedAt,
          })
          .from(wmsTables.stockReservations)
          .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
        const attempts = await db
          .select({ id: wmsTables.dispatchAttempts.id })
          .from(wmsTables.dispatchAttempts)
          .where(eq(wmsTables.dispatchAttempts.shipmentId, fixture.shipment.id));
        const shipEvents = await db
          .select({ id: wmsTables.stockEvents.id })
          .from(wmsTables.stockEvents)
          .where(
            and(eq(wmsTables.stockEvents.skuId, fixture.sku.id), eq(wmsTables.stockEvents.transitionType, 'SHIP')),
          );
        const outbox = await db
          .select({ id: wmsTables.outboxEvents.id })
          .from(wmsTables.outboxEvents)
          .where(
            inArray(wmsTables.outboxEvents.partitionKey, [
              fixture.shipment.id,
              fixture.fulfillmentOrder.id,
              fixture.sku.id,
            ]),
          );
        const commands = await db
          .select({ id: wmsTables.fulfillmentCommandRequests.id })
          .from(wmsTables.fulfillmentCommandRequests)
          .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, commandKey));
        return {
          attempts,
          balances: balances.sort((left, right) => left.custodyType.localeCompare(right.custodyType)),
          commands,
          ledger,
          line,
          outbox,
          reservations,
          sessionEvents,
          shipEvents,
        };
      };

      const before = await loadSnapshot();
      await expect(
        serviceFor(makeDbService(commandDb.db)).inspectionScan(fixture.shipment.id, {
          barcode: fixture.barcode,
          quantity: 1,
          actor: { id: fixture.actorId, roles: ['logistics_worker'] },
          idempotencyKey: commandKey,
        }),
      ).rejects.toMatchObject({ response: { code: 'SHIPMENT_INVOICE_STALE' } });
      const after = await loadSnapshot();

      expect(before).toMatchObject({
        attempts: [],
        commands: [],
        ledger: { qty: 2 },
        line: { inspectedQty: 1, reservedQty: 2 },
        outbox: [],
        shipEvents: [],
      });
      expect(after).toEqual(before);
    } finally {
      await commandDb.sql.end();
      await cleanupCommittedFixture(fixture, [commandKey]);
    }
  });

  it('emits v1 full completion only once when 6/4 split shipments dispatch sequentially', async () => {
    await inRollbackTx(db, async (tx) => {
      const first = await seedReadyShipment(tx);
      await tx.update(wmsTables.stockLedgers).set({ qty: 10 }).where(eq(wmsTables.stockLedgers.skuId, first.sku.id));
      await tx
        .update(wmsTables.fulfillmentOrders)
        .set({ totalQty: 10, totalReservedQty: 10 })
        .where(eq(wmsTables.fulfillmentOrders.id, first.fulfillmentOrder.id));
      await tx
        .update(wmsTables.fulfillmentOrderItems)
        .set({ qty: 10, reservedQty: 10 })
        .where(eq(wmsTables.fulfillmentOrderItems.id, first.item.id));
      await tx
        .update(wmsTables.shipmentLines)
        .set({ qty: 6, reservedQty: 6, inspectedQty: 5 })
        .where(eq(wmsTables.shipmentLines.id, first.line.id));
      await tx
        .update(wmsTables.stockReservations)
        .set({ quantity: 6 })
        .where(eq(wmsTables.stockReservations.shipmentLineId, first.line.id));
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 6 })
        .where(eq(wmsTables.pickingSourceAllocations.shipmentLineId, first.line.id));
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ handedInQty: 6 })
        .where(eq(wmsTables.batchInventorySessions.id, first.session.id));
      await tx
        .update(wmsTables.batchInventorySessionEvents)
        .set({ quantity: 6 })
        .where(eq(wmsTables.batchInventorySessionEvents.sessionId, first.session.id));
      await tx
        .update(wmsTables.batchInventorySessionBalances)
        .set({ qty: 5 })
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, first.session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'PACKED'),
          ),
        );
      const second = await addSplitShipment(tx, first, 4);
      const service = services(tx);

      await service.inspectionScan(first.shipment.id, {
        barcode: first.barcode,
        quantity: 1,
        actor: { id: first.actorId, roles: ['logistics_worker'] },
        idempotencyKey: `dispatch-split-first-${randomUUID()}`,
      });
      let v1 = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, 'fulfillments.events.v1'),
            eq(wmsTables.outboxEvents.idempotencyKey, `${first.fulfillmentOrder.id}:fully-shipped`),
          ),
        );
      expect(v1).toHaveLength(0);

      await service.inspectionScan(second.shipment.id, {
        barcode: first.barcode,
        quantity: 1,
        actor: { id: first.actorId, roles: ['logistics_worker'] },
        idempotencyKey: `dispatch-split-second-${randomUUID()}`,
      });
      v1 = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, 'fulfillments.events.v1'),
            eq(wmsTables.outboxEvents.idempotencyKey, `${first.fulfillmentOrder.id}:fully-shipped`),
          ),
        );
      expect(v1).toHaveLength(1);
    });
  });

  it('persists force quantities and operator context in the required audit record', async () => {
    await inRollbackTx(db, async (tx) => {
      const fixture = await seedReadyShipment(tx);
      const response = await services(tx).forceDispatch(fixture.shipment.id, {
        reason: 'scanner outage',
        csCaseId: 'CS-1234',
        note: 'approved by warehouse lead',
        actor: { id: fixture.actorId, roles: ['logistics_manager'] },
        idempotencyKey: `dispatch-force-${randomUUID()}`,
        authorization: {
          scope: FULFILLMENT_SCOPE.DISPATCH_FORCE,
          granted: true,
          [SCOPE_AUTHORIZATION_DECISION_BRAND]: true,
        },
      });
      const [audit] = await tx
        .select()
        .from(wmsTables.auditLogs)
        .where(
          and(
            eq(wmsTables.auditLogs.action, 'shipment.dispatch.force'),
            eq(wmsTables.auditLogs.userId, fixture.actorId),
          ),
        );

      expect(response.forcedQuantities).toEqual([{ shipmentLineId: fixture.line.id, quantity: 1 }]);
      expect(audit).toMatchObject({ userId: fixture.actorId });
      expect(audit.metadata).toMatchObject({
        dispatchAttemptId: response.dispatchAttemptId,
        reason: 'scanner outage',
        csCaseId: 'CS-1234',
        note: 'approved by warehouse lead',
        forcedQuantities: [{ shipmentLineId: fixture.line.id, quantity: 1 }],
      });
    });
  });
});
