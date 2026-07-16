import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { LocationService } from '../../inventory/core/services/location.service';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';
import { OutboxService as FulfillmentOutboxService } from '../outbox/outbox.service';
import { makeDb, makeDbService } from './__support__';
import { BatchInventorySessionFaultInjector, BatchInventorySessionService } from './batch-inventory-session.service';
import { BatchSessionRecoveryService } from './batch-session-recovery.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { InvoiceOrchestrator, canonicalShipmentRecipientHash } from './invoice-orchestrator.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { DiscretePickingStrategy } from '../picking/discrete-picking.strategy';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Database = PostgresJsDatabase<typeof wmsSchema>;

class Rollback extends Error {}

describeIfDb('Outbound V2 recovery release scenarios 16-17 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  const actorId = randomUUID();

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => client.end());

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>): Promise<void> {
    await expect(
      db.transaction(async (rawTx) => {
        await fn(rawTx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  function serviceSet(database: Database, faultInjector?: BatchInventorySessionFaultInjector) {
    const dbService = makeDbService(database);
    const guard = new BatchControlledStockGuard();
    const audit = new AuditService(dbService);
    const sessions = new BatchInventorySessionService(dbService, guard, audit, faultInjector);
    const recovery = new BatchSessionRecoveryService(dbService, audit, guard);
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const inventory = new InventoryCommandService(
      dbService,
      new StockEventStore(dbService, sellable, guard),
      inventoryOutbox,
      new LocationService(dbService),
      guard,
    );
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const workflow = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' }));
    const batches = new OutboundBatchOrchestrator(dbService, commands, invariant, {} as never, audit, workflow, {
      get: jest.fn(() => ({ resumePending: jest.fn() })),
    } as never);
    const picking = new DiscretePickingStrategy(
      dbService,
      commands,
      workflow,
      invariant,
      sessions,
      guard,
      {} as never,
      batches,
    );
    return { dbService, guard, audit, sessions, recovery, inventory, batches, picking };
  }

  function ambientDbService(tx: DbTx): DbService<typeof wmsSchema> {
    return {
      db: tx,
      run: <T>(fn: (trx: DbTx) => Promise<T>): Promise<T> => fn(tx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function dispatchService(tx: DbTx): ShipmentDispatchService {
    const dbService = ambientDbService(tx);
    const workflow = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' }));
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const guard = new BatchControlledStockGuard();
    const inventory = new InventoryCommandService(
      dbService,
      new StockEventStore(dbService, sellable, guard),
      inventoryOutbox,
      new LocationService(dbService),
      guard,
    );
    const reservations = new ShipmentReservationService(
      dbService,
      new UnifiedReservationService(dbService, sellable),
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
      new BatchInventorySessionService(dbService, guard, audit),
      reservations,
      invoices,
      new BarcodeService(dbService),
      fulfillmentOutbox,
      audit,
      workflow,
    );
  }

  async function seedReadyPlan(tx: DbTx, quantity = 2) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `recovery-wh-${suffix}` })
      .returning();
    const [sourceLocation] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `RECOVERY-SOURCE-${suffix}`, locationType: 'zone' })
      .returning();
    const [targetLocation] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `RECOVERY-TARGET-${suffix}`, locationType: 'zone' })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `recovery-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'Recovery scenario SKU', code: `RECOVERY-${suffix}`, holderId: holder.id })
      .returning();
    const barcode = `87${suffix.replaceAll('-', '').slice(0, 11)}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
    const [ledger] = await tx
      .insert(wmsTables.stockLedgers)
      .values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: sourceLocation.id,
        stockState: 'ON_HAND',
        qty: quantity,
      })
      .returning();
    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `recovery-order-${suffix}`,
        salesChannel: 'medusa',
        status: 'confirmed',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [salesOrderLine] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: salesOrder.id,
        variantId: randomUUID(),
        productName: 'Recovery scenario product',
        quantity,
        channelOrderItemId: `recovery-item-${suffix}`,
        channelProductId: `recovery-product-${suffix}`,
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        salesOrderId: salesOrder.id,
        warehouseId: warehouse.id,
        status: 'processing',
        totalItems: 1,
        totalQty: quantity,
        totalReservedQty: quantity,
      })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fulfillmentOrder.id,
        salesOrderId: salesOrder.id,
        salesOrderLineId: salesOrderLine.id,
        skuId: sku.id,
        qty: quantity,
        reservedQty: quantity,
        status: 'processing',
      })
      .returning();
    const recipientSnapshot = { recipientName: 'Recovery Tester', phone: '010-2222-3333' };
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({ warehouseId: warehouse.id, status: 'planned', recipientSnapshot, plannedAt: new Date() })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: item.id,
        skuId: sku.id,
        qty: quantity,
        reservedQty: quantity,
        inspectedQty: quantity - 1,
      })
      .returning();
    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'SHIPMENT_LINE',
      targetId: line.id,
      shipmentLineId: line.id,
      skuId: sku.id,
      warehouseId: warehouse.id,
      quantity,
      status: 'confirmed',
      requestedAt: new Date('2026-07-15T00:00:00.000Z'),
    });
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `RECOVERY-BATCH-${suffix}`,
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
        status: 'queued',
      })
      .returning();
    const [plan] = await tx
      .insert(wmsTables.pickingPlans)
      .values({ batchId: batch.id, strategy: 'discrete', createdBy: actorId })
      .returning();
    await tx.insert(wmsTables.pickingPlanMembers).values({
      planId: plan.id,
      shipmentId: shipment.id,
      manifestVersion: shipment.manifestVersion,
      reservationVersion: shipment.reservationVersion,
    });
    const [allocation] = await tx
      .insert(wmsTables.pickingSourceAllocations)
      .values({
        planId: plan.id,
        shipmentLineId: line.id,
        sourceLocationId: sourceLocation.id,
        qty: quantity,
        sourceStockVersion: ledger.version,
      })
      .returning();
    const [invoice] = await tx
      .insert(wmsTables.invoices)
      .values({
        trackingNo: `RECOVERY-TRACK-${suffix}`,
        carrier: 'CJ',
        issueMethod: 'self',
        externalServiceId: `recovery-service-${suffix}`,
        issuedForFulfillmentOrderId: fulfillmentOrder.id,
        shipmentId: shipment.id,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalShipmentRecipientHash(recipientSnapshot),
        status: 'issued',
      })
      .returning();
    return {
      allocation,
      barcode,
      batch,
      fulfillmentOrder,
      invoice,
      item,
      ledger,
      line,
      plan,
      shipment,
      sku,
      sourceLocation,
      targetLocation,
      warehouse,
      workItem,
      quantity,
    };
  }

  async function expectSessionConservation(tx: DbTx, sessionId: string): Promise<void> {
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId));
    const [active] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    expect(session.handedInQty).toBe(
      Number(active.qty) + session.settledQty + session.returnedQty + session.shortageQty,
    );
  }

  async function expectConflictCode(action: Promise<unknown>, code: string): Promise<void> {
    await expect(action).rejects.toMatchObject({ response: { code } });
  }

  async function releaseOutboxCardinality(tx: DbTx): Promise<Record<string, number>> {
    const topics = ['inventory.events.v1', 'fulfillments.events.v1', 'fulfillments.events.v2', 'shipments.events.v1'];
    const rows = await tx
      .select({ topic: wmsTables.outboxEvents.topic, count: sql<number>`count(*)::int` })
      .from(wmsTables.outboxEvents)
      .where(inArray(wmsTables.outboxEvents.topic, topics))
      .groupBy(wmsTables.outboxEvents.topic);
    return Object.fromEntries(
      topics.map((topic) => [topic, Number(rows.find((row) => row.topic === topic)?.count ?? 0)]),
    );
  }

  it('16 rejects general movement from a batch-controlled source and preserves stock, session, and FOI demand', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedReadyPlan(tx);
      const services = serviceSet(db);
      const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: fixture.sku.id,
        warehouseId: fixture.warehouse.id,
        locationId: fixture.targetLocation.id,
        stockState: 'ON_HAND',
        qty: 1,
      });
      const stockBefore = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, fixture.sku.id),
            eq(wmsTables.stockLedgers.warehouseId, fixture.warehouse.id),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        )
        .orderBy(wmsTables.stockLedgers.locationId);
      const eventsBefore = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.skuId, fixture.sku.id));
      const outboxBefore = await releaseOutboxCardinality(tx);

      await expectConflictCode(
        tx.transaction((savepoint) =>
          services.inventory.moveInternal(
            {
              skuId: fixture.sku.id,
              warehouseId: fixture.warehouse.id,
              fromLocationId: fixture.sourceLocation.id,
              toLocationId: fixture.targetLocation.id,
              quantity: 1,
              idempotencyKey: `controlled-move-${randomUUID()}`,
              reason: 'must not bypass batch custody',
            },
            savepoint as unknown as DbTx,
          ),
        ),
        'BATCH_CONTROLLED_STOCK',
      );
      await expectConflictCode(
        tx.transaction((savepoint) =>
          services.inventory.transferShip(
            {
              skuId: fixture.sku.id,
              fromWarehouseId: fixture.warehouse.id,
              fromLocationId: fixture.sourceLocation.id,
              quantity: 1,
              idempotencyKey: `controlled-transfer-${randomUUID()}`,
              reason: 'must not bypass batch custody through transfer',
            },
            savepoint as unknown as DbTx,
          ),
        ),
        'BATCH_CONTROLLED_STOCK',
      );

      const stockAfter = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, fixture.sku.id),
            eq(wmsTables.stockLedgers.warehouseId, fixture.warehouse.id),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        )
        .orderBy(wmsTables.stockLedgers.locationId);
      const eventsAfter = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.skuId, fixture.sku.id));
      const outboxAfter = await releaseOutboxCardinality(tx);
      const balances = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      const confirmedReservations = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );

      expect(stockAfter).toEqual(stockBefore);
      expect(eventsAfter).toEqual(eventsBefore);
      expect(outboxAfter).toEqual(outboxBefore);
      expect(balances).toEqual([
        expect.objectContaining({
          skuId: fixture.sku.id,
          sourceLocationId: fixture.sourceLocation.id,
          custodyType: 'AT_SOURCE',
          qty: fixture.quantity,
        }),
      ]);
      expect(item).toMatchObject({
        qty: fixture.quantity,
        shippedQty: 0,
        canceledQty: 0,
        reservedQty: fixture.quantity,
      });
      expect(line).toMatchObject({ qty: fixture.quantity, reservedQty: fixture.quantity });
      expect(confirmedReservations).toEqual([
        expect.objectContaining({
          targetType: 'SHIPMENT_LINE',
          targetId: fixture.line.id,
          shipmentLineId: fixture.line.id,
          skuId: fixture.sku.id,
          warehouseId: fixture.warehouse.id,
          quantity: fixture.quantity,
          status: 'confirmed',
        }),
      ]);
      const onHand = stockAfter.reduce((sum, row) => sum + row.qty, 0);
      const reserved = confirmedReservations.reduce((sum, row) => sum + row.quantity, 0);
      expect({ onHand, reserved, available: onHand - reserved }).toEqual({
        onHand: fixture.quantity + 1,
        reserved: fixture.quantity,
        available: 1,
      });
      await new FulfillmentInvariantService().assertFulfillmentOrders([fixture.fulfillmentOrder.id], tx);
      await expectSessionConservation(tx, session.id);
    });
  });

  it('17 rolls an appended event back, rebuilds custody from events, then dispatches and replays exactly once', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedReadyPlan(tx);
      const services = serviceSet(db);
      const worker = { id: actorId, roles: ['warehouse_worker'] };
      const claimed = await services.batches.claimPicker(
        fixture.workItem.id,
        { expectedLeaseVersion: 0 },
        `recovery-claim-${randomUUID()}`,
        worker,
        tx,
      );
      expect(claimed.workItem).toMatchObject({ status: 'picking', pickerId: actorId, leaseVersion: 1 });
      const session = await services.sessions.startSession(fixture.batch.id, fixture.plan.id, tx);
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `recovery-to-packing-${randomUUID()}`,
          actorId,
          quantity: fixture.quantity,
          from: {
            skuId: fixture.sku.id,
            sourceLocationId: fixture.sourceLocation.id,
            custodyType: 'AT_SOURCE',
          },
          to: {
            skuId: fixture.sku.id,
            sourceLocationId: fixture.sourceLocation.id,
            custodyType: 'WORKER',
            custodyRef: actorId,
            shipmentLineId: fixture.line.id,
          },
        },
        tx,
      );

      const crashing = serviceSet(db, {
        afterEventAppended: () => {
          throw new Error('simulated crash after event append');
        },
      });
      const crashKey = `recovery-crash-${randomUUID()}`;
      await expect(
        tx.transaction((savepoint) =>
          crashing.sessions.moveCustody(
            {
              sessionId: session.id,
              idempotencyKey: crashKey,
              actorId,
              quantity: 1,
              from: {
                skuId: fixture.sku.id,
                sourceLocationId: fixture.sourceLocation.id,
                custodyType: 'WORKER',
                custodyRef: actorId,
                shipmentLineId: fixture.line.id,
              },
              to: {
                skuId: fixture.sku.id,
                sourceLocationId: fixture.sourceLocation.id,
                custodyType: 'PACKED',
                custodyRef: `work-item:${fixture.workItem.id}`,
                shipmentLineId: fixture.line.id,
              },
            },
            savepoint as unknown as DbTx,
          ),
        ),
      ).rejects.toThrow('simulated crash after event append');

      const crashEvents = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, session.id),
            eq(wmsTables.batchInventorySessionEvents.idempotencyKey, crashKey),
          ),
        );
      const [workerAfterCrash] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'WORKER'),
          ),
        );
      expect(crashEvents).toHaveLength(0);
      expect(workerAfterCrash.qty).toBe(fixture.quantity);
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({
        healthy: true,
        recoveryRequired: false,
      });

      // Projection corruption is test-only fault injection. Events remain the
      // immutable source of truth and every asserted transition uses services.
      await tx
        .update(wmsTables.batchInventorySessionBalances)
        .set({ qty: 1 })
        .where(eq(wmsTables.batchInventorySessionBalances.id, workerAfterCrash.id));
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({
        healthy: false,
        recoveryRequired: true,
      });
      expect(await services.recovery.rebuildFromEvents(session.id, tx)).toMatchObject({
        healthy: true,
        recoveryRequired: false,
      });
      const [workerAfterRebuild] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'WORKER'),
          ),
        );
      expect(workerAfterRebuild.qty).toBe(fixture.quantity);
      await expectSessionConservation(tx, session.id);

      const completed = await services.picking.completePick(
        {
          batchId: fixture.batch.id,
          planId: fixture.plan.id,
          sessionId: session.id,
          workItemId: fixture.workItem.id,
          shipmentId: fixture.shipment.id,
          actor: worker,
          expectedLeaseVersion: 1,
          idempotencyKey: `recovery-complete-pick-${randomUUID()}`,
        },
        tx,
      );
      expect(completed).toMatchObject({ workItemId: fixture.workItem.id, custodyType: 'PACKING' });
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `recovery-preinspected-packed-${randomUUID()}`,
          actorId,
          quantity: 1,
          from: {
            skuId: fixture.sku.id,
            sourceLocationId: fixture.sourceLocation.id,
            custodyType: 'PACKING',
            custodyRef: completed.custodyRef,
            shipmentLineId: fixture.line.id,
          },
          to: {
            skuId: fixture.sku.id,
            sourceLocationId: fixture.sourceLocation.id,
            custodyType: 'PACKED',
            custodyRef: completed.custodyRef,
            shipmentLineId: fixture.line.id,
          },
        },
        tx,
      );
      const packerClaim = await services.batches.claimPacker(
        fixture.workItem.id,
        { expectedLeaseVersion: 2 },
        `recovery-packer-claim-${randomUUID()}`,
        { id: actorId, roles: ['warehouse_worker'] },
        tx,
      );
      expect(packerClaim.workItem).toMatchObject({ status: 'packing', packerId: actorId, leaseVersion: 3 });

      const dispatch = dispatchService(tx);
      const dispatchKey = `recovery-dispatch-${randomUUID()}`;
      const input = {
        barcode: fixture.barcode,
        quantity: 1,
        actor: { id: actorId, roles: ['logistics_worker'] },
        idempotencyKey: dispatchKey,
      };
      const first = await dispatch.inspectionScan(fixture.shipment.id, input);
      const outboxAfterFirst = await tx
        .select({
          id: wmsTables.outboxEvents.id,
          topic: wmsTables.outboxEvents.topic,
          eventType: wmsTables.outboxEvents.eventType,
          aggregateType: wmsTables.outboxEvents.aggregateType,
          aggregateId: wmsTables.outboxEvents.aggregateId,
          key: wmsTables.outboxEvents.idempotencyKey,
        })
        .from(wmsTables.outboxEvents)
        .where(inArray(wmsTables.outboxEvents.aggregateId, [fixture.shipment.id, fixture.fulfillmentOrder.id]));
      const replay = await dispatch.inspectionScan(fixture.shipment.id, input);
      const attempts = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, fixture.shipment.id));
      const sources = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempts[0].id));
      const shipEvents = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, sources[0].stockEventId!));
      const outboxAfterReplay = await tx
        .select({
          id: wmsTables.outboxEvents.id,
          topic: wmsTables.outboxEvents.topic,
          eventType: wmsTables.outboxEvents.eventType,
          aggregateType: wmsTables.outboxEvents.aggregateType,
          aggregateId: wmsTables.outboxEvents.aggregateId,
          key: wmsTables.outboxEvents.idempotencyKey,
        })
        .from(wmsTables.outboxEvents)
        .where(inArray(wmsTables.outboxEvents.aggregateId, [fixture.shipment.id, fixture.fulfillmentOrder.id]));
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      const [shipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
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
            eq(wmsTables.stockLedgers.warehouseId, fixture.warehouse.id),
            eq(wmsTables.stockLedgers.locationId, fixture.sourceLocation.id),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        );
      const inventoryOutbox = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(eq(wmsTables.outboxEvents.aggregateId, sources[0].stockEventId!));

      expect(first).toMatchObject({ status: 'shipped', attemptNo: 1 });
      expect(replay).toEqual(first);
      expect(attempts).toHaveLength(1);
      expect(sources).toHaveLength(1);
      expect(shipEvents).toEqual([
        expect.objectContaining({
          transitionType: 'SHIP',
          quantity: fixture.quantity,
          journalId: attempts[0].stockJournalId,
        }),
      ]);
      expect(outboxAfterReplay).toEqual(outboxAfterFirst);
      expect(
        outboxAfterReplay
          .map((event) => `${event.topic}|${event.eventType}|${event.aggregateType}|${event.aggregateId}|${event.key}`)
          .sort(),
      ).toEqual(
        [
          `shipments.events.v1|ShipmentShipped|Shipment|${fixture.shipment.id}|${attempts[0].id}`,
          `fulfillments.events.v2|FulfillmentProgressed|FulfillmentOrder|${fixture.fulfillmentOrder.id}|${attempts[0].id}:${fixture.fulfillmentOrder.id}`,
          `fulfillments.events.v1|FulfillmentShipped|Fulfillment|${fixture.fulfillmentOrder.id}|${fixture.fulfillmentOrder.id}:fully-shipped`,
        ].sort(),
      );
      expect(inventoryOutbox).toEqual([
        expect.objectContaining({
          aggregateId: sources[0].stockEventId,
          topic: 'inventory.events.v1',
          eventType: 'StockShipped',
          aggregateType: 'Stock',
          idempotencyKey: `stock-event:${sources[0].stockEventId}`,
        }),
      ]);
      expect(shipment.status).toBe('shipped');
      expect(line).toMatchObject({ qty: fixture.quantity, inspectedQty: fixture.quantity, reservedQty: 0 });
      expect(item).toMatchObject({
        qty: fixture.quantity,
        shippedQty: fixture.quantity,
        canceledQty: 0,
        status: 'completed',
      });
      expect(item.qty).toBe(item.shippedQty + item.canceledQty);
      expect(reservation).toMatchObject({ status: 'released', stateReason: `shipment-dispatch:${attempts[0].id}` });
      expect(ledger.qty).toBe(0);
      await expectSessionConservation(tx, session.id);
    });
  });
});
