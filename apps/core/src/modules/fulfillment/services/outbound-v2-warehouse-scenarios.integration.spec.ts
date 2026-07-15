import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../inventory/core/services/location.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { OutboxService as FulfillmentOutboxService } from '../outbox/outbox.service';
import { AggregateThenSortPickingStrategy } from '../picking/aggregate-then-sort.strategy';
import { DiscretePickingStrategy } from '../picking/discrete-picking.strategy';
import { PickToTotePickingStrategy } from '../picking/pick-to-tote.strategy';
import { PickingStrategyRegistry } from '../picking/picking-strategy.registry';
import { inRollbackTx, makeDb, seedHolder, seedSku, seedWarehouseWithZone } from './__support__';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { canonicalShipmentRecipientHash, InvoiceOrchestrator } from './invoice-orchestrator.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { PickingProcessService } from './picking-process.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { ShipmentShortPickService } from './shipment-short-pick.service';
import { ToteLifecycleService } from './tote-lifecycle.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const RECIPIENT = {
  recipientName: 'Outbound V2 Warehouse',
  phone: '010-1111-2222',
  postalCode: '01234',
  roadAddress: 'Seoul release road 1',
  detailAddress: '101',
};

type Database = PostgresJsDatabase<typeof wmsSchema>;
type Actor = { id: string; roles: string[] };

interface SeededShipment {
  variantId: string;
  shipment: typeof wmsTables.shipments.$inferSelect;
  line: typeof wmsTables.shipmentLines.$inferSelect;
  item: typeof wmsTables.fulfillmentOrderItems.$inferSelect;
  fulfillmentOrder: typeof wmsTables.fulfillmentOrders.$inferSelect;
  reservation: typeof wmsTables.stockReservations.$inferSelect;
}

interface WarehouseWorld {
  warehouseId: string;
  locationId: string;
  skuId: string;
  barcode: string;
  profileId: string;
  ledgerVersion: number;
  stockQty: number;
  shipments: SeededShipment[];
}

