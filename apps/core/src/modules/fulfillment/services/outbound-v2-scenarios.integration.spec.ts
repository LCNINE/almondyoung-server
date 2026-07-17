import { randomUUID } from 'crypto';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
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
import {
  assertOutboundV2Checkpoint,
  expectExactOutboxTopology,
  inRollbackTx,
  makeDb,
  makeDbService,
  wireLogistics,
  Wired,
  type ExpectedOutboxTopology,
} from './__support__';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { ConsolidationService } from './consolidation.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { WaybillManager } from '../waybill/waybill.manager';
import { WaybillReader } from '../waybill/waybill.reader';
import { WaybillRepository } from '../waybill/waybill.repository';
import { WaybillService } from '../waybill/waybill.service';

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
    // 플랜3: dispatch 는 WaybillService.assertDispatchable/markUsed 를, consolidation void 시나리오는
    // WaybillService.void(commands+repo+reader) 를 소비한다. carrier registry/issue machine/config 는 이
    // 경로들에서 호출되지 않아 stub 으로 충분(shipment-dispatch/recall.integration.spec 패턴).
    const waybillRepo = new WaybillRepository(dbService);
    const waybills = new WaybillService(
      new WaybillManager(
        new WaybillReader(dbService),
        waybillRepo,
        {} as never,
        {} as never,
        commands,
        {} as never,
        dbService,
      ),
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
      waybills,
      new BarcodeService(dbService),
      new FulfillmentOutboxService(dbService),
      audit,
      workflow,
    );
    return { planning: localPlanning, consolidation: localConsolidation, waybills, dispatch, sessions };
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

  // 플랜3: dispatch 는 issued invoice 대신 registered waybill 을 소비한다(assertDispatchable→markUsed). 활성
  // waybill 이 이미 있으면(재발급) voided 로 종료한 뒤 최신 manifest 로 재시딩한다.
  async function seedRegisteredWaybill(tx: DbTx, shipmentId: string) {
    const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId));
    await tx
      .update(wmsTables.waybills)
      .set({ status: 'voided', voidedAt: new Date() })
      .where(
        and(
          eq(wmsTables.waybills.shipmentId, shipmentId),
          notInArray(wmsTables.waybills.status, ['voided', 'failed', 'abandoned']),
        ),
      );
    const [waybill] = await tx
      .insert(wmsTables.waybills)
      .values({
        shipmentId,
        source: 'manual',
        carrier: 'HANJIN',
        status: 'registered',
        trackingNo: `scenario-tracking-${randomUUID()}`,
        manifestVersion: shipment.manifestVersion,
        recipientHash: canonicalFulfillmentRequestHash(shipment.recipientSnapshot),
      })
      .returning();
    return waybill;
  }

  async function preparePackingAndDispatch(tx: DbTx, world: ScenarioWorld, shipmentId: string) {
    const shipment = await planShipment(tx, world, shipmentId);
    const lines = await tx
      .select()
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
    await seedRegisteredWaybill(tx, shipmentId);
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

  it('02. dispatches FOI 10 as 6/4 with two waybills and attempts', async () => {
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
      const firstDispatch = await preparePackingAndDispatch(tx, world, first.shipmentId);
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
      const secondDispatch = await preparePackingAndDispatch(tx, world, second.shipmentId);
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
      // 플랜3: dispatch 가 각 shipment 의 registered waybill 을 used 로 전이시킨다(구 2 invoice = 2 waybill).
      const dispatchedWaybills = await tx
        .select()
        .from(wmsTables.waybills)
        .where(inArray(wmsTables.waybills.shipmentId, [first.shipmentId, second.shipmentId]));
      expect(dispatchedWaybills).toHaveLength(2);
      expect(dispatchedWaybills.every((waybill) => waybill.status === 'used')).toBe(true);
    });
  });

  it('03. consolidates two FO shipments with recipient override, lineage and waybill void', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, { demands: [3, 2] });
      const sources = [...world.items];
      await planShipment(tx, world, sources[0].shipmentId);
      // 활성(registered) waybill 이 consolidation 의 ACTIVE_INVOICE blocker 를 건다(구 issued invoice 계승).
      const activeWaybill = await seedRegisteredWaybill(tx, sources[0].shipmentId);
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
      // waybill void 는 동기 tx-local(carrier HTTP 없음) — 구 async invoice-void→resume saga 를 대체한다.
      await services.waybills.void(
        activeWaybill.id,
        { reason: 'consolidation source label replacement' },
        `scenario-consolidation-void-${randomUUID()}`,
        actor,
        tx,
      );
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
        (await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, activeWaybill.id)))[0].status,
      ).toBe('voided');
    });
  });

  it('04. cancels one consolidated source SO then voids, replans and reissues the survivor', async () => {
    await inRollbackTx(db, async (tx) => {
      const world = await seedWorld(tx, { demands: [3, 2] });
      const { target, targets } = await consolidate(tx, world, [...world.items]);
      const canceled = targets[0];
      await planShipment(tx, world, target.id);
      const issuedBeforeCancellation = await seedRegisteredWaybill(tx, target.id);
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
      // waybill void 는 동기 tx-local — 구 async invoice-void→resume saga 를 대체한다.
      await services.waybills.void(
        issuedBeforeCancellation.id,
        { reason: 'cancel source order and replan target' },
        `scenario-cancel-void-${randomUUID()}`,
        actor,
        tx,
      );
      await services.planning.resumePendingCancellation(pendingCancellation.operationId, tx);
      await planShipment(tx, world, target.id);
      // replan 후 최신 manifest 로 registered waybill 재발급(voided 옛 waybill 과 공존).
      await seedRegisteredWaybill(tx, target.id);
      await checkpoint(tx, world, {
        onHandQty: 20,
        reservedQty: 2,
        outboxCount: 0,
        inventoryOutboxCount: 0,
        dispatchAttemptCount: 0,
        dispatchSourceCount: 0,
        shipEventCount: 0,
      });
      const waybills = await tx.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, target.id));
      expect(waybills.map((waybill) => waybill.status).sort()).toEqual(['registered', 'voided']);
      expect(waybills.find((waybill) => waybill.status === 'registered')?.manifestVersion).toBeGreaterThan(
        issuedBeforeCancellation.manifestVersion,
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
      const dispatched = await preparePackingAndDispatch(tx, world, target.id);
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
