import { randomUUID } from 'crypto';
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DbService } from '@app/db';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../inventory/core/services/location.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { OutboxService as FulfillmentOutboxService } from '../outbox/outbox.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { InvoiceOrchestrator } from './invoice-orchestrator.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { ShipmentRecallService } from './shipment-recall.service';
import { ShipmentDeliveryTrackingService } from './shipment-delivery-tracking.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

type RecallFixture = {
  actorId: string;
  attempt: typeof wmsTables.dispatchAttempts.$inferSelect;
  consumedReservation: typeof wmsTables.stockReservations.$inferSelect;
  dispatchJournal: typeof wmsTables.stockJournals.$inferSelect;
  dispatchSource: typeof wmsTables.dispatchAttemptSources.$inferSelect;
  fulfillmentOrder: typeof wmsTables.fulfillmentOrders.$inferSelect;
  holder: typeof wmsTables.holders.$inferSelect;
  invoice: typeof wmsTables.invoices.$inferSelect;
  item: typeof wmsTables.fulfillmentOrderItems.$inferSelect;
  line: typeof wmsTables.shipmentLines.$inferSelect;
  operationId: string;
  profile: typeof wmsTables.deliveryProfiles.$inferSelect;
  quantity: number;
  reworkLocation: typeof wmsTables.locations.$inferSelect;
  salesOrder: typeof wmsTables.salesOrders.$inferSelect;
  shipment: typeof wmsTables.shipments.$inferSelect;
  sku: typeof wmsTables.skus.$inferSelect;
  sourceLocation: typeof wmsTables.locations.$inferSelect;
  tracking: typeof wmsTables.shipmentTracking.$inferSelect;
  warehouse: typeof wmsTables.warehouses.$inferSelect;
};

