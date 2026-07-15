import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbService } from '@app/db';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { OutboxService as InventoryOutboxService } from '../../inventory/shared/outbox/outbox.service';
import { OutboxService as FulfillmentOutboxService } from '../outbox/outbox.service';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import { LocationService } from '../../inventory/core/services/location.service';
import { UnifiedReservationService } from '../../inventory/shared/services/unified-reservation.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';
import { assertOutboundV2Checkpoint, inRollbackTx, makeDb, makeDbService, wireLogistics, Wired } from './__support__';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ConsolidationService } from './consolidation.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { InvoiceOrchestrator, canonicalShipmentRecipientHash } from './invoice-orchestrator.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const ACTIVE_TOPIC = 'shipments.events.v1';

interface ScenarioItem {
  salesOrderId: string;
  salesOrderLineId: string;
  fulfillmentOrderId: string;
  fulfillmentOrderItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  reservationId?: string;
  qty: number;
}

interface ScenarioWorld {
  warehouseId: string;
  locationId: string;
  skuId: string;
  profileId: string;
  barcode: string;
  stockQty: number;
  items: ScenarioItem[];
  outboxAggregateIds: string[];
}

interface ExpectedOutboxTopology {
  dispatchAttemptIds?: string[];
  fullyShippedFulfillmentOrderIds?: string[];
  recalls?: Array<{ shipmentId: string; operationId: string; fulfillmentOrderIds: string[] }>;
}