describeIfDb('Outbound V2 warehouse release scenarios 06-10', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  function ambientDbService(tx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (trx: DbTx) => Promise<T>, explicit?: DbTx): Promise<T> => {
        if (explicit) return fn(explicit);
        return (tx as unknown as { transaction<R>(callback: (nested: unknown) => Promise<R>): Promise<R> }).transaction(
          (nested) => fn(nested as DbTx),
        );
      },
    } as unknown as DbService<typeof wmsSchema>;
  }

  function deliveryProvider() {
    return {
      maxRequestDurationMs: 1_000,
      capabilities: {
        issue: { safeToRepeat: true, lookupByIdempotencyKey: false },
        void: { safeToRepeat: false, lookupByServiceId: true },
      },
      issueInvoice: jest.fn().mockResolvedValue({
        serviceId: `service-${randomUUID()}`,
        invoiceNumber: `tracking-${randomUUID()}`,
        carrierCode: 'CJ',
      }),
      cancelInvoice: jest.fn().mockResolvedValue(undefined),
      queryInvoice: jest.fn().mockResolvedValue({ status: 'not_found' }),
    };
  }

  function makeServices(tx: DbTx, provider = deliveryProvider()) {
    const dbService = ambientDbService(tx);
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const audit = new AuditService(dbService);
    const workflow = new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
    );
    const controlled = new BatchControlledStockGuard();
    const sessions = new BatchInventorySessionService(dbService, controlled, audit);
    const resumeTarget: { shortPick?: ShipmentShortPickService } = {};
    const moduleRef = {
      get: jest.fn(
        () => resumeTarget.shortPick ?? ({ resumePending: jest.fn().mockResolvedValue(undefined) } as never),
      ),
    };
    const invoices = new InvoiceOrchestrator(
      dbService,
      commands,
      invariant,
      audit,
      provider as never,
      provider as never,
      workflow,
      moduleRef as never,
    );
    const batches = new OutboundBatchOrchestrator(
      dbService,
      commands,
      invariant,
      invoices,
      audit,
      workflow,
      moduleRef as never,
    );
    const aggregate = new AggregateThenSortPickingStrategy(
      dbService,
      commands,
      workflow,
      invariant,
      sessions,
      controlled,
      invoices,
      batches,
    );
    const discrete = new DiscretePickingStrategy(
      dbService,
      commands,
      workflow,
      invariant,
      sessions,
      controlled,
      invoices,
      batches,
    );
    const tote = new PickToTotePickingStrategy(
      dbService,
      commands,
      workflow,
      invariant,
      sessions,
      controlled,
      invoices,
      batches,
      audit,
    );
    const registry = new PickingStrategyRegistry(dbService, [discrete, aggregate, tote]);
    const picking = new PickingProcessService(dbService, new BarcodeService(dbService), workflow, registry);

    const inventoryOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
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
      invariant,
    );
    const authorization = { getScopesByRoles: jest.fn().mockResolvedValue(new Set(['master'])) };
    const planning = new ShipmentPlanningService(
      dbService,
      commands,
      shipmentReservations,
      invariant,
      audit,
      authorization as never,
      workflow,
    );
    resumeTarget.shortPick = new ShipmentShortPickService(
      dbService,
      commands,
      authorization as never,
      audit,
      workflow,
      invoices,
      sessions,
      shipmentReservations,
      planning,
      new ToteLifecycleService(dbService),
    );
    const dispatch = new ShipmentDispatchService(
      dbService,
      commands,
      inventory,
      sessions,
      shipmentReservations,
      invoices,
      new BarcodeService(dbService),
      new FulfillmentOutboxService(dbService),
      audit,
      workflow,
    );
    return { batches, dispatch, invoices, picking, sessions, shortPick: resumeTarget.shortPick, provider };
  }

  async function seedWorld(
    tx: DbTx,
    quantities: number[],
    strategies: Array<'discrete' | 'aggregate_then_sort' | 'pick_to_tote'> = [
      'discrete',
      'aggregate_then_sort',
      'pick_to_tote',
    ],
  ) {
    const suffix = randomUUID();
    const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
    await tx
      .update(wmsTables.warehouses)
      .set({ supportedPickingStrategies: strategies })
      .where(eq(wmsTables.warehouses.id, warehouseId));
    const { holderId } = await seedHolder(tx);
    const { skuId } = await seedSku(tx, holderId);
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `release-profile-${suffix}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Release Sender', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        carrierAccountRef: 'goodsflow-center',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, skuId));
    const barcode = `880${suffix.replaceAll('-', '').slice(0, 10)}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId, barcode, isPrimary: true });
    const total = quantities.reduce((sum, quantity) => sum + quantity, 0);
    const [ledger] = await tx
      .insert(wmsTables.stockLedgers)
      .values({ skuId, warehouseId, locationId, stockState: 'ON_HAND', qty: total })
      .returning();
    const shipments: SeededShipment[] = [];
    for (const [index, quantity] of quantities.entries()) {
      const [salesOrder] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: `release-${index}-${suffix}`,
          salesChannel: 'medusa',
          status: 'confirmed',
          shippingAddress: RECIPIENT,
          orderDate: new Date(),
        })
        .returning();
      const variantId = randomUUID();
      const [salesLine] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: salesOrder.id,
          variantId,
          productName: `Release product ${index}`,
          quantity,
          channelOrderItemId: `release-item-${index}-${suffix}`,
          channelProductId: `release-product-${index}-${suffix}`,
        })
        .returning();
      const [fulfillmentOrder] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: salesOrder.id,
          warehouseId,
          ownerId: holderId,
          status: 'processing',
          fulfillmentMode: 'in_house',
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
          salesOrderLineId: salesLine.id,
          skuId,
          qty: quantity,
          reservedQty: quantity,
          status: 'processing',
        })
        .returning();
      const [shipment] = await tx
        .insert(wmsTables.shipments)
        .values({
          warehouseId,
          openedForFulfillmentOrderId: fulfillmentOrder.id,
          status: 'planned',
          shippingProfileId: profile.id,
          recipientSnapshot: RECIPIENT,
          plannedAt: new Date(),
        })
        .returning();
      const [line] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: shipment.id,
          fulfillmentOrderItemId: item.id,
          skuId,
          qty: quantity,
          reservedQty: quantity,
        })
        .returning();
      const [reservation] = await tx
        .insert(wmsTables.stockReservations)
        .values({
          targetType: 'SHIPMENT_LINE',
          targetId: line.id,
          fulfillmentOrderItemId: item.id,
          shipmentLineId: line.id,
          skuId,
          warehouseId,
          quantity,
          status: 'confirmed',
          requestedAt: new Date(),
        })
        .returning();
      shipments.push({ variantId, shipment, line, item, fulfillmentOrder, reservation });
    }
    return {
      warehouseId,
      locationId,
      skuId,
      barcode,
      profileId: profile.id,
      ledgerVersion: ledger.version,
      stockQty: total,
      shipments,
    } satisfies WarehouseWorld;
  }

  async function seedIssuedInvoices(tx: DbTx, world: WarehouseWorld) {
    for (const member of world.shipments) {
      await tx.insert(wmsTables.invoices).values({
        trackingNo: `release-tracking-${randomUUID()}`,
        carrier: 'CJ',
        issueMethod: 'goodsflow',
        externalServiceId: `release-service-${randomUUID()}`,
        issuedForFulfillmentOrderId: member.fulfillmentOrder.id,
        shipmentId: member.shipment.id,
        manifestVersion: member.shipment.manifestVersion,
        recipientHash: canonicalShipmentRecipientHash(RECIPIENT),
        status: 'issued',
      });
    }
  }

  async function createBatchWithShipments(
    services: ReturnType<typeof makeServices>,
    world: WarehouseWorld,
    actor: Actor,
    pickingMethod: 'individual' | 'total_picking' = 'individual',
  ) {
    const batch = await services.batches.createBatch(
      { warehouseId: world.warehouseId, pickingMethod, name: `Release batch ${randomUUID()}` },
      `release-batch-${randomUUID()}`,
      actor,
    );
    const added: Array<Awaited<ReturnType<OutboundBatchOrchestrator['addShipment']>>> = [];
    for (const member of world.shipments) {
      added.push(
        await services.batches.addShipment(batch.batchId, member.shipment.id, `release-add-${randomUUID()}`, actor),
      );
    }
    return { batch, added };
  }

  async function expectCoreCheckpoint(
    tx: DbTx,
    world: WarehouseWorld,
    expected: { onHandQty: number; reservedQty: number; availableQty: number } = {
      onHandQty: world.stockQty,
      reservedQty: world.stockQty,
      availableQty: 0,
    },
  ) {
    await new FulfillmentInvariantService().assertFulfillmentOrders(
      world.shipments.map((member) => member.fulfillmentOrder.id),
      tx,
    );
    const foi = await tx
      .select({ qty: wmsTables.fulfillmentOrderItems.qty, reservedQty: wmsTables.fulfillmentOrderItems.reservedQty })
      .from(wmsTables.fulfillmentOrderItems)
      .where(
        inArray(
          wmsTables.fulfillmentOrderItems.id,
          world.shipments.map((member) => member.item.id),
        ),
      );
    const reservations = await tx
      .select({ quantity: wmsTables.stockReservations.quantity, status: wmsTables.stockReservations.status })
      .from(wmsTables.stockReservations)
      .where(
        inArray(
          wmsTables.stockReservations.shipmentLineId,
          world.shipments.map((member) => member.line.id),
        ),
      );
    const [ledger] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, world.skuId),
          eq(wmsTables.stockLedgers.warehouseId, world.warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    expect(foi.reduce((sum, item) => sum + item.qty, 0)).toBe(
      world.shipments.reduce((sum, member) => sum + member.line.qty, 0),
    );
    expect(reservations.filter((row) => row.status === 'confirmed').reduce((sum, row) => sum + row.quantity, 0)).toBe(
      foi.reduce((sum, item) => sum + item.reservedQty, 0),
    );
    const reservedQty = reservations
      .filter((row) => row.status === 'confirmed')
      .reduce((sum, row) => sum + row.quantity, 0);
    expect(ledger.qty).toBe(expected.onHandQty);
    expect(reservedQty).toBe(expected.reservedQty);
    expect(ledger.qty - reservedQty).toBe(expected.availableQty);
  }

  async function expectArtifactCardinality(
    tx: DbTx,
    world: WarehouseWorld,
    expected: {
      attempts?: number;
      sources?: number;
      shipStockEvents?: number;
      shipmentOutbox?: number;
      fulfillmentV2Outbox?: number;
      fulfillmentV1Outbox?: number;
      inventoryOutbox?: number;
      fullyShippedFulfillmentOrderIds?: string[];
    } = {},
  ) {
    const shipmentIds = world.shipments.map((member) => member.shipment.id);
    const attempts = await tx
      .select({ id: wmsTables.dispatchAttempts.id, shipmentId: wmsTables.dispatchAttempts.shipmentId })
      .from(wmsTables.dispatchAttempts)
      .where(inArray(wmsTables.dispatchAttempts.shipmentId, shipmentIds));
    const sources = attempts.length
      ? await tx
          .select({ stockEventId: wmsTables.dispatchAttemptSources.stockEventId })
          .from(wmsTables.dispatchAttemptSources)
          .where(
            inArray(
              wmsTables.dispatchAttemptSources.dispatchAttemptId,
              attempts.map((attempt) => attempt.id),
            ),
          )
      : [];
    const shipStockEvents = sources.length
      ? await tx
          .select({ id: wmsTables.stockEvents.id })
          .from(wmsTables.stockEvents)
          .where(
            and(
              inArray(
                wmsTables.stockEvents.id,
                sources.flatMap((source) => (source.stockEventId ? [source.stockEventId] : [])),
              ),
              eq(wmsTables.stockEvents.transitionType, 'SHIP'),
            ),
          )
      : [];
    const outbox = await tx
      .select({
        topic: wmsTables.outboxEvents.topic,
        eventType: wmsTables.outboxEvents.eventType,
        aggregateType: wmsTables.outboxEvents.aggregateType,
        aggregateId: wmsTables.outboxEvents.aggregateId,
        idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
      })
      .from(wmsTables.outboxEvents)
      .where(
        inArray(wmsTables.outboxEvents.aggregateId, [
          ...shipmentIds,
          ...world.shipments.map((member) => member.fulfillmentOrder.id),
          ...shipStockEvents.map((event) => event.id),
        ]),
      );
    expect(attempts).toHaveLength(expected.attempts ?? 0);
    expect(sources).toHaveLength(expected.sources ?? 0);
    expect(shipStockEvents).toHaveLength(expected.shipStockEvents ?? 0);
    const attemptOrders = attempts.length
      ? await tx
          .select({
            attemptId: wmsTables.dispatchAttempts.id,
            fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
          })
          .from(wmsTables.dispatchAttempts)
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.shipmentId, wmsTables.dispatchAttempts.shipmentId),
          )
          .innerJoin(
            wmsTables.fulfillmentOrderItems,
            eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
          )
          .where(
            inArray(
              wmsTables.dispatchAttempts.id,
              attempts.map((attempt) => attempt.id),
            ),
          )
      : [];
    const expectedOutbox = [
      ...attempts.map((attempt) => ({
        topic: 'shipments.events.v1',
        eventType: 'ShipmentShipped',
        aggregateType: 'Shipment',
        aggregateId: attempt.shipmentId,
        idempotencyKey: attempt.id,
      })),
      ...attempts.flatMap((attempt) =>
        [
          ...new Set(
            attemptOrders.filter((order) => order.attemptId === attempt.id).map((order) => order.fulfillmentOrderId),
          ),
        ].map((fulfillmentOrderId) => ({
          topic: 'fulfillments.events.v2',
          eventType: 'FulfillmentProgressed',
          aggregateType: 'FulfillmentOrder',
          aggregateId: fulfillmentOrderId,
          idempotencyKey: `${attempt.id}:${fulfillmentOrderId}`,
        })),
      ),
      ...(expected.fullyShippedFulfillmentOrderIds ?? []).map((fulfillmentOrderId) => ({
        topic: 'fulfillments.events.v1',
        eventType: 'FulfillmentShipped',
        aggregateType: 'Fulfillment',
        aggregateId: fulfillmentOrderId,
        idempotencyKey: `${fulfillmentOrderId}:fully-shipped`,
      })),
      ...shipStockEvents.map((event) => ({
        topic: 'inventory.events.v1',
        eventType: 'StockShipped',
        aggregateType: 'Stock',
        aggregateId: event.id,
        idempotencyKey: `stock-event:${event.id}`,
      })),
    ];
    const encode = (event: (typeof outbox)[number]) =>
      `${event.topic}|${event.eventType}|${event.aggregateType}|${event.aggregateId}|${event.idempotencyKey}`;
    expect(outbox.map(encode).sort()).toEqual(expectedOutbox.map(encode).sort());
    expect(outbox.filter((event) => event.topic === 'shipments.events.v1')).toHaveLength(expected.shipmentOutbox ?? 0);
    expect(outbox.filter((event) => event.topic === 'fulfillments.events.v2')).toHaveLength(
      expected.fulfillmentV2Outbox ?? 0,
    );
    expect(outbox.filter((event) => event.topic === 'fulfillments.events.v1')).toHaveLength(
      expected.fulfillmentV1Outbox ?? 0,
    );
    expect(outbox.filter((event) => event.topic === 'inventory.events.v1')).toHaveLength(expected.inventoryOutbox ?? 0);
  }

  async function expectSessionCheckpoint(
    tx: DbTx,
    sessionId: string,
    expected: {
      status: 'active' | 'settled';
      handedInQty: number;
      settledQty: number;
      returnedQty: number;
      shortageQty: number;
      balanceQty: number;
    },
  ) {
    const [session] = await tx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId));
    const balances = await tx
      .select({ qty: wmsTables.batchInventorySessionBalances.qty })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    expect(session).toMatchObject({
      status: expected.status,
      handedInQty: expected.handedInQty,
      settledQty: expected.settledQty,
      returnedQty: expected.returnedQty,
      shortageQty: expected.shortageQty,
    });
    expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(expected.balanceQty);
    expect(expected.settledQty + expected.returnedQty + expected.shortageQty + expected.balanceQty).toBe(
      expected.handedInQty,
    );
  }

  async function discretePickAfterHandoff(
    services: ReturnType<typeof makeServices>,
    world: WarehouseWorld,
    batchId: string,
    workItemId: string,
    worker: Actor,
    expectedLeaseVersion: number,
  ) {
    const member = world.shipments[0];
    const plan = await services.picking.plan('discrete', {
      batchId,
      shipmentIds: [member.shipment.id],
      actorId: worker.id,
      idempotencyKey: `discrete-plan-${randomUUID()}`,
    });
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') throw new Error(plan.reason);
    const started = await services.picking.start({
      batchId,
      planId: plan.planId,
      actorId: worker.id,
      idempotencyKey: `discrete-start-${randomUUID()}`,
    });
    expect(started.state).toBe('started');
    if (started.state !== 'started') throw new Error(started.reason);
    await services.picking.scan({
      strategy: 'discrete',
      stage: 'source',
      batchId,
      planId: plan.planId,
      sessionId: started.sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      shipmentLineId: member.line.id,
      skuId: world.skuId,
      sourceLocationId: world.locationId,
      quantity: member.line.qty,
      actor: worker,
      expectedLeaseVersion,
      idempotencyKey: `discrete-scan-${randomUUID()}`,
    });
    const completed = await services.picking.completePick({
      batchId,
      planId: plan.planId,
      sessionId: started.sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      actor: worker,
      expectedLeaseVersion,
      idempotencyKey: `discrete-complete-${randomUUID()}`,
    });
    return { completed, plan, sessionId: started.sessionId };
  }

  async function aggregatePick(
    services: ReturnType<typeof makeServices>,
    world: WarehouseWorld,
    batchId: string,
    workItemId: string,
    worker: Actor,
    expectedLeaseVersion = 0,
  ) {
    const member = world.shipments[0];
    const claim = await services.batches.claimPicker(
      workItemId,
      { expectedLeaseVersion },
      `aggregate-claim-${randomUUID()}`,
      worker,
    );
    const plan = await services.picking.plan('aggregate_then_sort', {
      batchId,
      shipmentIds: [member.shipment.id],
      actorId: worker.id,
      idempotencyKey: `aggregate-plan-${randomUUID()}`,
    });
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') throw new Error(plan.reason);
    const started = await services.picking.start({
      batchId,
      planId: plan.planId,
      actorId: worker.id,
      idempotencyKey: `aggregate-start-${randomUUID()}`,
    });
    expect(started.state).toBe('started');
    if (started.state !== 'started') throw new Error(started.reason);
    const cartId = `cart-${randomUUID()}`;
    await services.picking.aggregateBulkCartScan({
      strategy: 'aggregate_then_sort',
      stage: 'bulk_collect',
      batchId,
      planId: plan.planId,
      sessionId: started.sessionId,
      skuId: world.skuId,
      sourceLocationId: world.locationId,
      quantity: member.line.qty,
      cartId,
      actor: worker,
      idempotencyKey: `aggregate-collect-${randomUUID()}`,
    });
    await services.picking.aggregateSortScan({
      strategy: 'aggregate_then_sort',
      stage: 'sort',
      batchId,
      planId: plan.planId,
      sessionId: started.sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      shipmentLineId: member.line.id,
      skuId: world.skuId,
      cartId,
      quantity: member.line.qty,
      destinationCustody: 'SORTING',
      actor: worker,
      expectedLeaseVersion: claim.workItem.leaseVersion,
      idempotencyKey: `aggregate-sort-${randomUUID()}`,
    });
    const completed = await services.picking.completePick({
      batchId,
      planId: plan.planId,
      sessionId: started.sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      actor: worker,
      expectedLeaseVersion: claim.workItem.leaseVersion,
      idempotencyKey: `aggregate-complete-${randomUUID()}`,
    });
    return { claim, completed, plan, sessionId: started.sessionId };
  }

  async function totePick(
    services: ReturnType<typeof makeServices>,
    world: WarehouseWorld,
    batchId: string,
    workItemId: string,
    worker: Actor,
    toteQuantities: number[],
  ) {
    const member = world.shipments[0];
    const claim = await services.batches.claimPicker(
      workItemId,
      { expectedLeaseVersion: 0 },
      `tote-claim-${randomUUID()}`,
      worker,
    );
    const plan = await services.picking.plan('pick_to_tote', {
      batchId,
      shipmentIds: [member.shipment.id],
      actorId: worker.id,
      idempotencyKey: `tote-plan-${randomUUID()}`,
    });
    expect(plan.state).toBe('planned');
    if (plan.state !== 'planned') throw new Error(plan.reason);
    const started = await services.picking.start({
      batchId,
      planId: plan.planId,
      actorId: worker.id,
      idempotencyKey: `tote-start-${randomUUID()}`,
    });
    expect(started.state).toBe('started');
    if (started.state !== 'started') throw new Error(started.reason);
    const toteIds: string[] = [];
    for (const [index, quantity] of toteQuantities.entries()) {
      const toteBarcode = `TOTE-${index}-${randomUUID()}`;
      const registered = await services.picking.registerTote({
        warehouseId: world.warehouseId,
        toteBarcode,
        actor: worker,
        idempotencyKey: `tote-register-${randomUUID()}`,
      });
      toteIds.push(registered.toteId);
      await services.picking.assignTote({
        batchId,
        planId: plan.planId,
        sessionId: started.sessionId,
        workItemId,
        shipmentId: member.shipment.id,
        toteBarcode,
        actor: worker,
        expectedLeaseVersion: claim.workItem.leaseVersion,
        idempotencyKey: `tote-assign-${randomUUID()}`,
      });
      await services.picking.toteScan({
        strategy: 'pick_to_tote',
        stage: 'source',
        batchId,
        planId: plan.planId,
        sessionId: started.sessionId,
        workItemId,
        shipmentId: member.shipment.id,
        shipmentLineId: member.line.id,
        skuId: world.skuId,
        sourceLocationId: world.locationId,
        quantity,
        toteBarcode,
        actor: worker,
        expectedLeaseVersion: claim.workItem.leaseVersion,
        idempotencyKey: `tote-scan-${randomUUID()}`,
      });
    }
    const completed = await services.picking.completePick({
      batchId,
      planId: plan.planId,
      sessionId: started.sessionId,
      workItemId,
      shipmentId: member.shipment.id,
      actor: worker,
      expectedLeaseVersion: claim.workItem.leaseVersion,
      idempotencyKey: `tote-complete-${randomUUID()}`,
    });
    return { claim, completed, plan, sessionId: started.sessionId, toteIds };
  }

  it('06 invoice issue failure is isolated while the sibling batch shipment dispatches through production services', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [2, 2]);
      const provider = deliveryProvider();
      provider.issueInvoice
        .mockRejectedValueOnce(new Error('provider unavailable for shipment A'))
        .mockResolvedValueOnce({
          serviceId: `service-${randomUUID()}`,
          invoiceNumber: `tracking-${randomUUID()}`,
          carrierCode: 'CJ',
        });
      const services = makeServices(tx, provider);
      const manager = { id: randomUUID(), roles: ['master'] };
      const issueOperations: Array<Awaited<ReturnType<InvoiceOrchestrator['issueForShipment']>>> = [];
      for (const member of world.shipments) {
        issueOperations.push(
          await services.invoices.issueForShipment(
            member.shipment.id,
            {
              expectedManifestVersion: member.shipment.manifestVersion,
              provider: 'goodsflow',
              carrierCode: 'CJ',
              reason: 'release suite label',
            },
            `release-issue-${randomUUID()}`,
            manager,
          ),
        );
      }
      const failed = await services.invoices.processOperation(issueOperations[0].operationId);
      const succeeded = await services.invoices.processOperation(issueOperations[1].operationId);
      expect(failed.status).not.toBe('succeeded');
      expect(succeeded.status).toBe('succeeded');

      const successWorld = { ...world, shipments: [world.shipments[1]] };
      const { batch, added } = await createBatchWithShipments(services, successWorld, manager);
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const picked = await totePick(services, successWorld, batch.batchId, added[0].workItem.id, worker, [1, 1]);
      const packed = await services.batches.claimPacker(
        added[0].workItem.id,
        { expectedLeaseVersion: picked.claim.workItem.leaseVersion + 1 },
        `release-packer-${randomUUID()}`,
        worker,
      );
      for (const [index, toteId] of picked.toteIds.entries()) {
        const [tote] = await tx.select().from(wmsTables.totes).where(eq(wmsTables.totes.id, toteId));
        await services.picking.releaseTote({
          batchId: batch.batchId,
          planId: picked.plan.planId,
          sessionId: picked.sessionId,
          workItemId: added[0].workItem.id,
          shipmentId: world.shipments[1].shipment.id,
          toteBarcode: tote.barcode,
          actor: worker,
          expectedLeaseVersion: packed.workItem.leaseVersion,
          reason: 'packing complete',
          idempotencyKey: `release-tote-${index}-${randomUUID()}`,
        });
      }
      const dispatched = await services.dispatch.inspectionScan(world.shipments[1].shipment.id, {
        barcode: world.barcode,
        quantity: 2,
        actor: worker,
        idempotencyKey: `release-dispatch-${randomUUID()}`,
      });
      expect(packed.workItem.status).toBe('packing');
      expect(dispatched).toMatchObject({ status: 'shipped', attemptNo: 1 });

      const operations = await tx
        .select({
          id: wmsTables.invoiceOperations.id,
          status: wmsTables.invoiceOperations.status,
          lastError: wmsTables.invoiceOperations.lastError,
        })
        .from(wmsTables.invoiceOperations)
        .where(
          inArray(
            wmsTables.invoiceOperations.id,
            issueOperations.map((operation) => operation.operationId),
          ),
        );
      const attempts = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, world.shipments[1].shipment.id));
      const sources = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempts[0].id));
      const shipEvents = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, sources[0].stockEventId!));
      const events = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(eq(wmsTables.outboxEvents.aggregateId, world.shipments[1].shipment.id));
      const [settledSession] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, picked.sessionId));
      const settledBalances = await tx
        .select({ qty: wmsTables.batchInventorySessionBalances.qty })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      const failedOperation = operations.find((operation) => operation.id === issueOperations[0].operationId);
      const succeededOperation = operations.find((operation) => operation.id === issueOperations[1].operationId);
      expect(failedOperation?.status).toBe('recovery_required');
      expect(failedOperation?.lastError).toContain('provider unavailable for shipment A');
      expect(succeededOperation?.status).toBe('succeeded');
      expect(attempts).toHaveLength(1);
      expect(sources).toEqual([expect.objectContaining({ shipmentLineId: world.shipments[1].line.id, qty: 2 })]);
      expect(shipEvents).toEqual([expect.objectContaining({ transitionType: 'SHIP', quantity: 2 })]);
      expect(events.filter((event) => event.topic === 'shipments.events.v1')).toHaveLength(1);
      expect(settledSession).toMatchObject({ status: 'settled', handedInQty: 2, settledQty: 2 });
      expect(settledBalances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(2);
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'settled',
        handedInQty: 2,
        settledQty: 2,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 0,
      });
      await expectCoreCheckpoint(tx, world, { onHandQty: 2, reservedQty: 2, availableQty: 0 });
      await expectArtifactCardinality(tx, world, {
        attempts: 1,
        sources: 1,
        shipStockEvents: 1,
        shipmentOutbox: 1,
        fulfillmentV2Outbox: 1,
        fulfillmentV1Outbox: 1,
        inventoryOutbox: 1,
        fullyShippedFulfillmentOrderIds: [world.shipments[1].fulfillmentOrder.id],
      });
    });
  });

  it('07 discrete multi-worker claim, manager handoff, and packer claim use the production lease workflow', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [2], ['discrete']);
      await seedIssuedInvoices(tx, world);
      const services = makeServices(tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const workerA = { id: randomUUID(), roles: ['warehouse_worker'] };
      const workerB = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager, 'individual');
      const firstClaim = await services.batches.claimPicker(
        added[0].workItem.id,
        { expectedLeaseVersion: 0 },
        `worker-a-claim-${randomUUID()}`,
        workerA,
      );
      const handoff = await services.batches.handoff(
        added[0].workItem.id,
        {
          claimType: 'picker',
          targetWorkerId: workerB.id,
          expectedLeaseVersion: firstClaim.workItem.leaseVersion,
          reason: 'shift boundary',
        },
        `worker-handoff-${randomUUID()}`,
        manager,
      );
      expect(handoff.workItem).toMatchObject({ pickerId: workerB.id, leaseVersion: 2 });

      const picked = await discretePickAfterHandoff(
        services,
        world,
        batch.batchId,
        added[0].workItem.id,
        workerB,
        handoff.workItem.leaseVersion,
      );
      const packed = await services.batches.claimPacker(
        added[0].workItem.id,
        { expectedLeaseVersion: handoff.workItem.leaseVersion + 1 },
        `worker-a-pack-${randomUUID()}`,
        workerA,
      );
      expect(packed.workItem).toMatchObject({ status: 'packing', packerId: workerA.id });
      const [stored] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, added[0].workItem.id));
      expect(stored).toMatchObject({ pickerId: workerB.id, packerId: workerA.id, status: 'packing' });
      const balances = await tx
        .select({ qty: wmsTables.batchInventorySessionBalances.qty })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(2);
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'active',
        handedInQty: 2,
        settledQty: 0,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 2,
      });
      await expectCoreCheckpoint(tx, world);
      await expectArtifactCardinality(tx, world);
    });
  });

  it('08 aggregate collect/sort completes with source-bucket and session quantity conservation', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [4], ['aggregate_then_sort']);
      await seedIssuedInvoices(tx, world);
      const services = makeServices(tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager);
      const picked = await aggregatePick(services, world, batch.batchId, added[0].workItem.id, worker);
      expect(picked.completed).toMatchObject({ custodyType: 'PACKING', totalQty: 4 });

      const balances = await tx
        .select({
          custodyType: wmsTables.batchInventorySessionBalances.custodyType,
          qty: wmsTables.batchInventorySessionBalances.qty,
        })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(4);
      expect(
        balances.filter((balance) => balance.custodyType === 'AT_SOURCE').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(0);
      expect(
        balances.filter((balance) => balance.custodyType === 'BULK_CART').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(0);
      expect(
        balances.filter((balance) => balance.custodyType === 'PACKING').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(4);
      const sessionEvents = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.sessionId, picked.sessionId));
      expect(sessionEvents.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(['HAND_IN', 'MOVE_CUSTODY']),
      );
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'active',
        handedInQty: 4,
        settledQty: 0,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 4,
      });
      await expectCoreCheckpoint(tx, world);
      await expectArtifactCardinality(tx, world);
    });
  });

  it('09 pick-to-tote scans one shipment across multiple physical totes and consolidates custody for packing', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [4], ['pick_to_tote']);
      await seedIssuedInvoices(tx, world);
      const services = makeServices(tx);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager);
      const picked = await totePick(services, world, batch.batchId, added[0].workItem.id, worker, [1, 3]);
      expect(picked.completed).toMatchObject({ custodyType: 'PACKING', totalQty: 4 });
      const assignments = await tx
        .select()
        .from(wmsTables.shipmentToteAssignments)
        .where(eq(wmsTables.shipmentToteAssignments.shipmentId, world.shipments[0].shipment.id));
      expect(assignments).toHaveLength(2);
      expect(new Set(assignments.map((assignment) => assignment.toteId))).toEqual(new Set(picked.toteIds));
      const balances = await tx
        .select({
          custodyType: wmsTables.batchInventorySessionBalances.custodyType,
          qty: wmsTables.batchInventorySessionBalances.qty,
        })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, picked.sessionId));
      expect(balances.reduce((sum, balance) => sum + balance.qty, 0)).toBe(4);
      expect(balances.filter((balance) => balance.custodyType === 'TOTE').reduce((sum, row) => sum + row.qty, 0)).toBe(
        0,
      );
      expect(
        balances.filter((balance) => balance.custodyType === 'PACKING').reduce((sum, row) => sum + row.qty, 0),
      ).toBe(4);
      await expectSessionCheckpoint(tx, picked.sessionId, {
        status: 'active',
        handedInQty: 4,
        settledQty: 0,
        returnedQty: 0,
        shortageQty: 0,
        balanceQty: 4,
      });
      await expectCoreCheckpoint(tx, world);
      await expectArtifactCardinality(tx, world);
    });
  });

  it('10 short pick isolates one shipment and preserves its sibling reservation and active work', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, [5, 5], ['aggregate_then_sort']);
      await seedIssuedInvoices(tx, world);
      const provider = deliveryProvider();
      const services = makeServices(tx, provider);
      const manager = { id: randomUUID(), roles: ['master'] };
      const worker = { id: randomUUID(), roles: ['master', 'warehouse_worker'] };
      const { batch, added } = await createBatchWithShipments(services, world, manager);
      const claimed = await services.batches.claimPicker(
        added[0].workItem.id,
        { expectedLeaseVersion: 0 },
        `short-pick-claim-${randomUUID()}`,
        worker,
      );
      const plan = await services.picking.plan('aggregate_then_sort', {
        batchId: batch.batchId,
        shipmentIds: world.shipments.map((member) => member.shipment.id),
        actorId: worker.id,
        idempotencyKey: `short-pick-plan-${randomUUID()}`,
      });
      expect(plan.state).toBe('planned');
      if (plan.state !== 'planned') throw new Error(plan.reason);
      const started = await services.picking.start({
        batchId: batch.batchId,
        planId: plan.planId,
        actorId: worker.id,
        idempotencyKey: `short-pick-start-${randomUUID()}`,
      });
      expect(started.state).toBe('started');
      if (started.state !== 'started') throw new Error(started.reason);
      const [session] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, started.sessionId));
      const [storedPlan] = await tx
        .select()
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.id, plan.planId));
      const [currentLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, world.shipments[0].line.id));

      const reported = await services.shortPick.report(
        world.shipments[0].shipment.id,
        {
          workItemId: added[0].workItem.id,
          expectedWorkItemLeaseVersion: claimed.workItem.leaseVersion,
          planId: plan.planId,
          expectedPlanVersion: storedPlan.version,
          sessionId: session.id,
          expectedSessionVersion: session.version,
          expectedManifestVersion: world.shipments[0].shipment.manifestVersion,
          lines: [
            {
              shipmentLineId: currentLine.id,
              sourceLocationId: world.locationId,
              expectedLineVersion: currentLine.lineVersion,
              shortQty: 1,
            },
          ],
          reason: 'inventory_shortage',
        },
        `short-pick-report-${randomUUID()}`,
        worker,
      );
      expect(reported).toMatchObject({
        shipmentId: world.shipments[0].shipment.id,
        operationStatus: 'pending',
        workItemId: added[0].workItem.id,
      });
      expect(reported.invoiceOperationId).not.toBeNull();

      const reservationsA = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, world.shipments[0].line.id));
      const reservationsB = await tx
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, world.shipments[1].line.id));
      expect(reservationsA).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'confirmed', quantity: 4 }),
          expect.objectContaining({ status: 'released', quantity: 1 }),
        ]),
      );
      expect(reservationsB).toEqual([expect.objectContaining({ status: 'confirmed', quantity: 5 })]);

      const completedInvoice = await services.invoices.processOperation(reported.invoiceOperationId!);
      expect(completedInvoice.status).toBe('succeeded');
      const [shipmentA] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, world.shipments[0].shipment.id));
      const [shipmentB] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, world.shipments[1].shipment.id));
      const [workA] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, added[0].workItem.id));
      const [workB] = await tx
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, added[1].workItem.id));
      const [sessionQuantity] = await tx
        .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
      const [operation] = await tx
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, reported.operationId));
      expect(shipmentA).toMatchObject({ status: 'draft', recoveryCode: null });
      expect(shipmentB).toMatchObject({ status: 'planned', manifestVersion: 1, reservationVersion: 1 });
      expect(workA).toMatchObject({ status: 'excluded', waitingOperationId: null });
      expect(workB).toMatchObject({ status: 'queued', leaseVersion: 0 });
      expect(Number(sessionQuantity.qty)).toBe(5);
      await expectSessionCheckpoint(tx, session.id, {
        status: 'active',
        handedInQty: 10,
        settledQty: 0,
        returnedQty: 4,
        shortageQty: 1,
        balanceQty: 5,
      });
      expect(operation).toMatchObject({ status: 'completed', lastError: null });
      expect(provider.cancelInvoice).toHaveBeenCalledTimes(1);
      await expectCoreCheckpoint(tx, world, { onHandQty: 10, reservedQty: 9, availableQty: 1 });
      await expectArtifactCardinality(tx, world);
    });
  });
});