describeIfDb('ShipmentRecallService (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let dbService: DbService<typeof wmsSchema>;
  let reservations: ShipmentReservationService;
  let service: ShipmentRecallService;
  let reportService: ShipmentRecallService;
  let invoiceOrchestrator: InvoiceOrchestrator;
  const cleanupFixtures: RecallFixture[] = [];

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 6 });
    db = drizzle(client, { schema: wmsSchema });
    dbService = {
      db,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((inner) => fn(inner as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const eventStore = new StockEventStore(dbService, sellable);
    const inventory = new InventoryCommandService(
      dbService,
      eventStore,
      inventoryOutbox,
      new LocationService(dbService),
    );
    reservations = new ShipmentReservationService(
      dbService,
      new UnifiedReservationService(dbService, sellable),
      new FulfillmentProgressService(),
      new FulfillmentInvariantService(),
    );
    service = new ShipmentRecallService(
      dbService,
      {} as never,
      {} as never,
      {} as never,
      inventory,
      reservations,
      new FulfillmentOutboxService(dbService),
      new AuditService(dbService),
      {} as never,
    );
    reportService = new ShipmentRecallService(
      dbService,
      new FulfillmentCommandService(dbService),
      {} as never,
      { void: jest.fn(() => Promise.resolve({ operationId: randomUUID() })) } as never,
      inventory,
      reservations,
      new FulfillmentOutboxService(dbService),
      new AuditService(dbService),
      { assertV2MutationAllowed: jest.fn() } as never,
    );
    const provider = {
      maxRequestDurationMs: 1_000,
      capabilities: {
        issue: { safeToRepeat: true, lookupByIdempotencyKey: false },
        void: { safeToRepeat: true, lookupByServiceId: false },
      },
      issueInvoice: jest.fn(),
      cancelInvoice: jest.fn(),
      queryInvoice: jest.fn(),
    };
    invoiceOrchestrator = new InvoiceOrchestrator(
      dbService,
      new FulfillmentCommandService(dbService),
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      provider as never,
      provider as never,
      { assertV2MutationAllowed: jest.fn() } as never,
      { get: jest.fn(() => service) } as never,
    );
  });

  afterAll(async () => client.end());

  afterEach(async () => {
    for (const fixture of cleanupFixtures.splice(0).reverse()) {
      await cleanupRecallFixture(fixture);
    }
  });

  async function seedRecallPending(tx: DbTx, quantity = 3) {
    const suffix = randomUUID();
    const actorId = randomUUID();
    const operationId = randomUUID();
    const attemptId = randomUUID();
    const dispatchedAt = new Date('2026-07-15T08:00:00.000Z');
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `recall-saga-wh-${suffix}` })
      .returning();
    const [sourceLocation] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `recall-saga-source-${suffix}`, locationType: 'zone' })
      .returning();
    const [reworkLocation] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId: warehouse.id,
        code: `recall-saga-rework-${suffix}`,
        locationType: 'zone',
        isSystem: true,
        systemRole: 'outbound_rework',
        isActive: true,
      })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `recall-saga-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'Recall Saga SKU', code: `RECALL-SAGA-${suffix}`, holderId: holder.id })
      .returning();
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `recall-saga-profile-${suffix}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Recall sender' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `recall-saga-order-${suffix}`,
        salesChannel: 'medusa',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        salesOrderId: salesOrder.id,
        warehouseId: warehouse.id,
        status: 'completed',
        totalItems: 1,
        totalQty: quantity,
        totalReservedQty: 0,
        shippedAt: dispatchedAt,
      })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({
        fulfillmentOrderId: fulfillmentOrder.id,
        skuId: sku.id,
        qty: quantity,
        shippedQty: quantity,
        status: 'completed',
      })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: warehouse.id,
        openedForFulfillmentOrderId: fulfillmentOrder.id,
        status: 'recovery_required',
        recoveryCode: 'DISPATCH_RECALL_PENDING',
        recipientSnapshot: { name: 'Recall' },
        shippingProfileId: profile.id,
        manifestVersion: 4,
        reservationVersion: 2,
        shippedAt: dispatchedAt,
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: item.id,
        skuId: sku.id,
        qty: quantity,
        reservedQty: 0,
        inspectedQty: quantity,
        forced: true,
      })
      .returning();
    const [invoice] = await tx
      .insert(wmsTables.invoices)
      .values({
        trackingNo: `recall-saga-tracking-${suffix}`,
        carrier: 'CJ',
        issueMethod: 'goodsflow',
        externalServiceId: `recall-saga-service-${suffix}`,
        issuedForFulfillmentOrderId: fulfillmentOrder.id,
        shipmentId: shipment.id,
        manifestVersion: shipment.manifestVersion,
        recipientHash: 'a'.repeat(64),
        status: 'voided',
        voidedAt: new Date(),
      })
      .returning();
    const [dispatchJournal] = await tx
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
        sourceId: attemptId,
        idempotencyKey: `recall-saga-dispatch-journal-${suffix}`,
        actorId,
      })
      .returning();
    const [attempt] = await tx
      .insert(wmsTables.dispatchAttempts)
      .values({
        id: attemptId,
        shipmentId: shipment.id,
        attemptNo: 1,
        status: 'recovery_required',
        recoveryCode: 'DISPATCH_RECALL_PENDING',
        idempotencyKey: `recall-saga-attempt-${suffix}`,
        invoiceId: invoice.id,
        stockJournalId: dispatchJournal.id,
        dispatchedAt,
      })
      .returning();
    const [shipEvent] = await tx
      .insert(wmsTables.stockEvents)
      .values({
        journalId: dispatchJournal.id,
        skuId: sku.id,
        fromWarehouseId: warehouse.id,
        fromLocationId: sourceLocation.id,
        fromState: 'ON_HAND',
        transitionType: 'SHIP',
        quantity,
        occurredAt: dispatchedAt,
        idempotencyKey: `recall-saga-event-${suffix}`,
        eventStatus: 'POSTED',
      })
      .returning();
    const [dispatchSource] = await tx
      .insert(wmsTables.dispatchAttemptSources)
      .values({
        dispatchAttemptId: attempt.id,
        shipmentLineId: line.id,
        sourceLocationId: sourceLocation.id,
        qty: quantity,
        stockEventId: shipEvent.id,
      })
      .returning();
    const [tracking] = await tx
      .insert(wmsTables.shipmentTracking)
      .values({
        shipmentId: shipment.id,
        dispatchAttemptId: attempt.id,
        providerEventId: `recall-saga-tracking-event-${suffix}`,
        status: 'shipped',
        timestamp: dispatchedAt,
      })
      .returning();
    const intent = {
      kind: 'shipment_recall',
      operationId,
      shipmentId: shipment.id,
      dispatchAttemptId: attempt.id,
      attemptNo: attempt.attemptNo,
      invoiceId: invoice.id,
      expectedManifestVersion: shipment.manifestVersion,
      physicalRecoveryConfirmed: true,
      reason: 'package_recovered',
      actorId,
    };
    await tx.insert(wmsTables.shipmentOperations).values({
      id: operationId,
      type: 'recall',
      status: 'pending',
      operatorId: actorId,
      reason: 'package_recovered',
      idempotencyKey: `recall-saga-operation-${suffix}`,
      requestHash: 'b'.repeat(64),
      beforeManifestSnapshot: { intent },
    });
    await tx.insert(wmsTables.shipmentOperationMembers).values({
      operationId,
      shipmentId: shipment.id,
      role: 'source',
      beforeManifestVersion: shipment.manifestVersion,
      beforeManifestSnapshot: { intent },
    });
    const [consumedReservation] = await tx
      .insert(wmsTables.stockReservations)
      .values({
        targetType: 'SHIPMENT_LINE',
        targetId: line.id,
        shipmentLineId: line.id,
        skuId: sku.id,
        warehouseId: warehouse.id,
        quantity,
        status: 'released',
        requestedAt: new Date('2026-07-14T01:00:00.000Z'),
        stateReason: `shipment-dispatch:${attempt.id}`,
        invalidatedAt: dispatchedAt,
      })
      .returning();
    const fixture = {
      actorId,
      attempt,
      consumedReservation,
      dispatchJournal,
      dispatchSource,
      fulfillmentOrder,
      holder,
      invoice,
      item,
      line,
      operationId,
      profile,
      quantity,
      reworkLocation,
      shipment,
      sku,
      sourceLocation,
      salesOrder,
      tracking,
      warehouse,
    };
    cleanupFixtures.push(fixture);
    return fixture;
  }

  async function cleanupRecallFixture(fixture: RecallFixture): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(wmsTables.auditLogs).where(eq(wmsTables.auditLogs.userId, fixture.actorId));
      await tx
        .delete(wmsTables.outboxEvents)
        .where(
          inArray(wmsTables.outboxEvents.aggregateId, [
            fixture.operationId,
            fixture.shipment.id,
            fixture.fulfillmentOrder.id,
            fixture.sku.id,
          ]),
        );
      await tx
        .delete(wmsTables.invoiceOperations)
        .where(eq(wmsTables.invoiceOperations.shipmentId, fixture.shipment.id));
      await tx
        .delete(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.operationId, fixture.operationId));
      await tx
        .delete(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, fixture.operationId));
      await tx.delete(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, fixture.operationId));
      await tx.delete(wmsTables.shipmentTracking).where(eq(wmsTables.shipmentTracking.shipmentId, fixture.shipment.id));
      await tx
        .delete(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, fixture.attempt.id));
      await tx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));

      const journalIds = (
        await tx
          .select({ id: wmsTables.stockJournals.id })
          .from(wmsTables.stockJournals)
          .where(inArray(wmsTables.stockJournals.sourceId, [fixture.attempt.id, fixture.operationId]))
      ).map((row) => row.id);
      if (!journalIds.includes(fixture.dispatchJournal.id)) journalIds.push(fixture.dispatchJournal.id);

      await tx.delete(wmsTables.dispatchAttempts).where(eq(wmsTables.dispatchAttempts.id, fixture.attempt.id));
      await tx.delete(wmsTables.invoices).where(eq(wmsTables.invoices.id, fixture.invoice.id));
      await tx.delete(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, fixture.sku.id));
      await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, fixture.sku.id));
      if (journalIds.length > 0) {
        await tx.delete(wmsTables.stockJournals).where(inArray(wmsTables.stockJournals.id, journalIds));
      }
      await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, fixture.shipment.id));
      await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      await tx
        .delete(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fixture.fulfillmentOrder.id));
      await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, fixture.salesOrder.id));
      await tx.delete(wmsTables.deliveryProfiles).where(eq(wmsTables.deliveryProfiles.id, fixture.profile.id));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, fixture.warehouse.id));
      await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.sku.id));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holder.id));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
    });
  }

  it('atomically reverses stock, clones the consumed reservation and reopens demand without erasing history', async () => {
    const fixture = await db.transaction((tx) => seedRecallPending(tx as unknown as DbTx));

    const responses = await Promise.all([
      service.resumePending(fixture.operationId),
      service.resumePending(fixture.operationId),
    ]);
    expect(responses.every((response) => response.operationStatus === 'completed')).toBe(true);

    const [shipment] = await db
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, fixture.shipment.id));
    const [attempt] = await db
      .select()
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, fixture.attempt.id));
    const [line] = await db
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
    const [item] = await db
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
    const [fo] = await db
      .select()
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.id, fixture.fulfillmentOrder.id));
    expect(shipment).toMatchObject({ status: 'draft', recoveryCode: null, manifestVersion: 5, shippedAt: null });
    expect(attempt).toMatchObject({ status: 'recalled', recoveryCode: null });
    expect(attempt.reversalJournalId).not.toBeNull();
    expect(line).toMatchObject({ reservedQty: fixture.quantity, inspectedQty: 0, forced: false });
    expect(item.shippedQty).toBe(0);
    expect(fo).toMatchObject({ status: 'ready', shippedAt: null, totalReservedQty: fixture.quantity });

    const reservations = await db
      .select()
      .from(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
    expect(reservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.consumedReservation.id,
          status: 'released',
          stateReason: `shipment-dispatch:${fixture.attempt.id}`,
        }),
        expect.objectContaining({
          status: 'confirmed',
          stateReason: `shipment-recall:${fixture.operationId}`,
          requestedAt: fixture.consumedReservation.requestedAt,
        }),
      ]),
    );
    const [availability] = await db
      .select({
        qty: drizzleSql<number>`
          coalesce((select sum(qty) from stock_ledgers where sku_id = ${fixture.sku.id} and warehouse_id = ${fixture.warehouse.id} and stock_state = 'ON_HAND'), 0)
          - coalesce((select sum(quantity) from stock_reservations where sku_id = ${fixture.sku.id} and warehouse_id = ${fixture.warehouse.id} and status = 'confirmed'), 0)
        `,
      })
      .from(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
    expect(Number(availability.qty)).toBe(0);
    const events = await db
      .select({ eventType: wmsTables.outboxEvents.eventType })
      .from(wmsTables.outboxEvents)
      .where(eq(wmsTables.outboxEvents.aggregateId, fixture.shipment.id));
    expect(events).toEqual(expect.arrayContaining([{ eventType: 'ShipmentDispatchRecalled' }]));
    const fulfillmentEvents = await db
      .select({ eventType: wmsTables.outboxEvents.eventType })
      .from(wmsTables.outboxEvents)
      .where(eq(wmsTables.outboxEvents.aggregateId, fixture.fulfillmentOrder.id));
    expect(fulfillmentEvents).toEqual(expect.arrayContaining([{ eventType: 'FulfillmentReopened' }]));
    const [oldSource] = await db
      .select()
      .from(wmsTables.dispatchAttemptSources)
      .where(eq(wmsTables.dispatchAttemptSources.id, fixture.dispatchSource.id));
    const [oldTracking] = await db
      .select()
      .from(wmsTables.shipmentTracking)
      .where(eq(wmsTables.shipmentTracking.id, fixture.tracking.id));
    expect(oldSource).toMatchObject({
      dispatchAttemptId: fixture.attempt.id,
      shipmentLineId: fixture.line.id,
      sourceLocationId: fixture.dispatchSource.sourceLocationId,
      qty: fixture.quantity,
      stockEventId: fixture.dispatchSource.stockEventId,
    });
    expect(oldTracking).toMatchObject({
      dispatchAttemptId: fixture.attempt.id,
      providerEventId: fixture.tracking.providerEventId,
      status: 'shipped',
    });
  });

  it.each([
    ['carrier accepted', 'accepted'],
    ['in-transit evidence', 'in_transit'],
    ['delivered evidence', 'delivered'],
  ] as const)('rejects recall when the exact attempt has %s', async (_label, evidence) => {
    const fixture = await db.transaction((tx) => seedRecallPending(tx as unknown as DbTx));
    await db
      .update(wmsTables.shipments)
      .set({ status: 'shipped', recoveryCode: null })
      .where(eq(wmsTables.shipments.id, fixture.shipment.id));
    await db
      .update(wmsTables.dispatchAttempts)
      .set({
        status: 'dispatched',
        recoveryCode: null,
        ...(evidence === 'accepted' ? { carrierAcceptedAt: new Date('2026-07-15T08:30:00.000Z') } : {}),
      })
      .where(eq(wmsTables.dispatchAttempts.id, fixture.attempt.id));
    await db
      .update(wmsTables.invoices)
      .set({ status: 'used', voidedAt: null })
      .where(eq(wmsTables.invoices.id, fixture.invoice.id));
    if (evidence !== 'accepted') {
      await db.insert(wmsTables.shipmentTracking).values({
        shipmentId: fixture.shipment.id,
        dispatchAttemptId: fixture.attempt.id,
        providerEventId: `${evidence}-${randomUUID()}`,
        status: evidence,
        timestamp: new Date('2026-07-15T08:30:00.000Z'),
      });
    }

    await expect(
      reportService.report(
        fixture.shipment.id,
        fixture.attempt.id,
        {
          dispatchAttemptId: fixture.attempt.id,
          expectedManifestVersion: fixture.shipment.manifestVersion,
          physicalRecoveryConfirmed: true,
          reason: 'package_recovered',
        },
        `recall-rejected-${evidence}-${randomUUID()}`,
        { id: fixture.actorId, roles: ['master'] },
      ),
    ).rejects.toThrow(/Carrier|carrier|transit|delivered/);
    const reversals = await db
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.reversalOfEventId, fixture.dispatchSource.stockEventId!));
    expect(reversals).toHaveLength(0);
    const [item] = await db
      .select({ shippedQty: wmsTables.fulfillmentOrderItems.shippedQty })
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
    expect(item.shippedQty).toBe(fixture.quantity);
  });

  it('keeps provider void failure on the same operation without reversing stock or reopening FO demand', async () => {
    const fixture = await db.transaction((tx) => seedRecallPending(tx as unknown as DbTx));

    await db.transaction((tx) =>
      service.markInvoiceRecoveryRequired(
        fixture.operationId,
        new Error('provider void timeout'),
        tx as unknown as DbTx,
      ),
    );

    const [operation] = await db
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, fixture.operationId));
    const [item] = await db
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
    const reversals = await db
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.reversalOfEventId, fixture.dispatchSource.stockEventId!));
    const reservations = await db
      .select()
      .from(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
    expect(operation).toMatchObject({ status: 'recovery_required', lastError: 'provider void timeout' });
    expect(item.shippedQty).toBe(fixture.quantity);
    expect(reversals).toHaveLength(0);
    expect(reservations).toEqual([
      expect.objectContaining({
        id: fixture.consumedReservation.id,
        status: 'released',
        stateReason: `shipment-dispatch:${fixture.attempt.id}`,
      }),
    ]);
  });

  it('blocks invoice resume when carrier progress arrives after report quarantine', async () => {
    const fixture = await db.transaction((tx) => seedRecallPending(tx as unknown as DbTx));
    await db.transaction(async (tx) => {
      await tx
        .delete(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, fixture.operationId));
      await tx.delete(wmsTables.shipmentOperations).where(eq(wmsTables.shipmentOperations.id, fixture.operationId));
      await tx
        .update(wmsTables.shipments)
        .set({ status: 'shipped', recoveryCode: null })
        .where(eq(wmsTables.shipments.id, fixture.shipment.id));
      await tx
        .update(wmsTables.dispatchAttempts)
        .set({ status: 'dispatched', recoveryCode: null })
        .where(eq(wmsTables.dispatchAttempts.id, fixture.attempt.id));
      await tx
        .update(wmsTables.invoices)
        .set({ status: 'used', voidedAt: null })
        .where(eq(wmsTables.invoices.id, fixture.invoice.id));
    });

    const carrierEventId = `recall-late-carrier-progress-${randomUUID()}`;
    let announceTrackingBeforeGraph!: () => void;
    const trackingBeforeGraph = new Promise<void>((resolve) => {
      announceTrackingBeforeGraph = resolve;
    });
    let allowTrackingGraph!: () => void;
    const trackingGraphAllowed = new Promise<void>((resolve) => {
      allowTrackingGraph = resolve;
    });
    let firstGraphEntry = true;
    const barrierTrackingService = new ShipmentDeliveryTrackingService(
      dbService,
      new FulfillmentOutboxService(dbService),
      { assertV2MutationAllowed: jest.fn() } as never,
      {
        lockShipmentGraphForDispatch: async (shipmentId: string, tx: DbTx) => {
          if (firstGraphEntry) {
            firstGraphEntry = false;
            announceTrackingBeforeGraph();
            await trackingGraphAllowed;
          }
          await reservations.lockShipmentGraphForDispatch(shipmentId, tx);
        },
      } as ShipmentReservationService,
    );
    const trackingPromise = barrierTrackingService.recordProviderEvent(fixture.attempt.id, {
      providerEventId: carrierEventId,
      status: 'in_transit',
      occurredAt: '2026-07-15T09:00:00.000Z',
    });
    await trackingBeforeGraph;

    let reported: Awaited<ReturnType<ShipmentRecallService['report']>>;
    try {
      reported = await reportService.report(
        fixture.shipment.id,
        fixture.attempt.id,
        {
          dispatchAttemptId: fixture.attempt.id,
          expectedManifestVersion: fixture.shipment.manifestVersion,
          physicalRecoveryConfirmed: true,
          reason: 'package_recovered',
        },
        `recall-late-carrier-${randomUUID()}`,
        { id: fixture.actorId, roles: ['master'] },
      );
      fixture.operationId = reported.operationId;
    } finally {
      allowTrackingGraph();
    }
    await trackingPromise;

    await db
      .update(wmsTables.invoices)
      .set({ status: 'voiding', voidedAt: null })
      .where(eq(wmsTables.invoices.id, fixture.invoice.id));
    const invoiceOperationId = randomUUID();
    await db.insert(wmsTables.invoiceOperations).values({
      id: invoiceOperationId,
      shipmentId: fixture.shipment.id,
      invoiceId: fixture.invoice.id,
      resumeOperationId: reported.operationId,
      operation: 'void',
      idempotencyKey: `worker-recall-late-carrier-${randomUUID()}`,
      requestHash: 'd'.repeat(64),
      manifestVersion: fixture.shipment.manifestVersion,
      recipientHash: 'a'.repeat(64),
      status: 'in_progress',
      providerRequest: {
        kind: 'void',
        provider: 'goodsflow',
        externalServiceId: fixture.invoice.externalServiceId,
        operationContext: { operationId: invoiceOperationId, idempotencyKey: invoiceOperationId },
        commandContext: {
          actorId: fixture.actorId,
          reason: 'package_recovered',
          csCaseId: null,
          note: null,
        },
      },
      providerResponse: {},
      attempts: 1,
    });

    await expect(
      (
        invoiceOrchestrator as unknown as {
          finalizeProviderSuccess(operationId: string): Promise<void>;
        }
      ).finalizeProviderSuccess(invoiceOperationId),
    ).rejects.toThrow(/Carrier|carrier/);

    const [operation] = await db
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, reported.operationId));
    const [attempt] = await db
      .select()
      .from(wmsTables.dispatchAttempts)
      .where(eq(wmsTables.dispatchAttempts.id, fixture.attempt.id));
    const [shipment] = await db
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, fixture.shipment.id));
    const tracking = await db
      .select()
      .from(wmsTables.shipmentTracking)
      .where(eq(wmsTables.shipmentTracking.providerEventId, carrierEventId));
    const reversals = await db
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.reversalOfEventId, fixture.dispatchSource.stockEventId!));
    expect(operation).toMatchObject({ status: 'recovery_required' });
    expect(operation.lastError).toContain('Carrier in_transit evidence');
    expect(attempt).toMatchObject({
      status: 'recovery_required',
      recoveryCode: 'DISPATCH_RECALL_PENDING',
      carrierAcceptedAt: new Date('2026-07-15T09:00:00.000Z'),
    });
    expect(shipment).toMatchObject({ status: 'recovery_required', recoveryCode: 'DISPATCH_RECALL_PENDING' });
    expect(tracking).toEqual([
      expect.objectContaining({
        dispatchAttemptId: fixture.attempt.id,
        status: 'in_transit',
        providerEventId: carrierEventId,
      }),
    ]);
    expect(reversals).toHaveLength(0);
  });

  it('finalizes the provider void and resumes the same recall operation through the invoice worker boundary', async () => {
    const fixture = await db.transaction((tx) => seedRecallPending(tx as unknown as DbTx));
    await db
      .update(wmsTables.invoices)
      .set({ status: 'voiding', voidedAt: null })
      .where(eq(wmsTables.invoices.id, fixture.invoice.id));
    const invoiceOperationId = randomUUID();
    await db.insert(wmsTables.invoiceOperations).values({
      id: invoiceOperationId,
      shipmentId: fixture.shipment.id,
      invoiceId: fixture.invoice.id,
      resumeOperationId: fixture.operationId,
      operation: 'void',
      idempotencyKey: `worker-recall-${randomUUID()}`,
      requestHash: 'c'.repeat(64),
      manifestVersion: fixture.shipment.manifestVersion,
      recipientHash: 'a'.repeat(64),
      status: 'in_progress',
      providerRequest: {
        kind: 'void',
        provider: 'goodsflow',
        externalServiceId: fixture.invoice.externalServiceId,
        operationContext: { operationId: invoiceOperationId, idempotencyKey: invoiceOperationId },
        commandContext: {
          actorId: fixture.actorId,
          reason: 'package_recovered',
          csCaseId: null,
          note: null,
        },
      },
      providerResponse: {},
      attempts: 1,
    });

    await (
      invoiceOrchestrator as unknown as {
        finalizeProviderSuccess(operationId: string): Promise<void>;
      }
    ).finalizeProviderSuccess(invoiceOperationId);

    const [operation] = await db
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, fixture.operationId));
    const [invoiceOperation] = await db
      .select()
      .from(wmsTables.invoiceOperations)
      .where(eq(wmsTables.invoiceOperations.id, invoiceOperationId));
    const [shipment] = await db
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, fixture.shipment.id));
    expect(operation.status).toBe('completed');
    expect(invoiceOperation.status).toBe('succeeded');
    expect(shipment.status).toBe('draft');
  });
});