describeIfDb('Outbound V2 release scenarios', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let wired: Wired;
  let planning: ShipmentPlanningService;
  let consolidation: ConsolidationService;
  const actor = { id: randomUUID(), roles: ['master'] };

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    const dbService = makeDbService(db);
    wired = wireLogistics(dbService, 'v2');
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const audit = new AuditService(dbService);
    const scopes = {
      getScopesByRoles: () =>
        Promise.resolve(
          new Set([
            FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
            FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
            FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
          ]),
        ),
    } as never;
    const workflow = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' }));
    planning = new ShipmentPlanningService(
      dbService,
      commands,
      wired.shipmentReservations,
      invariant,
      audit,
      scopes,
      workflow,
    );
    consolidation = new ConsolidationService(
      dbService,
      commands,
      wired.shipmentReservations,
      invariant,
      audit,
      scopes,
      workflow,
    );
  });

  afterAll(async () => {
    await client.end();
  });

  async function seedWorld(
    tx: DbTx,
    options: { demands?: number[]; reserved?: number[]; stockQty?: number; channels?: Array<'medusa' | 'naver'> } = {},
  ): Promise<ScenarioWorld> {
    const suffix = randomUUID();
    const demands = options.demands ?? [10];
    const reserved = options.reserved ?? demands;
    const stockQty =
      options.stockQty ??
      Math.max(
        20,
        reserved.reduce((sum, qty) => sum + qty, 0),
      );
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `scenario-wh-${suffix}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `scenario-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'Scenario SKU', code: `SCENARIO-${suffix}`, holderId: holder.id })
      .returning();
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `scenario-profile-${suffix}`,
        sourceType: 'in_house',
        senderSnapshot: { name: 'Scenario Sender', phone: '02-0000-0000' },
        originAddressSnapshot: { address: 'Origin' },
        returnAddressSnapshot: { address: 'Return' },
        carrierAccountRef: 'goodsflow-center',
        supportedFulfillmentModes: ['in_house'],
      })
      .returning();
    await tx.update(wmsTables.skus).set({ deliveryProfileId: profile.id }).where(eq(wmsTables.skus.id, sku.id));
    const barcode = `880${suffix.replaceAll('-', '').slice(0, 10)}`;
    await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
    const [location] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `SCENARIO-Z-${suffix}`, locationType: 'zone' })
      .returning();
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: location.id,
      stockState: 'ON_HAND',
      qty: stockQty,
    });

    const items: ScenarioItem[] = [];
    for (const [index, qty] of demands.entries()) {
      const [salesOrder] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: `scenario-order-${index}-${suffix}`,
          salesChannel: options.channels?.[index] ?? 'medusa',
          status: 'confirmed',
          shippingAddress: {
            recipientName: `Recipient ${index}`,
            phone: '010-1111-2222',
            postalCode: '01234',
            roadAddress: 'Seoul road 1',
            detailAddress: '101',
          },
          orderDate: new Date(),
        })
        .returning();
      const [salesOrderLine] = await tx
        .insert(wmsTables.salesOrderLines)
        .values({
          salesOrderId: salesOrder.id,
          variantId: randomUUID(),
          productName: 'Scenario product',
          quantity: qty,
          channelOrderItemId: `channel-item-${index}-${suffix}`,
          channelProductId: `channel-product-${index}-${suffix}`,
        })
        .returning();
      const [fulfillmentOrder] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: salesOrder.id,
          warehouseId: warehouse.id,
          status: 'processing',
          fulfillmentMode: 'in_house',
          totalQty: qty,
        })
        .returning();
      const reservedQty = reserved[index] ?? 0;
      const [fulfillmentOrderItem] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({
          fulfillmentOrderId: fulfillmentOrder.id,
          salesOrderId: salesOrder.id,
          salesOrderLineId: salesOrderLine.id,
          skuId: sku.id,
          qty,
          reservedQty,
          status: 'processing',
        })
        .returning();
      const [shipment] = await tx
        .insert(wmsTables.shipments)
        .values({
          warehouseId: warehouse.id,
          status: 'draft',
          shippingProfileId: profile.id,
          recipientSnapshot: {
            recipientName: `Recipient ${index}`,
            phone: '010-1111-2222',
            postalCode: '01234',
            roadAddress: 'Seoul road 1',
            detailAddress: '101',
          },
          plannedAt: new Date(),
        })
        .returning();
      const [line] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: shipment.id,
          fulfillmentOrderItemId: fulfillmentOrderItem.id,
          skuId: sku.id,
          qty,
          reservedQty,
        })
        .returning();
      let reservationId: string | undefined;
      if (reservedQty > 0) {
        const [reservation] = await tx
          .insert(wmsTables.stockReservations)
          .values({
            targetType: 'SHIPMENT_LINE',
            targetId: line.id,
            shipmentLineId: line.id,
            skuId: sku.id,
            warehouseId: warehouse.id,
            quantity: reservedQty,
            status: 'confirmed',
            requestedAt: new Date(),
          })
          .returning();
        reservationId = reservation.id;
      }
      items.push({
        salesOrderId: salesOrder.id,
        salesOrderLineId: salesOrderLine.id,
        fulfillmentOrderId: fulfillmentOrder.id,
        fulfillmentOrderItemId: fulfillmentOrderItem.id,
        shipmentId: shipment.id,
        shipmentLineId: line.id,
        reservationId,
        qty,
      });
    }
    return {
      warehouseId: warehouse.id,
      locationId: location.id,
      skuId: sku.id,
      profileId: profile.id,
      barcode,
      stockQty,
      items,
      outboxAggregateIds: items.flatMap((item) => [item.shipmentId, item.fulfillmentOrderId]),
    };
  }

  async function checkpoint(
    tx: DbTx,
    world: ScenarioWorld,
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
      fulfillmentOrderIds: world.items.map((item) => item.fulfillmentOrderId),
      skuId: world.skuId,
      warehouseId: world.warehouseId,
      outboxAggregateIds: world.outboxAggregateIds,
      expected: checkpointExpected,
    });
    await expectExactOutboxTopology(tx, world, expected);
  }

  async function expectExactOutboxTopology(
    tx: DbTx,
    world: ScenarioWorld,
    expected: ExpectedOutboxTopology,
  ): Promise<void> {
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
    const encode = (row: {
      topic: string;
      eventType: string;
      aggregateType: string;
      aggregateId: string;
      idempotencyKey: string;
    }) => `${row.topic}|${row.eventType}|${row.aggregateType}|${row.aggregateId}|${row.idempotencyKey}`;
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

  function productionServices(tx: DbTx) {
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
    const authorization = {
      getScopesByRoles: () =>
        Promise.resolve(
          new Set([
            FULFILLMENT_SCOPE.SHIPMENT_REOPEN,
            FULFILLMENT_SCOPE.SHIPMENT_CONSOLIDATE,
            FULFILLMENT_SCOPE.SHIPMENT_OVERRIDE_RECIPIENT,
          ]),
        ),
    } as never;
    const logistics = wireLogistics(dbService, 'v2');
    const localPlanning = new ShipmentPlanningService(
      dbService,
      commands,
      logistics.shipmentReservations,
      invariant,
      audit,
      authorization,
      workflow,
    );
    const localConsolidation = new ConsolidationService(
      dbService,
      commands,
      logistics.shipmentReservations,
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
          serviceId: `service-${randomUUID()}`,
          invoiceNumber: `tracking-${randomUUID()}`,
          carrierCode: 'CJ',
        }),
      ),
      cancelInvoice: jest.fn().mockResolvedValue(undefined),
      queryInvoice: jest.fn().mockResolvedValue({ status: 'found', tracking: { status: 'canceled' } }),
    };
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (token === ConsolidationService) return localConsolidation;
        if (token === ShipmentPlanningService) return localPlanning;
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
    const shipmentReservations = new ShipmentReservationService(
      dbService,
      new UnifiedReservationService(dbService, sellable),
      new FulfillmentProgressService(),
      invariant,
    );
    const sessions = new BatchInventorySessionService(dbService, controlled, audit);
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
    return { planning: localPlanning, consolidation: localConsolidation, invoices, dispatch, provider, sessions };
  }

  async function replaceLineWithSplit(
    tx: DbTx,
    world: ScenarioWorld,
    item: ScenarioItem,
    quantities: number[],
    reserved: number[],
  ): Promise<ScenarioItem[]> {
    expect(quantities).toHaveLength(2);
    const [sourceLine] = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.id, item.shipmentLineId));
    const resultDto = await planning.split(
      item.shipmentId,
      {
        expectedManifestVersion: 1,
        reason: 'release scenario split',
        moves: [
          {
            shipmentLineId: item.shipmentLineId,
            expectedLineVersion: sourceLine.lineVersion,
            qty: quantities[1],
          },
        ],
      },
      `scenario-split-${randomUUID()}`,
      actor,
      tx,
    );
    const result: ScenarioItem[] = [];
    for (const [index, shipmentId] of [resultDto.source.shipmentId, resultDto.target.shipmentId].entries()) {
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(
          and(
            eq(wmsTables.shipmentLines.shipmentId, shipmentId),
            eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.fulfillmentOrderItemId),
          ),
        );
      const reservation = await tx.query.stockReservations.findFirst({
        where: (row, { and, eq }) => and(eq(row.shipmentLineId, line.id), eq(row.status, 'confirmed')),
      });
      expect(line).toMatchObject({ qty: quantities[index], reservedQty: reserved[index] });
      result.push({ ...item, shipmentId, shipmentLineId: line.id, reservationId: reservation?.id, qty: line.qty });
      world.outboxAggregateIds.push(shipmentId);
    }
    world.items.splice(world.items.indexOf(item), 1, ...result);
    return result;
  }

  async function planShipment(tx: DbTx, world: ScenarioWorld, shipmentId: string) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    if (shipment.status === 'planned') return shipment;
    await productionServices(tx).planning.plan(
      shipmentId,
      {
        shippingProfileId: world.profileId,
        expectedManifestVersion: shipment.manifestVersion,
        expectedReservationVersion: shipment.reservationVersion,
      },
      `scenario-plan-${randomUUID()}`,
      actor,
      tx,
    );
    return (await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId)))[0];
  }

  async function issueInvoiceViaOrchestrator(tx: DbTx, shipmentId: string) {
    const services = productionServices(tx);
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    const accepted = await services.invoices.issueForShipment(
      shipmentId,
      {
        expectedManifestVersion: shipment.manifestVersion,
        provider: 'goodsflow',
        carrierCode: 'CJ',
        reason: 'release scenario label issue',
      },
      `scenario-issue-${randomUUID()}`,
      actor,
      tx,
    );
    await services.invoices.processOperation(accepted.operationId);
    const operation = await services.invoices.getOperation(accepted.operationId, tx);
    expect(operation.status).toBe('succeeded');
    return operation;
  }

  async function seedIssuedInvoice(tx: DbTx, shipmentId: string, fulfillmentOrderId: string) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    const [invoice] = await tx
      .insert(wmsTables.invoices)
      .values({
        trackingNo: `scenario-tracking-${randomUUID()}`,
        carrier: 'CJ',
        issueMethod: 'self',
        externalServiceId: `scenario-service-${randomUUID()}`,
        issuedForFulfillmentOrderId: fulfillmentOrderId,
        shipmentId,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalShipmentRecipientHash(shipment.recipientSnapshot),
        status: 'issued',
      })
      .returning();
    return invoice;
  }

  async function preparePackingAndDispatch(
    tx: DbTx,
    world: ScenarioWorld,
    shipmentId: string,
    options: { issueViaService?: boolean } = {},
  ) {
    const shipment = await planShipment(tx, world, shipmentId);
    const lines = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
    const firstItem = world.items.find((item) => item.fulfillmentOrderItemId === lines[0].fulfillmentOrderItemId)!;
    if (options.issueViaService) await issueInvoiceViaOrchestrator(tx, shipmentId);
    else await seedIssuedInvoice(tx, shipmentId, firstItem.fulfillmentOrderId);
    const actorId = actor.id;
    const [ledger] = await tx
      .select()
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, world.skuId),
          eq(wmsTables.stockLedgers.warehouseId, world.warehouseId),
          eq(wmsTables.stockLedgers.locationId, world.locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `SCENARIO-DISPATCH-${randomUUID()}`,
        warehouseId: world.warehouseId,
        pickingMethod: 'individual',
        status: 'picking',
      })
      .returning();
    await tx.insert(wmsTables.outboundBatchWorkItems).values({
      batchId: batch.id,
      shipmentId,
      status: 'packing',
      packerId: actorId,
      packerClaimedAt: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      leaseVersion: 1,
    });
    const [pickPlan] = await tx
      .insert(wmsTables.pickingPlans)
      .values({ batchId: batch.id, strategy: 'discrete', status: 'active', createdBy: actorId })
      .returning();
    await tx.insert(wmsTables.pickingPlanMembers).values({
      planId: pickPlan.id,
      shipmentId,
      manifestVersion: shipment.manifestVersion,
      reservationVersion: shipment.reservationVersion,
    });
    await tx.insert(wmsTables.pickingSourceAllocations).values(
      lines.map((line) => ({
        planId: pickPlan.id,
        shipmentLineId: line.id,
        sourceLocationId: world.locationId,
        qty: line.qty,
        sourceStockVersion: ledger.version,
      })),
    );
    const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
    const lastLine = lines.at(-1)!;
    for (const line of lines) {
      await tx
        .update(wmsTables.shipmentLines)
        .set({ inspectedQty: line.id === lastLine.id ? line.qty - 1 : line.qty })
        .where(eq(wmsTables.shipmentLines.id, line.id));
    }
    const [session] = await tx
      .insert(wmsTables.batchInventorySessions)
      .values({ batchId: batch.id, status: 'active', handedInQty: totalQty })
      .returning();
    await tx.insert(wmsTables.batchInventorySessionEvents).values({
      sessionId: session.id,
      idempotencyKey: `start:${pickPlan.id}`,
      eventType: 'HAND_IN',
      skuId: world.skuId,
      quantity: totalQty,
      toCustodyType: 'AT_SOURCE',
      toSourceLocationId: world.locationId,
      payload: { planId: pickPlan.id, sequence: 0, requestHash: 'a'.repeat(64), actorId },
    });
    const balances = lines.flatMap((line) => {
      const packingQty = line.id === lastLine.id ? 1 : 0;
      return [
        ...(packingQty
          ? [
              {
                sessionId: session.id,
                skuId: world.skuId,
                sourceLocationId: world.locationId,
                custodyType: 'PACKING' as const,
                custodyRef: `work-item:${shipmentId}`,
                shipmentLineId: line.id,
                qty: packingQty,
              },
            ]
          : []),
        ...(line.qty - packingQty > 0
          ? [
              {
                sessionId: session.id,
                skuId: world.skuId,
                sourceLocationId: world.locationId,
                custodyType: 'PACKED' as const,
                custodyRef: `work-item:${shipmentId}`,
                shipmentLineId: line.id,
                qty: line.qty - packingQty,
              },
            ]
          : []),
      ];
    });
    await tx.insert(wmsTables.batchInventorySessionBalances).values(balances);
    const result = await productionServices(tx).dispatch.inspectionScan(shipmentId, {
      barcode: world.barcode,
      quantity: 1,
      actor: { id: actorId, roles: ['logistics_worker'] },
      idempotencyKey: `scenario-last-scan-${randomUUID()}`,
    });
    expect(result).toMatchObject({ status: 'shipped', attemptNo: 1 });
    return result;
  }

  async function consolidate(
    tx: DbTx,
    world: ScenarioWorld,
    sources: ScenarioItem[],
    recipient: Record<string, unknown> = {
      recipientName: 'New recipient',
      phone: '010-9999-9999',
      postalCode: '01234',
      roadAddress: 'Seoul override road 1',
      detailAddress: '202',
    },
  ) {
    const response = await consolidation.consolidate(
      {
        sources: sources.map((source) => ({
          shipmentId: source.shipmentId,
          expectedManifestVersion: 1,
          expectedReservationVersion: 1,
        })),
        recipientSnapshot: recipient,
        reason: 'release scenario consolidation',
      },
      `scenario-consolidate-${randomUUID()}`,
      actor,
      tx,
    );
    const [target] = await tx
      .select()
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, response.targetShipmentId!));
    const [operation] = await tx
      .select()
      .from(wmsTables.shipmentOperations)
      .where(eq(wmsTables.shipmentOperations.id, response.operationId));
    const targets: ScenarioItem[] = [];
    for (const source of sources) {
      const [line] = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(
          and(
            eq(wmsTables.shipmentLines.shipmentId, target.id),
            eq(wmsTables.shipmentLines.fulfillmentOrderItemId, source.fulfillmentOrderItemId),
          ),
        );
      const reservation = await tx.query.stockReservations.findFirst({
        where: (row, { and, eq }) => and(eq(row.shipmentLineId, line.id), eq(row.status, 'confirmed')),
      });
      targets.push({ ...source, shipmentId: target.id, shipmentLineId: line.id, reservationId: reservation?.id });
    }
    for (const source of sources) world.items.splice(world.items.indexOf(source), 1);
    world.items.push(...targets);
    world.outboxAggregateIds.push(target.id);
    return { target, operation, targets };
  }

  it('01. splits reserved A/backordered B and dispatches A first', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, { reserved: [6] });
      const [a, b] = await replaceLineWithSplit(tx, world, world.items[0], [6, 4], [6, 0]);
      await checkpoint(tx, world, {
        onHandQty: 20,
        reservedQty: 6,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      const dispatched = await preparePackingAndDispatch(tx, world, a.shipmentId);
      await checkpoint(tx, world, {
        onHandQty: 14,
        reservedQty: 0,
        outboxCount: 2,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [dispatched.dispatchAttemptId!],
      });
      expect(
        (await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, b.shipmentId)))[0].status,
      ).toBe('draft');
    });
  });

  it('02. dispatches FOI 10 as 6/4 with two invoices and attempts', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, { reserved: [6] });
      const [first, second] = await replaceLineWithSplit(tx, world, world.items[0], [6, 4], [6, 0]);
      const reservedRemainder = await wired.shipmentReservations.reservePartial(second.shipmentLineId, 4, tx);
      second.reservationId = reservedRemainder.reservationIds[0];
      await checkpoint(tx, world, {
        onHandQty: 20,
        reservedQty: 10,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      const firstDispatch = await preparePackingAndDispatch(tx, world, first.shipmentId, { issueViaService: true });
      await checkpoint(tx, world, {
        onHandQty: 14,
        reservedQty: 4,
        outboxCount: 2,
        inventoryOutboxCount: 1,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 1,
        shipEventCount: 1,
        dispatchAttemptIds: [firstDispatch.dispatchAttemptId!],
      });
      const secondDispatch = await preparePackingAndDispatch(tx, world, second.shipmentId, { issueViaService: true });
      await checkpoint(tx, world, {
        onHandQty: 10,
        reservedQty: 0,
        outboxCount: 5,
        inventoryOutboxCount: 2,
        dispatchAttemptCount: 2,
        dispatchSourceCount: 2,
        shipEventCount: 2,
        dispatchAttemptIds: [firstDispatch.dispatchAttemptId!, secondDispatch.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: [first.fulfillmentOrderId],
      });
      expect(
        (
          await tx
            .select()
            .from(wmsTables.dispatchAttempts)
            .where(inArray(wmsTables.dispatchAttempts.shipmentId, [first.shipmentId, second.shipmentId]))
        ).length,
      ).toBe(2);
      expect(
        (
          await tx
            .select()
            .from(wmsTables.invoices)
            .where(inArray(wmsTables.invoices.shipmentId, [first.shipmentId, second.shipmentId]))
        ).length,
      ).toBe(2);
    });
  });

  it('03. consolidates two FO shipments with recipient override, lineage and invoice void', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, { demands: [3, 2] });
      const sources = [...world.items];
      await planShipment(tx, world, sources[0].shipmentId);
      await issueInvoiceViaOrchestrator(tx, sources[0].shipmentId);
      const [activeInvoice] = await tx
        .select()
        .from(wmsTables.invoices)
        .where(eq(wmsTables.invoices.shipmentId, sources[0].shipmentId));
      const authorizedRecipient = {
        recipientName: 'Authorized override',
        phone: '010-9999-9999',
        postalCode: '01234',
        roadAddress: 'Seoul override road 1',
        detailAddress: '202',
      };
      const services = productionServices(tx);
      const sourceShipments = await tx
        .select()
        .from(wmsTables.shipments)
        .where(
          inArray(
            wmsTables.shipments.id,
            sources.map((source) => source.shipmentId),
          ),
        );
      const pending = await services.consolidation.consolidate(
        {
          sources: sourceShipments.map((shipment) => ({
            shipmentId: shipment.id,
            expectedManifestVersion: shipment.manifestVersion,
            expectedReservationVersion: shipment.reservationVersion,
          })),
          recipientSnapshot: authorizedRecipient,
          reason: 'void issued source label then consolidate',
        },
        `scenario-pending-consolidation-${randomUUID()}`,
        actor,
        tx,
      );
      expect(pending).toMatchObject({ operationStatus: 'pending', targetShipmentId: null });
      const voidOperation = await services.invoices.void(
        activeInvoice.id,
        { reason: 'consolidation source label replacement', resumeOperationId: pending.operationId },
        `scenario-consolidation-void-${randomUUID()}`,
        actor,
        tx,
      );
      await services.invoices.processOperation(voidOperation.operationId);
      const result = await services.consolidation.resumePending(pending.operationId, tx);
      const [target] = await tx
        .select()
        .from(wmsTables.shipments)
        .where(eq(wmsTables.shipments.id, result.targetShipmentId!));
      const targetLines = await tx
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.shipmentId, target.id));
      world.items = await Promise.all(
        sources.map(async (source) => {
          const line = targetLines.find(
            (candidate) => candidate.fulfillmentOrderItemId === source.fulfillmentOrderItemId,
          )!;
          const reservation = await tx.query.stockReservations.findFirst({
            where: (row, { and, eq }) => and(eq(row.shipmentLineId, line.id), eq(row.status, 'confirmed')),
          });
          return { ...source, shipmentId: target.id, shipmentLineId: line.id, reservationId: reservation?.id };
        }),
      );
      world.outboxAggregateIds.push(target.id);
      await checkpoint(tx, world, {
        onHandQty: 20,
        reservedQty: 5,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      expect(targetLines).toHaveLength(2);
      expect(
        (
          await tx
            .select()
            .from(wmsTables.shipmentOperationMembers)
            .where(eq(wmsTables.shipmentOperationMembers.operationId, result.operationId))
        ).length,
      ).toBe(3);
      expect(target.recipientSnapshot).toEqual(authorizedRecipient);
      expect(
        (await tx.select().from(wmsTables.invoices).where(eq(wmsTables.invoices.id, activeInvoice.id)))[0].status,
      ).toBe('voided');
    });
  });

  it('04. cancels one consolidated source SO then voids, replans and reissues the survivor', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, { demands: [3, 2] });
      const { target, targets } = await consolidate(tx, world, [...world.items]);
      const canceled = targets[0];
      await planShipment(tx, world, target.id);
      await issueInvoiceViaOrchestrator(tx, target.id);
      const [issuedBeforeCancellation] = await tx
        .select()
        .from(wmsTables.invoices)
        .where(and(eq(wmsTables.invoices.shipmentId, target.id), eq(wmsTables.invoices.status, 'issued')));
      const [plannedTarget] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, target.id));
      const pendingCancellation = await productionServices(tx).planning.cancelOutstanding(
        target.id,
        {
          expectedManifestVersion: plannedTarget.manifestVersion,
          reason: 'one source sales order canceled after consolidation',
          lines: [
            {
              shipmentLineId: canceled.shipmentLineId,
              expectedLineVersion: (
                await tx
                  .select()
                  .from(wmsTables.shipmentLines)
                  .where(eq(wmsTables.shipmentLines.id, canceled.shipmentLineId))
              )[0].lineVersion,
              qty: canceled.qty,
            },
          ],
        },
        `scenario-cancel-consolidated-${randomUUID()}`,
        actor,
        tx,
      );
      expect(pendingCancellation.operationStatus).toBe('pending');
      const services = productionServices(tx);
      const voidOperation = await services.invoices.void(
        issuedBeforeCancellation.id,
        { reason: 'cancel source order and replan target', resumeOperationId: pendingCancellation.operationId },
        `scenario-cancel-void-${randomUUID()}`,
        actor,
        tx,
      );
      await services.invoices.processOperation(voidOperation.operationId);
      await services.planning.resumePendingCancellation(pendingCancellation.operationId, tx);
      await planShipment(tx, world, target.id);
      await issueInvoiceViaOrchestrator(tx, target.id);
      await checkpoint(tx, world, {
        onHandQty: 20,
        reservedQty: 2,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      const invoices = await tx.select().from(wmsTables.invoices).where(eq(wmsTables.invoices.shipmentId, target.id));
      expect(invoices.map((invoice) => invoice.status).sort()).toEqual(['issued', 'voided']);
      expect(invoices.find((invoice) => invoice.status === 'issued')?.manifestVersion).toBeGreaterThan(
        issuedBeforeCancellation.manifestVersion!,
      );
    });
  });

  it('05. consolidates cross-channel orders only within warehouse/profile and retains per-channel routing', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, { demands: [2, 2], channels: ['medusa', 'naver'] });
      const orders = [...world.items];
      const { target } = await consolidate(tx, world, [...world.items]);
      await checkpoint(tx, world, {
        onHandQty: 20,
        reservedQty: 4,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      const dispatched = await preparePackingAndDispatch(tx, world, target.id, { issueViaService: true });
      const [event] = await tx
        .select()
        .from(wmsTables.outboxEvents)
        .where(and(eq(wmsTables.outboxEvents.aggregateId, target.id), eq(wmsTables.outboxEvents.topic, ACTIVE_TOPIC)));
      const routedOrders = (event.payload as { orders: Array<{ salesOrderId: string; salesChannel: string }> }).orders;
      expect(routedOrders.map((order) => order.salesOrderId).sort()).toEqual(
        orders.map((order) => order.salesOrderId).sort(),
      );
      expect(new Set(routedOrders.map((order) => order.salesChannel))).toEqual(new Set(['medusa', 'naver']));
      await checkpoint(tx, world, {
        onHandQty: 16,
        reservedQty: 0,
        outboxCount: 5,
        inventoryOutboxCount: 2,
        dispatchAttemptCount: 1,
        dispatchSourceCount: 2,
        shipEventCount: 2,
        dispatchAttemptIds: [dispatched.dispatchAttemptId!],
        fullyShippedFulfillmentOrderIds: orders.map((order) => order.fulfillmentOrderId),
      });
    });
  });
});
