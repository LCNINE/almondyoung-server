import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DbService } from '@app/db';
import { and, eq, gt, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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
import { assertOutboundV2Checkpoint, inRollbackTx, makeDb } from './__support__';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { canonicalShipmentRecipientHash, InvoiceOrchestrator } from './invoice-orchestrator.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ShipmentRecallService } from './shipment-recall.service';
import { ShipmentReservationService } from './shipment-reservation.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

interface LifecycleItem {
  shipmentId: string;
  shipmentLineId: string;
  fulfillmentOrderItemId: string;
  qty: number;
}

interface LifecycleWorld {
  warehouseId: string;
  sourceLocationId: string;
  reworkLocationId: string;
  profileId: string;
  skuId: string;
  barcode: string;
  salesOrderId: string;
  salesOrderLineId: string;
  fulfillmentOrderId: string;
  items: LifecycleItem[];
  outboxAggregateIds: string[];
}

interface StagedBatch {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemIds: string[];
}

interface ExpectedOutboxTopology {
  dispatchAttemptIds?: string[];
  fullyShippedFulfillmentOrderIds?: string[];
  recalls?: Array<{ shipmentId: string; operationId: string; fulfillmentOrderIds: string[] }>;
}

describeIfDb('Outbound V2 lifecycle release scenarios', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  const actor = { id: randomUUID(), roles: ['master'] };

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });

  afterAll(async () => {
    await client.end();
  });

  function services(tx: DbTx) {
    const dbService = {
      db: tx,
      run: <T>(fn: (trx: DbTx) => Promise<T>, explicit?: DbTx): Promise<T> => fn(explicit ?? tx),
    } as unknown as DbService<typeof wmsSchema>;
    const workflow = new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: new Date().toISOString() }),
    );
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const audit = new AuditService(dbService);
    const authorization = { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never;
    const controlled = new BatchControlledStockGuard();
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const inventory = new InventoryCommandService(
      dbService,
      new StockEventStore(dbService, sellable, controlled),
      inventoryOutbox,
      new LocationService(dbService),
      controlled,
    );
    const reservations = new ShipmentReservationService(
      dbService,
      new UnifiedReservationService(dbService, sellable),
      new FulfillmentProgressService(),
      invariant,
    );
    const planning = new ShipmentPlanningService(
      dbService,
      commands,
      reservations,
      invariant,
      audit,
      authorization,
      workflow,
    );
    const provider = {
      maxRequestDurationMs: 1_000,
      capabilities: {
        issue: { safeToRepeat: true, lookupByIdempotencyKey: false },
        void: { safeToRepeat: true, lookupByServiceId: true },
      },
      issueInvoice: jest.fn().mockImplementation(() =>
        Promise.resolve({
          serviceId: `lifecycle-service-${randomUUID()}`,
          invoiceNumber: `lifecycle-tracking-${randomUUID()}`,
          carrierCode: 'CJ',
        }),
      ),
      cancelInvoice: jest.fn().mockResolvedValue(undefined),
      queryInvoice: jest.fn().mockResolvedValue({ status: 'found', tracking: { status: 'canceled' } }),
    };
    const serviceRefs: { recall?: ShipmentRecallService } = {};
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === ShipmentRecallService) return serviceRefs.recall;
        if (token === ShipmentPlanningService) return planning;
        return { resumePending: jest.fn().mockResolvedValue(undefined) };
      }),
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
    const sessions = new BatchInventorySessionService(dbService, controlled, audit);
    const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
    const recall = new ShipmentRecallService(
      dbService,
      commands,
      authorization,
      invoices,
      inventory,
      reservations,
      fulfillmentOutbox,
      audit,
      workflow,
    );
    serviceRefs.recall = recall;
    const dispatch = new ShipmentDispatchService(
      dbService,
      commands,
      inventory,
      sessions,
      reservations,
      invoices,
      new BarcodeService(dbService),
      fulfillmentOutbox,
      audit,
      workflow,
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
    return { batches, dispatch, invoices, planning, recall, reservations };
  }

  async function seedWorld(tx: DbTx, quantity = 2, onHand = quantity): Promise<LifecycleWorld> {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `lifecycle-wh-${suffix}` })
      .returning();
    const [sourceLocation] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `LIFECYCLE-SOURCE-${suffix}`, locationType: 'zone' })
      .returning();
    const [reworkLocation] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId: warehouse.id,
        code: `LIFECYCLE-REWORK-${suffix}`,
        locationType: 'zone',
        isSystem: true,
        systemRole: 'outbound_rework',
        isActive: true,
      })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `lifecycle-holder-${suffix}` })
      .returning();
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `lifecycle-profile-${suffix}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Lifecycle sender', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        carrierAccountRef: 'goodsflow-center',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({
        name: 'Lifecycle SKU',
        code: `LIFECYCLE-${suffix}`,
        holderId: holder.id,
        deliveryProfileId: profile.id,
      })
      .returning();
    const barcode = `881${suffix.replaceAll('-', '').slice(0, 10)}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: sourceLocation.id,
      stockState: 'ON_HAND',
      qty: onHand,
    });
    const recipient = {
      recipientName: 'Lifecycle recipient',
      phone: '010-1111-2222',
      postalCode: '01234',
      roadAddress: 'Seoul lifecycle road 1',
      detailAddress: '101',
    };
    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `lifecycle-order-${suffix}`,
        salesChannel: 'medusa',
        status: 'confirmed',
        shippingAddress: recipient,
        orderDate: new Date(),
      })
      .returning();
    const [salesOrderLine] = await tx
      .insert(wmsTables.salesOrderLines)
      .values({
        salesOrderId: salesOrder.id,
        variantId: randomUUID(),
        productName: 'Lifecycle product',
        quantity,
        channelOrderItemId: `lifecycle-item-${suffix}`,
        channelProductId: `lifecycle-product-${suffix}`,
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({
        salesOrderId: salesOrder.id,
        warehouseId: warehouse.id,
        fulfillmentMode: 'in_house',
        status: 'processing',
        totalQty: quantity,
        totalReservedQty: quantity,
      })
      .returning();
    const [fulfillmentOrderItem] = await tx
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
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: warehouse.id,
        status: 'draft',
        shippingProfileId: profile.id,
        recipientSnapshot: recipient,
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: fulfillmentOrderItem.id,
        skuId: sku.id,
        qty: quantity,
        reservedQty: quantity,
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
      requestedAt: new Date(),
    });
    return {
      warehouseId: warehouse.id,
      sourceLocationId: sourceLocation.id,
      reworkLocationId: reworkLocation.id,
      profileId: profile.id,
      skuId: sku.id,
      barcode,
      salesOrderId: salesOrder.id,
      salesOrderLineId: salesOrderLine.id,
      fulfillmentOrderId: fulfillmentOrder.id,
      items: [
        {
          shipmentId: shipment.id,
          shipmentLineId: line.id,
          fulfillmentOrderItemId: fulfillmentOrderItem.id,
          qty: quantity,
        },
      ],
      outboxAggregateIds: [shipment.id, fulfillmentOrder.id],
    };
  }

  async function seedRecalledAttemptHistory(tx: DbTx, world: LifecycleWorld) {
    const item = world.items[0];
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, item.shipmentId));
    const attemptId = randomUUID();
    const recallOperationId = randomUUID();
    const dispatchedAt = new Date('2026-07-15T00:00:00.000Z');
    const recalledAt = new Date('2026-07-15T01:00:00.000Z');
    const [invoice] = await tx
      .insert(wmsTables.invoices)
      .values({
        trackingNo: `LIFECYCLE-OLD-${randomUUID()}`,
        carrier: 'CJ',
        issueMethod: 'self',
        externalServiceId: `lifecycle-old-service-${randomUUID()}`,
        issuedForFulfillmentOrderId: world.fulfillmentOrderId,
        shipmentId: item.shipmentId,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalShipmentRecipientHash(shipment.recipientSnapshot),
        status: 'voided',
        voidedAt: recalledAt,
      })
      .returning();
    const [dispatchJournal] = await tx
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
        sourceId: attemptId,
        idempotencyKey: `lifecycle-old-dispatch-${randomUUID()}`,
      })
      .returning();
    const [reversalJournal] = await tx
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_RECALL',
        sourceId: recallOperationId,
        idempotencyKey: `lifecycle-old-recall-${randomUUID()}`,
      })
      .returning();
    const [attempt] = await tx
      .insert(wmsTables.dispatchAttempts)
      .values({
        id: attemptId,
        shipmentId: item.shipmentId,
        attemptNo: 1,
        status: 'recalled',
        idempotencyKey: `lifecycle-old-attempt-${randomUUID()}`,
        invoiceId: invoice.id,
        stockJournalId: dispatchJournal.id,
        reversalJournalId: reversalJournal.id,
        dispatchedAt,
        recalledAt,
      })
      .returning();
    const [event] = await tx
      .insert(wmsTables.stockEvents)
      .values({
        journalId: dispatchJournal.id,
        skuId: world.skuId,
        fromWarehouseId: world.warehouseId,
        fromLocationId: world.sourceLocationId,
        fromState: 'ON_HAND',
        transitionType: 'SHIP',
        quantity: item.qty,
        occurredAt: dispatchedAt,
        idempotencyKey: `lifecycle-old-event-${randomUUID()}`,
        eventStatus: 'POSTED',
      })
      .returning();
    await tx.insert(wmsTables.outboxEvents).values({
      topic: 'inventory.events.v1',
      eventType: 'StockShipped',
      aggregateType: 'Stock',
      aggregateId: event.id,
      partitionKey: world.skuId,
      idempotencyKey: `stock-event:${event.id}`,
      payload: {
        stockEventId: event.id,
        skuId: world.skuId,
        quantity: item.qty,
        warehouseId: world.warehouseId,
        locationId: world.sourceLocationId,
        outboundType: 'ORDER',
        shippedAt: dispatchedAt.toISOString(),
      },
    });
    const [source] = await tx
      .insert(wmsTables.dispatchAttemptSources)
      .values({
        dispatchAttemptId: attempt.id,
        shipmentLineId: item.shipmentLineId,
        sourceLocationId: world.sourceLocationId,
        qty: item.qty,
        stockEventId: event.id,
      })
      .returning();
    const [tracking] = await tx
      .insert(wmsTables.shipmentTracking)
      .values({
        shipmentId: item.shipmentId,
        dispatchAttemptId: attempt.id,
        providerEventId: `lifecycle-old-tracking-${randomUUID()}`,
        status: 'shipped',
        timestamp: dispatchedAt,
      })
      .returning();
    return { attempt, invoice, source, tracking };
  }

  async function checkpoint(
    tx: DbTx,
    world: LifecycleWorld,
    expected: {
      onHandQty: number;
      reservedQty: number;
      outboxCount: number;
      inventoryOutboxCount: number;
      dispatchAttemptCount: number;
      dispatchSourceCount: number;
      shipEventCount: number;
    } & ExpectedOutboxTopology,
  ): Promise<void> {
    const checkpointExpected = {
      onHandQty: expected.onHandQty,
      reservedQty: expected.reservedQty,
      availableQty: expected.onHandQty - expected.reservedQty,
      outboxCount: expected.outboxCount,
      inventoryOutboxCount: expected.inventoryOutboxCount,
      dispatchAttemptCount: expected.dispatchAttemptCount,
      dispatchSourceCount: expected.dispatchSourceCount,
      shipEventCount: expected.shipEventCount,
    };
    await assertOutboundV2Checkpoint(tx, {
      fulfillmentOrderIds: [world.fulfillmentOrderId],
      skuId: world.skuId,
      warehouseId: world.warehouseId,
      outboxAggregateIds: world.outboxAggregateIds,
      expected: checkpointExpected,
    });
    await expectExactOutboxTopology(tx, world, expected);
  }

  async function expectExactOutboxTopology(
    tx: DbTx,
    world: LifecycleWorld,
    expected: ExpectedOutboxTopology,
  ): Promise<void> {
    const encode = (row: {
      topic: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      idempotencyKey: string;
    }) => `${row.topic}|${row.eventType}|${row.aggregateType}|${row.aggregateId}|${row.idempotencyKey}`;
    const shipEvents = await tx
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(
        and(
          eq(wmsTables.stockEvents.skuId, world.skuId),
          eq(wmsTables.stockEvents.fromWarehouseId, world.warehouseId),
          eq(wmsTables.stockEvents.transitionType, 'SHIP'),
        ),
      );
    const inventoryRows = shipEvents.length
      ? await tx
          .select({
            topic: wmsTables.outboxEvents.topic,
            eventType: wmsTables.outboxEvents.eventType,
            aggregateType: wmsTables.outboxEvents.aggregateType,
            aggregateId: wmsTables.outboxEvents.aggregateId,
            idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
          })
          .from(wmsTables.outboxEvents)
          .where(
            and(
              eq(wmsTables.outboxEvents.topic, 'inventory.events.v1'),
              inArray(
                wmsTables.outboxEvents.aggregateId,
                shipEvents.map((event) => event.id),
              ),
            ),
          )
      : [];
    expect(inventoryRows.map(encode).sort()).toEqual(
      shipEvents
        .map((event) =>
          encode({
            topic: 'inventory.events.v1',
            eventType: 'StockShipped',
            aggregateType: 'Stock',
            aggregateId: event.id,
            idempotencyKey: `stock-event:${event.id}`,
          }),
        )
        .sort(),
    );

    const dispatchAttemptIds = expected.dispatchAttemptIds ?? [];
    const attempts = dispatchAttemptIds.length
      ? await tx
          .select({ id: wmsTables.dispatchAttempts.id, shipmentId: wmsTables.dispatchAttempts.shipmentId })
          .from(wmsTables.dispatchAttempts)
          .where(inArray(wmsTables.dispatchAttempts.id, dispatchAttemptIds))
      : [];
    expect(attempts).toHaveLength(dispatchAttemptIds.length);
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
          .where(inArray(wmsTables.dispatchAttempts.id, dispatchAttemptIds))
      : [];
    const expectedRows: Array<{
      topic: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      idempotencyKey: string;
    }> = [];
    for (const attempt of attempts) {
      expectedRows.push({
        topic: 'shipments.events.v1',
        eventType: 'ShipmentShipped',
        aggregateType: 'Shipment',
        aggregateId: attempt.shipmentId,
        idempotencyKey: attempt.id,
      });
      const fulfillmentOrderIds = [
        ...new Set(
          attemptOrders.filter((order) => order.attemptId === attempt.id).map((order) => order.fulfillmentOrderId),
        ),
      ];
      for (const fulfillmentOrderId of fulfillmentOrderIds) {
        expectedRows.push({
          topic: 'fulfillments.events.v2',
          eventType: 'FulfillmentProgressed',
          aggregateType: 'FulfillmentOrder',
          aggregateId: fulfillmentOrderId,
          idempotencyKey: `${attempt.id}:${fulfillmentOrderId}`,
        });
      }
    }
    for (const fulfillmentOrderId of expected.fullyShippedFulfillmentOrderIds ?? []) {
      expectedRows.push({
        topic: 'fulfillments.events.v1',
        eventType: 'FulfillmentShipped',
        aggregateType: 'Fulfillment',
        aggregateId: fulfillmentOrderId,
        idempotencyKey: `${fulfillmentOrderId}:fully-shipped`,
      });
    }
    for (const recalled of expected.recalls ?? []) {
      expectedRows.push({
        topic: 'shipments.events.v1',
        eventType: 'ShipmentDispatchRecalled',
        aggregateType: 'Shipment',
        aggregateId: recalled.shipmentId,
        idempotencyKey: recalled.operationId,
      });
      for (const fulfillmentOrderId of recalled.fulfillmentOrderIds) {
        expectedRows.push({
          topic: 'fulfillments.events.v2',
          eventType: 'FulfillmentReopened',
          aggregateType: 'FulfillmentOrder',
          aggregateId: fulfillmentOrderId,
          idempotencyKey: `${recalled.operationId}:${fulfillmentOrderId}`,
        });
      }
    }
    const fulfillmentRows = await tx
      .select({
        topic: wmsTables.outboxEvents.topic,
        eventType: wmsTables.outboxEvents.eventType,
        aggregateType: wmsTables.outboxEvents.aggregateType,
        aggregateId: wmsTables.outboxEvents.aggregateId,
        idempotencyKey: wmsTables.outboxEvents.idempotencyKey,
      })
      .from(wmsTables.outboxEvents)
      .where(inArray(wmsTables.outboxEvents.aggregateId, world.outboxAggregateIds));
    expect(fulfillmentRows.map(encode).sort()).toEqual(expectedRows.map(encode).sort());
  }

  async function split(
    tx: DbTx,
    world: LifecycleWorld,
    sourceQty: number,
    targetQty: number,
    targetInitiallyReserved: boolean,
  ): Promise<[LifecycleItem, LifecycleItem]> {
    const source = world.items[0];
    const [line] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, source.shipmentLineId));
    const result = await services(tx).planning.split(
      source.shipmentId,
      {
        expectedManifestVersion: 1,
        reason: 'lifecycle release split',
        moves: [
          {
            shipmentLineId: line.id,
            expectedLineVersion: line.lineVersion,
            qty: targetQty,
          },
        ],
      },
      `lifecycle-split-${randomUUID()}`,
      actor,
      tx,
    );
    const items: LifecycleItem[] = [];
    for (const [shipmentId, qty] of [
      [result.source.shipmentId, sourceQty],
      [result.target.shipmentId, targetQty],
    ] as const) {
      const [splitLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(
          and(
            eq(wmsTables.shipmentLines.shipmentId, shipmentId),
            eq(wmsTables.shipmentLines.fulfillmentOrderItemId, source.fulfillmentOrderItemId),
          ),
        );
      items.push({
        shipmentId,
        shipmentLineId: splitLine.id,
        fulfillmentOrderItemId: source.fulfillmentOrderItemId,
        qty,
      });
      world.outboxAggregateIds.push(shipmentId);
    }
    world.items = items;
    if (targetInitiallyReserved) {
      await services(tx).reservations.reservePartial(items[1].shipmentLineId, targetQty, tx);
    }
    return [items[0], items[1]];
  }

  async function planAndIssue(tx: DbTx, world: LifecycleWorld, shipmentId: string): Promise<void> {
    const service = services(tx);
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    await service.planning.plan(
      shipmentId,
      {
        shippingProfileId: world.profileId,
        expectedManifestVersion: shipment.manifestVersion,
        expectedReservationVersion: shipment.reservationVersion,
      },
      `lifecycle-plan-${randomUUID()}`,
      actor,
      tx,
    );
    const [planned] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    const accepted = await service.invoices.issueForShipment(
      shipmentId,
      {
        expectedManifestVersion: planned.manifestVersion,
        provider: 'goodsflow',
        carrierCode: 'CJ',
        reason: 'lifecycle release label',
      },
      `lifecycle-issue-${randomUUID()}`,
      actor,
      tx,
    );
    await service.invoices.processOperation(accepted.operationId);
    expect((await service.invoices.getOperation(accepted.operationId, tx)).status).toBe('succeeded');
  }

  async function stageBatch(tx: DbTx, world: LifecycleWorld, shipmentIds: string[]): Promise<StagedBatch> {
    const service = services(tx);
    const created = await service.batches.createBatch(
      { warehouseId: world.warehouseId, pickingMethod: 'individual', name: 'Lifecycle release batch' },
      `lifecycle-batch-${randomUUID()}`,
      actor,
      tx,
    );
    const workItemIds: string[] = [];
    for (const shipmentId of shipmentIds) {
      const added = await service.batches.addShipment(
        created.batchId,
        shipmentId,
        `lifecycle-batch-add-${shipmentId}-${randomUUID()}`,
        actor,
        tx,
      );
      workItemIds.push(added.workItem.id);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({
          status: 'packing',
          packerId: actor.id,
          packerClaimedAt: new Date(),
          leaseExpiresAt: new Date(Date.now() + 60_000),
          leaseVersion: 1,
        })
        .where(eq(wmsTables.outboundBatchWorkItems.id, added.workItem.id));
    }
    const [plan] = await tx
      .insert(wmsTables.pickingPlans)
      .values({ batchId: created.batchId, strategy: 'discrete', status: 'active', createdBy: actor.id })
      .returning();
    const shipmentRows = await tx
      .select()
      .from(wmsTables.shipments)
      .where(inArray(wmsTables.shipments.id, shipmentIds));
    await tx.insert(wmsTables.pickingPlanMembers).values(
      shipmentRows.map((shipment) => ({
        planId: plan.id,
        shipmentId: shipment.id,
        manifestVersion: shipment.manifestVersion,
        reservationVersion: shipment.reservationVersion,
      })),
    );
    const lines = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
    const [sourceLedger] = await tx
      .select()
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, world.skuId),
          eq(wmsTables.stockLedgers.warehouseId, world.warehouseId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          gt(wmsTables.stockLedgers.qty, 0),
        ),
      )
      .limit(1);
    await tx.insert(wmsTables.pickingSourceAllocations).values(
      lines.map((line) => ({
        planId: plan.id,
        shipmentLineId: line.id,
        sourceLocationId: sourceLedger.locationId,
        qty: line.qty,
        sourceStockVersion: sourceLedger.version,
      })),
    );
    const totalQty = lines.reduce((total, line) => total + line.qty, 0);
    const [session] = await tx
      .insert(wmsTables.batchInventorySessions)
      .values({ batchId: created.batchId, status: 'active', handedInQty: totalQty })
      .returning();
    await tx.insert(wmsTables.batchInventorySessionEvents).values({
      sessionId: session.id,
      idempotencyKey: `start:${plan.id}`,
      eventType: 'HAND_IN',
      skuId: world.skuId,
      quantity: totalQty,
      toCustodyType: 'AT_SOURCE',
      toSourceLocationId: sourceLedger.locationId,
      payload: { planId: plan.id, sequence: 0, requestHash: 'a'.repeat(64), actorId: actor.id },
    });
    for (const line of lines) {
      await tx
        .update(wmsTables.shipmentLines)
        .set({ inspectedQty: line.qty - 1 })
        .where(eq(wmsTables.shipmentLines.id, line.id));
      await tx.insert(wmsTables.batchInventorySessionBalances).values([
        {
          sessionId: session.id,
          skuId: world.skuId,
          sourceLocationId: sourceLedger.locationId,
          custodyType: 'PACKING',
          custodyRef: `work-item:${line.shipmentId}`,
          shipmentLineId: line.id,
          qty: 1,
        },
        ...(line.qty > 1
          ? [
              {
                sessionId: session.id,
                skuId: world.skuId,
                sourceLocationId: sourceLedger.locationId,
                custodyType: 'PACKED' as const,
                custodyRef: `work-item:${line.shipmentId}`,
                shipmentLineId: line.id,
                qty: line.qty - 1,
              },
            ]
          : []),
      ]);
    }
    return { batchId: created.batchId, planId: plan.id, sessionId: session.id, workItemIds };
  }

  async function lastScan(tx: DbTx, world: LifecycleWorld, shipmentId: string, idempotencyKey: string) {
    return services(tx).dispatch.inspectionScan(shipmentId, {
      barcode: world.barcode,
      quantity: 1,
      actor: { id: actor.id, roles: ['logistics_worker'] },
      idempotencyKey,
    });
  }

  async function recall(tx: DbTx, shipmentId: string, dispatchAttemptId: string) {
    const service = services(tx);
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    const reported = await service.recall.report(
      shipmentId,
      dispatchAttemptId,
      {
        dispatchAttemptId,
        expectedManifestVersion: shipment.manifestVersion,
        physicalRecoveryConfirmed: true,
        reason: 'package_recovered',
      },
      `lifecycle-recall-${randomUUID()}`,
      actor,
    );
    expect(reported.operationStatus).toBe('pending');
    await service.invoices.processOperation(reported.invoiceOperationId!);
    const completed = await service.recall.resumePending(reported.operationId, tx);
    expect(completed.operationStatus).toBe('completed');
    return completed;
  }

  it('11. last inspection scan auto-dispatches and posts the ledger immediately', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 2, 2);
      await planAndIssue(tx, world, world.items[0].shipmentId);
      await stageBatch(tx, world, [world.items[0].shipmentId]);
      await checkpoint(tx, world, {
        onHandQty: 2,
        reservedQty: 2,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      const result = await lastScan(tx, world, world.items[0].shipmentId, `lifecycle-case11-${randomUUID()}`);
      expect(result).toMatchObject({ status: 'shipped', attemptNo: 1 });
      await checkpoint(tx, world, {
        onHandQty: 0,
        reservedQty: 0,
        outboxCount: 3,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [result.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: [world.fulfillmentOrderId],
      });
      const [ledger] = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, world.skuId),
            eq(wmsTables.stockLedgers.locationId, world.sourceLocationId),
          ),
        );
      expect(ledger.qty).toBe(0);
    });
  });

  it('12. staggered dispatch is exactly-once and V2 batch derived close never double-consumes', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 10, 10);
      await services(tx).reservations.releasePartial(world.items[0].shipmentLineId, 4, 'prepare backorder split', tx);
      const [first, second] = await split(tx, world, 6, 4, true);
      await planAndIssue(tx, world, first.shipmentId);
      await planAndIssue(tx, world, second.shipmentId);
      const staged = await stageBatch(tx, world, [first.shipmentId, second.shipmentId]);
      await checkpoint(tx, world, {
        onHandQty: 10,
        reservedQty: 10,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      const firstKey = `lifecycle-staggered-first-${randomUUID()}`;
      const firstResult = await lastScan(tx, world, first.shipmentId, firstKey);
      await checkpoint(tx, world, {
        onHandQty: 4,
        reservedQty: 4,
        outboxCount: 2,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [firstResult.dispatchAttemptId!],
      });
      expect(await lastScan(tx, world, first.shipmentId, firstKey)).toEqual(firstResult);
      await checkpoint(tx, world, {
        onHandQty: 4,
        reservedQty: 4,
        outboxCount: 2,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [firstResult.dispatchAttemptId!],
      });
      const secondResult = await lastScan(tx, world, second.shipmentId, `lifecycle-staggered-second-${randomUUID()}`);
      await checkpoint(tx, world, {
        onHandQty: 0,
        reservedQty: 0,
        outboxCount: 5,
        inventoryOutboxCount: 2,
        dispatchAttemptCount: 2,
        dispatchSourceCount: 2,
        shipEventCount: 2,
        dispatchAttemptIds: [firstResult.dispatchAttemptId!, secondResult.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: [world.fulfillmentOrderId],
      });
      const detail = await services(tx).batches.getBatch(staged.batchId, tx);
      expect(detail).toMatchObject({ status: 'completed', totalQty: 10 });
      expect(detail.workItems.every((workItem) => workItem.status === 'completed')).toBe(true);
      expect(detail.inventorySession).toBeNull();
      expect(
        await tx
          .select()
          .from(wmsTables.dispatchAttempts)
          .where(inArray(wmsTables.dispatchAttempts.shipmentId, [first.shipmentId, second.shipmentId])),
      ).toHaveLength(2);
      // Re-assert the whole conservation set *after* the derived close, with the
      // same golden values as before it. This scenario's name promises that batch
      // close never double-consumes, but without this checkpoint that promise
      // rested on knowing getBatch happens to be a pure read — an implementation
      // detail, not an asserted property. Anything the close path consumes,
      // re-settles or re-posts now moves one of these values.
      await checkpoint(tx, world, {
        onHandQty: 0,
        reservedQty: 0,
        outboxCount: 5,
        inventoryOutboxCount: 2,
        dispatchAttemptCount: 2,
        dispatchSourceCount: 2,
        shipEventCount: 2,
        dispatchAttemptIds: [firstResult.dispatchAttemptId!, secondResult.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: [world.fulfillmentOrderId],
      });
    });
  });

  it('13. recall reverses to rework, restores reservation and reopens FO demand', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 3, 3);
      const item = world.items[0];
      await planAndIssue(tx, world, item.shipmentId);
      await stageBatch(tx, world, [item.shipmentId]);
      const dispatched = await lastScan(tx, world, item.shipmentId, `lifecycle-case13-dispatch-${randomUUID()}`);
      await checkpoint(tx, world, {
        onHandQty: 0,
        reservedQty: 0,
        outboxCount: 3,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [dispatched.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: [world.fulfillmentOrderId],
      });
      const recalled = await recall(tx, item.shipmentId, dispatched.dispatchAttemptId!);
      await checkpoint(tx, world, {
        onHandQty: 3,
        reservedQty: 3,
        outboxCount: 5,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [dispatched.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: [world.fulfillmentOrderId],
        recalls: [
          {
            shipmentId: item.shipmentId,
            operationId: recalled.operationId,
            fulfillmentOrderIds: [world.fulfillmentOrderId],
          },
        ],
      });
      const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, item.shipmentId));
      const [attempt] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, dispatched.dispatchAttemptId!));
      const [fulfillmentOrder] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, world.fulfillmentOrderId));
      const [rework] = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, world.skuId),
            eq(wmsTables.stockLedgers.locationId, world.reworkLocationId),
          ),
        );
      expect(shipment).toMatchObject({ status: 'draft', recoveryCode: null, shippedAt: null });
      expect(attempt).toMatchObject({ status: 'recalled', recoveryCode: null });
      expect(attempt.reversalJournalId).not.toBeNull();
      expect(fulfillmentOrder).toMatchObject({ status: 'ready', shippedAt: null, totalReservedQty: 3 });
      expect(rework.qty).toBe(3);
    });
  });

  it('14. recalled shipment redispatches with a new invoice and immutable attempt 1', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 3, 3);
      const item = world.items[0];
      const history = await seedRecalledAttemptHistory(tx, world);
      await planAndIssue(tx, world, item.shipmentId);
      await stageBatch(tx, world, [item.shipmentId]);
      const [attemptOneBefore] = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, history.attempt.id));
      const sourcesBefore = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, history.attempt.id));
      const trackingBefore = await tx
        .select()
        .from(wmsTables.shipmentTracking)
        .where(eq(wmsTables.shipmentTracking.dispatchAttemptId, history.attempt.id));
      await checkpoint(tx, world, {
        onHandQty: 3,
        reservedQty: 3,
        outboxCount: 0,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
      });
      const second = await lastScan(tx, world, item.shipmentId, `lifecycle-case14-second-${randomUUID()}`);
      expect(second.attemptNo).toBe(2);
      await checkpoint(tx, world, {
        onHandQty: 0,
        reservedQty: 0,
        outboxCount: 3,
        inventoryOutboxCount: 2,
        dispatchAttemptCount: 2,
        dispatchSourceCount: 2,
        shipEventCount: 2,
        dispatchAttemptIds: [second.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: [world.fulfillmentOrderId],
      });
      const attempts = await tx
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, item.shipmentId))
        .orderBy(wmsTables.dispatchAttempts.attemptNo);
      expect(attempts).toHaveLength(2);
      expect(attempts[0]).toEqual(attemptOneBefore);
      expect(attempts[0].status).toBe('recalled');
      expect(attempts[1]).toMatchObject({ attemptNo: 2, status: 'dispatched' });
      expect(
        await tx
          .select()
          .from(wmsTables.dispatchAttemptSources)
          .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, history.attempt.id)),
      ).toEqual(sourcesBefore);
      expect(
        await tx
          .select()
          .from(wmsTables.shipmentTracking)
          .where(eq(wmsTables.shipmentTracking.dispatchAttemptId, history.attempt.id)),
      ).toEqual(trackingBefore);
      expect(attempts[1].invoiceId).not.toBe(attempts[0].invoiceId);
    });
  });

  it('15. partial shipped plus canceled remainder completes the FO', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, 10, 10);
      await services(tx).reservations.releasePartial(world.items[0].shipmentLineId, 4, 'prepare partial shipment', tx);
      const [first, second] = await split(tx, world, 6, 4, false);
      await planAndIssue(tx, world, first.shipmentId);
      await stageBatch(tx, world, [first.shipmentId]);
      const dispatched = await lastScan(tx, world, first.shipmentId, `lifecycle-case15-dispatch-${randomUUID()}`);
      await checkpoint(tx, world, {
        onHandQty: 4,
        reservedQty: 0,
        outboxCount: 2,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [dispatched.dispatchAttemptId!],
      });
      const [remainingShipment] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, second.shipmentId));
      const [remainingLine] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, second.shipmentLineId));
      const canceled = await services(tx).planning.cancelOutstanding(
        second.shipmentId,
        {
          expectedManifestVersion: remainingShipment.manifestVersion,
          reason: 'customer canceled backordered remainder',
          lines: [
            {
              shipmentLineId: remainingLine.id,
              expectedLineVersion: remainingLine.lineVersion,
              qty: remainingLine.qty,
            },
          ],
        },
        `lifecycle-case15-cancel-${randomUUID()}`,
        actor,
        tx,
      );
      expect(canceled.operationStatus).toBe('completed');
      await checkpoint(tx, world, {
        onHandQty: 4,
        reservedQty: 0,
        outboxCount: 2,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [dispatched.dispatchAttemptId!],
      });
      const [fulfillmentItem] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.id, first.fulfillmentOrderItemId));
      const [fulfillmentOrder] = await tx
        .select()
        .from(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, world.fulfillmentOrderId));
      expect(fulfillmentItem).toMatchObject({ qty: 10, shippedQty: 6, canceledQty: 4, status: 'completed' });
      expect(fulfillmentOrder.status).toBe('completed');
    });
  });
});
