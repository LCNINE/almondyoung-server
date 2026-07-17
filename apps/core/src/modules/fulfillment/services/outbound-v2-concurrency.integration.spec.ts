import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
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
import { makeDbService, wireLogistics } from './__support__';
import { canonicalFulfillmentRequestHash, FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ShipmentPlanningService } from './shipment-planning.service';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { ShipmentReservationService } from './shipment-reservation.service';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { ShipmentRecallService } from './shipment-recall.service';
import { WaybillManager } from '../waybill/waybill.manager';
import { WaybillReader } from '../waybill/waybill.reader';
import { WaybillRepository } from '../waybill/waybill.repository';
import { WaybillService } from '../waybill/waybill.service';
import { FULFILLMENT_SCOPE } from '../../../platform/auth/fulfillment-scopes';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Database = PostgresJsDatabase<typeof wmsSchema>;

/**
 * Release-gate concurrency proof.
 *
 * Every race is held behind a real PostgreSQL row lock. We do not release the
 * blocker until pg_stat_activity proves that both independent command sessions
 * are waiting on a lock. This makes the interleaving deterministic without a
 * timing sleep and proves that the production transaction boundary, not Jest's
 * scheduling, serializes the commands.
 */
describeIfDb('Outbound V2 concurrency release gate (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let observer: postgres.Sql;
  let db: Database;

  beforeAll(() => {
    observer = postgres(DATABASE_URL as string, { max: 1, connection: { application_name: 'outbound-v2-observer' } });
    db = drizzle(observer, { schema: wmsSchema });
  });

  afterAll(async () => observer.end());

  function isolatedDb(applicationName: string) {
    const client = postgres(DATABASE_URL as string, {
      max: 1,
      connection: { application_name: applicationName },
    });
    return { client, db: drizzle(client, { schema: wmsSchema }) };
  }

  async function waitForLockWaiters(applicationPrefix: string, expected: number): Promise<void> {
    for (let observation = 0; observation < 2_000; observation += 1) {
      const [row] = await observer<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
          AND application_name LIKE ${`${applicationPrefix}%`}
          AND wait_event_type = 'Lock'
      `;
      if (Number(row?.count ?? 0) >= expected) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Both ${applicationPrefix} contenders did not reach the PostgreSQL lock barrier`);
  }

  async function raceBehindLock<T>(args: {
    applicationPrefix: string;
    lock: (tx: DbTx) => Promise<unknown>;
    first: (database: Database) => Promise<T>;
    second: (database: Database) => Promise<T>;
  }): Promise<PromiseSettledResult<T>[]> {
    const blocker = isolatedDb(`${args.applicationPrefix}-blocker`);
    const first = isolatedDb(`${args.applicationPrefix}-first`);
    const second = isolatedDb(`${args.applicationPrefix}-second`);
    let release!: () => void;
    let locked!: () => void;
    const releaseGate = new Promise<void>((resolve) => (release = resolve));
    const lockedGate = new Promise<void>((resolve) => (locked = resolve));
    const blockerTx = blocker.db.transaction(async (rawTx) => {
      await args.lock(rawTx as unknown as DbTx);
      locked();
      await releaseGate;
    });
    let race: Promise<PromiseSettledResult<T>[]> | undefined;

    try {
      await lockedGate;
      race = Promise.allSettled([args.first(first.db), args.second(second.db)]);
      await waitForLockWaiters(args.applicationPrefix, 2);
      release();
      await blockerTx;
      return await race;
    } finally {
      release();
      await blockerTx.catch(() => undefined);
      await race?.catch(() => undefined);
      await Promise.all([blocker.client.end(), first.client.end(), second.client.end()]);
    }
  }

  async function seedReservationFixture(quantity: number, stock: number, reserved = 0) {
    return db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const suffix = randomUUID();
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `v2-race-wh-${suffix}` })
        .returning();
      const [location] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: `v2-race-loc-${suffix}`, locationType: 'zone' })
        .returning();
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `v2-race-holder-${suffix}` })
        .returning();
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'V2 race SKU', code: `V2-RACE-${suffix}`, holderId: holder.id })
        .returning();
      await tx.insert(wmsTables.stockLedgers).values({
        skuId: sku.id,
        warehouseId: warehouse.id,
        locationId: location.id,
        stockState: 'ON_HAND',
        qty: stock,
      });
      const [fo] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          warehouseId: warehouse.id,
          status: reserved ? 'partially_reserved' : 'created',
          totalItems: 1,
          totalQty: quantity,
          totalReservedQty: reserved,
        })
        .returning();
      const [item] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: fo.id, skuId: sku.id, qty: quantity, reservedQty: reserved })
        .returning();
      const [shipment] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: warehouse.id, status: 'draft', reservationVersion: 1 })
        .returning();
      const [line] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: shipment.id,
          fulfillmentOrderItemId: item.id,
          skuId: sku.id,
          qty: quantity,
          reservedQty: reserved,
        })
        .returning();
      if (reserved > 0) {
        await tx.insert(wmsTables.stockReservations).values({
          targetType: 'SHIPMENT_LINE',
          targetId: line.id,
          shipmentLineId: line.id,
          skuId: sku.id,
          warehouseId: warehouse.id,
          quantity: reserved,
          status: 'confirmed',
          requestedAt: new Date('2026-07-15T00:00:00.000Z'),
        });
      }
      return { warehouse, location, holder, sku, fo, item, shipment, line, quantity, stock };
    });
  }

  async function cleanupReservationFixture(fixture: Awaited<ReturnType<typeof seedReservationFixture>>) {
    await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const shipmentRows = await tx
        .select({ id: wmsTables.shipments.id })
        .from(wmsTables.shipments)
        .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
        .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, fixture.item.id));
      const shipmentIds = shipmentRows.map((row) => row.id);
      const lineRows = shipmentIds.length
        ? await tx
            .select({ id: wmsTables.shipmentLines.id })
            .from(wmsTables.shipmentLines)
            .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds))
        : [];
      const lineIds = lineRows.map((row) => row.id);
      const memberRows = shipmentIds.length
        ? await tx
            .select({ operationId: wmsTables.shipmentOperationMembers.operationId })
            .from(wmsTables.shipmentOperationMembers)
            .where(inArray(wmsTables.shipmentOperationMembers.shipmentId, shipmentIds))
        : [];
      const operationIds = [...new Set(memberRows.map((row) => row.operationId))];
      if (operationIds.length) {
        await tx
          .delete(wmsTables.shipmentOperationMembers)
          .where(inArray(wmsTables.shipmentOperationMembers.operationId, operationIds));
        await tx.delete(wmsTables.shipmentOperations).where(inArray(wmsTables.shipmentOperations.id, operationIds));
      }
      if (lineIds.length) {
        await tx
          .delete(wmsTables.stockReservations)
          .where(inArray(wmsTables.stockReservations.shipmentLineId, lineIds));
        await tx.delete(wmsTables.shipmentLines).where(inArray(wmsTables.shipmentLines.id, lineIds));
      }
      if (shipmentIds.length) await tx.delete(wmsTables.shipments).where(inArray(wmsTables.shipments.id, shipmentIds));
      await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      await tx.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, fixture.fo.id));
      await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, fixture.sku.id));
      await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.sku.id));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holder.id));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.id, fixture.location.id));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
    });
  }

  function planningService(database: Database): ShipmentPlanningService {
    const dbService = makeDbService(database);
    const logistics = wireLogistics(dbService, 'v2');
    return new ShipmentPlanningService(
      dbService,
      new FulfillmentCommandService(dbService),
      logistics.shipmentReservations,
      new FulfillmentInvariantService(),
      new AuditService(dbService),
      { getScopesByRoles: () => Promise.resolve(new Set(['master'])) } as never,
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
    );
  }

  function batchService(database: Database): OutboundBatchOrchestrator {
    const dbService = makeDbService(database);
    const commands = new FulfillmentCommandService(dbService);
    const invariant = new FulfillmentInvariantService();
    const audit = new AuditService(dbService);
    const workflow = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' }));
    const moduleRef = { get: jest.fn(() => ({ resumePending: jest.fn() })) };
    return new OutboundBatchOrchestrator(
      dbService,
      commands,
      invariant,
      {} as never,
      audit,
      workflow,
      moduleRef as never,
    );
  }

  function conflictCode(result: PromiseSettledResult<unknown>): string | undefined {
    if (result.status !== 'rejected' || !(result.reason instanceof ConflictException)) return undefined;
    const response = result.reason.getResponse();
    return typeof response === 'object' && response !== null ? (response as { code?: string }).code : undefined;
  }

  async function expectFoiDemandConservation(args: {
    fulfillmentOrderItemId: string;
    expectedStatus: 'partially_reserved' | 'completed' | 'ready';
  }): Promise<void> {
    const [row] = await observer<
      {
        qty: number;
        shipped_qty: number;
        canceled_qty: number;
        active_line_qty: number;
        fo_status: string;
      }[]
    >`
      SELECT
        foi.qty::int AS qty,
        foi.shipped_qty::int AS shipped_qty,
        foi.canceled_qty::int AS canceled_qty,
        coalesce(sum(sl.qty) FILTER (WHERE s.status IN ('draft', 'planned', 'recovery_required')), 0)::int AS active_line_qty,
        fo.status::text AS fo_status
      FROM fulfillment_order_items foi
      JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
      LEFT JOIN shipment_lines sl ON sl.fulfillment_order_item_id = foi.id
      LEFT JOIN shipments s ON s.id = sl.shipment_id
      WHERE foi.id = ${args.fulfillmentOrderItemId}::uuid
      GROUP BY foi.id, fo.id
    `;
    expect(row.qty).toBe(row.shipped_qty + row.canceled_qty + row.active_line_qty);
    expect(row.fo_status).toBe(args.expectedStatus);
  }

  /**
   * Split happens before batch membership, so no session may exist for the
   * item yet. Prove that against the database rather than asserting the
   * zero-hand-in base case against itself.
   */
  async function expectNoSessionForItem(fulfillmentOrderItemId: string): Promise<void> {
    const [row] = await observer<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM batch_inventory_sessions bis
      JOIN outbound_batch_work_items obwi ON obwi.batch_id = bis.batch_id
      JOIN shipment_lines sl ON sl.shipment_id = obwi.shipment_id
      WHERE sl.fulfillment_order_item_id = ${fulfillmentOrderItemId}::uuid
    `;
    expect(row.count).toBe(0);
  }

  async function expectSessionConservation(sessionId: string): Promise<void> {
    const [row] = await observer<
      { handed_in: number; remaining: number; settled: number; returned: number; shortage: number }[]
    >`
      SELECT
        bis.handed_in_qty::int AS handed_in,
        coalesce(sum(bisb.qty) FILTER (WHERE bisb.custody_type <> 'SETTLED'), 0)::int AS remaining,
        bis.settled_qty::int AS settled,
        bis.returned_qty::int AS returned,
        bis.shortage_qty::int AS shortage
      FROM batch_inventory_sessions bis
      LEFT JOIN batch_inventory_session_balances bisb ON bisb.session_id = bis.id
      WHERE bis.id = ${sessionId}::uuid
      GROUP BY bis.id
    `;
    expect(row.handed_in).toBe(row.remaining + row.settled + row.returned + row.shortage);
  }

  function dispatchService(database: Database): ShipmentDispatchService {
    const dbService = makeDbService(database);
    const workflow = new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' }));
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const fulfillmentOutbox = new FulfillmentOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const controlled = new BatchControlledStockGuard();
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
      new FulfillmentInvariantService(),
    );
    const audit = new AuditService(dbService);
    // dispatch 는 WaybillService.assertDispatchable/markUsed 만 소비 — machine/registry/commands/config 는
    // 이 경로에서 호출되지 않아 stub 으로 충분(shipment-dispatch.integration.spec 패턴).
    const waybillRepo = new WaybillRepository(dbService);
    const waybills = new WaybillService(
      new WaybillManager(
        new WaybillReader(dbService),
        waybillRepo,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        dbService,
      ),
    );
    return new ShipmentDispatchService(
      dbService,
      new FulfillmentCommandService(dbService),
      inventory,
      new BatchInventorySessionService(dbService, controlled, audit),
      reservations,
      waybills,
      new BarcodeService(dbService),
      fulfillmentOutbox,
      audit,
      workflow,
    );
  }

  function recallService(database: Database, grantRecallScope = true): ShipmentRecallService {
    const dbService = makeDbService(database);
    const inventoryOutbox = new InventoryOutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, inventoryOutbox);
    const inventory = new InventoryCommandService(
      dbService,
      new StockEventStore(dbService, sellable),
      inventoryOutbox,
      new LocationService(dbService),
    );
    const reservations = new ShipmentReservationService(
      dbService,
      new UnifiedReservationService(dbService, sellable),
      new FulfillmentProgressService(),
      new FulfillmentInvariantService(),
    );
    // recall 은 실제 WaybillService.getActiveWaybill + voidForRecall(commands+repo+reader)를 소비한다 —
    // machine/registry/config 는 voidForRecall 경로에서 실행되지 않아 stub(shipment-recall.integration.spec 패턴).
    const waybillRepo = new WaybillRepository(dbService);
    const waybills = new WaybillService(
      new WaybillManager(
        new WaybillReader(dbService),
        waybillRepo,
        {} as never,
        {} as never,
        new FulfillmentCommandService(dbService),
        {} as never,
        dbService,
      ),
    );
    return new ShipmentRecallService(
      dbService,
      new FulfillmentCommandService(dbService),
      {
        getScopesByRoles: () => Promise.resolve(new Set(grantRecallScope ? [FULFILLMENT_SCOPE.DISPATCH_RECALL] : [])),
      } as never,
      waybills,
      inventory,
      reservations,
      new FulfillmentOutboxService(dbService),
      new AuditService(dbService),
      new FulfillmentWorkflowGate(new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2' })),
    );
  }

  async function seedDispatchFixture() {
    return db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const suffix = randomUUID();
      const actorId = randomUUID();
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `v2-dispatch-wh-${suffix}` })
        .returning();
      const [sourceLocation] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: `v2-dispatch-source-${suffix}`, locationType: 'zone' })
        .returning();
      const [reworkLocation] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId: warehouse.id,
          code: `v2-dispatch-rework-${suffix}`,
          locationType: 'zone',
          isSystem: true,
          systemRole: 'outbound_rework',
          isActive: true,
        })
        .returning();
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `v2-dispatch-holder-${suffix}` })
        .returning();
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'V2 dispatch race SKU', code: `V2-DISPATCH-${suffix}`, holderId: holder.id })
        .returning();
      const barcode = `88${suffix.replaceAll('-', '').slice(0, 11)}`;
      await tx.insert(wmsTables.skuBarcodes).values({ skuId: sku.id, barcode, isPrimary: true });
      const [ledger] = await tx
        .insert(wmsTables.stockLedgers)
        .values({
          skuId: sku.id,
          warehouseId: warehouse.id,
          locationId: sourceLocation.id,
          stockState: 'ON_HAND',
          qty: 2,
        })
        .returning();
      const [salesOrder] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: `v2-dispatch-order-${suffix}`,
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
          productName: 'V2 dispatch product',
          quantity: 2,
          channelOrderItemId: `v2-item-${suffix}`,
          channelProductId: `v2-product-${suffix}`,
        })
        .returning();
      const [fulfillmentOrder] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({
          salesOrderId: salesOrder.id,
          warehouseId: warehouse.id,
          status: 'processing',
          totalItems: 1,
          totalQty: 2,
          totalReservedQty: 2,
        })
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
      const recipientSnapshot = { recipientName: 'V2 Race', phone: '010-1111-2222' };
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
        requestedAt: new Date('2026-07-15T00:00:00.000Z'),
      });
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({
          batchNumber: `V2-DISPATCH-BATCH-${suffix}`,
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
        sourceLocationId: sourceLocation.id,
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
        toSourceLocationId: sourceLocation.id,
        payload: { planId: plan.id, sequence: 0, requestHash: 'a'.repeat(64), actorId },
      });
      await tx.insert(wmsTables.batchInventorySessionBalances).values([
        {
          sessionId: session.id,
          skuId: sku.id,
          sourceLocationId: sourceLocation.id,
          custodyType: 'PACKING',
          custodyRef: `work-item:${shipment.id}`,
          shipmentLineId: line.id,
          qty: 1,
        },
        {
          sessionId: session.id,
          skuId: sku.id,
          sourceLocationId: sourceLocation.id,
          custodyType: 'PACKED',
          custodyRef: `work-item:${shipment.id}`,
          shipmentLineId: line.id,
          qty: 1,
        },
      ]);
      // 플랜3: dispatch 는 registered waybill 을 소비한다(assertDispatchable→markUsed). recall 은 그 used
      // waybill 을 voidForRecall 로 되돌린다. manifestVersion/recipientHash 가 shipment 와 일치해야 통과.
      const [waybill] = await tx
        .insert(wmsTables.waybills)
        .values({
          shipmentId: shipment.id,
          source: 'manual',
          carrier: 'HANJIN',
          status: 'registered',
          trackingNo: `V2-TRACK-${suffix}`,
          manifestVersion: shipment.manifestVersion,
          recipientHash: canonicalFulfillmentRequestHash(recipientSnapshot),
        })
        .returning();
      return {
        actorId,
        barcode,
        batch,
        fulfillmentOrder,
        holder,
        waybill,
        item,
        ledger,
        line,
        plan,
        reworkLocation,
        salesOrder,
        salesOrderLine,
        session,
        shipment,
        sku,
        sourceLocation,
        warehouse,
        workItem,
      };
    });
  }

  async function cleanupDispatchFixture(
    fixture: Awaited<ReturnType<typeof seedDispatchFixture>>,
    commandKeys: readonly string[],
  ) {
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
      const sourceEventIds = sources.flatMap((source) => (source.stockEventId ? [source.stockEventId] : []));
      const reversalEvents = sourceEventIds.length
        ? await tx
            .select({ id: wmsTables.stockEvents.id })
            .from(wmsTables.stockEvents)
            .where(inArray(wmsTables.stockEvents.reversalOfEventId, sourceEventIds))
        : [];
      const allEventIds = [...sourceEventIds, ...reversalEvents.map((event) => event.id)];
      const journalIds = attempts.flatMap((attempt) =>
        [attempt.stockJournalId, attempt.reversalJournalId].filter((id): id is string => id !== null),
      );
      const memberRows = await tx
        .select({ operationId: wmsTables.shipmentOperationMembers.operationId })
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.shipmentId, fixture.shipment.id));
      const operationIds = [...new Set(memberRows.map((row) => row.operationId))];

      if (commandKeys.length)
        await tx
          .delete(wmsTables.fulfillmentCommandRequests)
          .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, [...commandKeys]));
      await tx.delete(wmsTables.auditLogs).where(eq(wmsTables.auditLogs.userId, fixture.actorId));
      const aggregateIds = [fixture.shipment.id, fixture.fulfillmentOrder.id, ...allEventIds];
      await tx.delete(wmsTables.outboxEvents).where(inArray(wmsTables.outboxEvents.aggregateId, aggregateIds));
      await tx.delete(wmsTables.shipmentTracking).where(eq(wmsTables.shipmentTracking.shipmentId, fixture.shipment.id));
      if (operationIds.length) {
        await tx
          .delete(wmsTables.shipmentOperationMembers)
          .where(inArray(wmsTables.shipmentOperationMembers.operationId, operationIds));
        await tx.delete(wmsTables.shipmentOperations).where(inArray(wmsTables.shipmentOperations.id, operationIds));
      }
      if (attemptIds.length) {
        await tx
          .delete(wmsTables.dispatchAttemptSources)
          .where(inArray(wmsTables.dispatchAttemptSources.dispatchAttemptId, attemptIds));
        await tx.delete(wmsTables.dispatchAttempts).where(inArray(wmsTables.dispatchAttempts.id, attemptIds));
      }
      if (reversalEvents.length)
        await tx.delete(wmsTables.stockEvents).where(
          inArray(
            wmsTables.stockEvents.id,
            reversalEvents.map((event) => event.id),
          ),
        );
      if (sourceEventIds.length)
        await tx.delete(wmsTables.stockEvents).where(inArray(wmsTables.stockEvents.id, sourceEventIds));
      if (journalIds.length)
        await tx.delete(wmsTables.stockJournals).where(inArray(wmsTables.stockJournals.id, journalIds));
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
      await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, fixture.shipment.id));
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
          ),
        );
      await tx.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, fixture.sku.id));
      await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.sku.id));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holder.id));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, fixture.warehouse.id));
      await tx.delete(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, fixture.batch.id));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
    });
  }

  it('serializes concurrent reserve retries at a row-lock barrier and conserves demand and stock', async () => {
    const fixture = await seedReservationFixture(10, 6);
    const prefix = `v2-reserve-${randomUUID()}`;
    try {
      const results = await raceBehindLock({
        applicationPrefix: prefix,
        lock: (tx) => tx.execute(sql`SELECT id FROM shipments WHERE id = ${fixture.shipment.id}::uuid FOR UPDATE`),
        first: (database) =>
          wireLogistics(makeDbService(database), 'v2').shipmentReservations.reservePartial(fixture.line.id, 10),
        second: (database) =>
          wireLogistics(makeDbService(database), 'v2').shipmentReservations.reservePartial(fixture.line.id, 10),
      });
      expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
      const reserveResponses = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
      expect(reserveResponses.map((response) => response.mutated).sort()).toEqual([false, true]);
      expect(
        reserveResponses
          .map((response) => ({
            mutated: response.mutated,
            reservedQty: response.reservedQty,
            totalReservedQty: response.totalReservedQty,
          }))
          .sort((left, right) => Number(left.mutated) - Number(right.mutated)),
      ).toEqual([
        { mutated: false, reservedQty: 0, totalReservedQty: 6 },
        { mutated: true, reservedQty: 6, totalReservedQty: 6 },
      ]);

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
        .where(eq(wmsTables.fulfillmentOrders.id, fixture.fo.id));
      const reservations = await db
        .select()
        .from(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      const [availability] = await observer<{ on_hand: number; reserved: number; available: number }[]>`
        SELECT
          coalesce(sum(sl.qty), 0)::int AS on_hand,
          coalesce((SELECT sum(sr.quantity) FROM stock_reservations sr WHERE sr.sku_id = ${fixture.sku.id}::uuid AND sr.status = 'confirmed'), 0)::int AS reserved,
          (coalesce(sum(sl.qty), 0) - coalesce((SELECT sum(sr.quantity) FROM stock_reservations sr WHERE sr.sku_id = ${fixture.sku.id}::uuid AND sr.status = 'confirmed'), 0))::int AS available
        FROM stock_ledgers sl
        WHERE sl.sku_id = ${fixture.sku.id}::uuid AND sl.stock_state = 'ON_HAND'
      `;

      expect(reservations).toHaveLength(1);
      expect(reservations[0].quantity).toBe(6);
      expect(line).toMatchObject({ qty: 10, reservedQty: 6 });
      expect(item).toMatchObject({ qty: 10, reservedQty: 6 });
      expect(fo).toMatchObject({ totalQty: 10, totalReservedQty: 6 });
      expect(availability).toEqual({ on_hand: 6, reserved: 6, available: 0 });
      expect(line.reservedQty).toBeLessThanOrEqual(line.qty);
    } finally {
      await cleanupReservationFixture(fixture);
    }
  });

  it('allows exactly one stale-version split at a row-lock barrier and conserves FOI demand', async () => {
    const fixture = await seedReservationFixture(10, 6, 6);
    const prefix = `v2-split-${randomUUID()}`;
    const keys = [`v2-split-a-${randomUUID()}`, `v2-split-b-${randomUUID()}`] as const;
    const actor = { id: randomUUID(), roles: ['master'] };
    const request = {
      expectedManifestVersion: fixture.shipment.manifestVersion,
      reason: 'deterministic split race',
      moves: [{ shipmentLineId: fixture.line.id, expectedLineVersion: fixture.line.lineVersion, qty: 4 }],
    };
    try {
      const results = await raceBehindLock({
        applicationPrefix: prefix,
        lock: (tx) => tx.execute(sql`SELECT id FROM shipments WHERE id = ${fixture.shipment.id}::uuid FOR UPDATE`),
        first: (database) => planningService(database).split(fixture.shipment.id, request, keys[0], actor),
        second: (database) => planningService(database).split(fixture.shipment.id, request, keys[1], actor),
      });
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(results.map(conflictCode).filter(Boolean)).toEqual(['SHIPMENT_STALE_MANIFEST_VERSION']);

      const lines = await db
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, fixture.item.id));
      const operations = await db
        .select()
        .from(wmsTables.shipmentOperations)
        .where(inArray(wmsTables.shipmentOperations.idempotencyKey, [...keys]));
      expect(lines).toHaveLength(2);
      expect(lines.reduce((sum, line) => sum + line.qty, 0)).toBe(10);
      expect(lines.reduce((sum, line) => sum + line.reservedQty, 0)).toBe(6);
      expect(
        lines.map((line) => ({ qty: line.qty, reservedQty: line.reservedQty })).sort((a, b) => a.qty - b.qty),
      ).toEqual([
        { qty: 4, reservedQty: 0 },
        { qty: 6, reservedQty: 6 },
      ]);
      expect(operations).toHaveLength(1);
      expect(operations[0].status).toBe('completed');
      await expectFoiDemandConservation({
        fulfillmentOrderItemId: fixture.item.id,
        expectedStatus: 'partially_reserved',
      });
      const workItems = await db
        .select({ id: wmsTables.outboundBatchWorkItems.id })
        .from(wmsTables.outboundBatchWorkItems)
        .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.outboundBatchWorkItems.shipmentId))
        .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
        .where(eq(wmsTables.shipmentLines.fulfillmentOrderItemId, fixture.item.id));
      expect(workItems).toHaveLength(0);
      await expectNoSessionForItem(fixture.item.id);
    } finally {
      await db
        .delete(wmsTables.fulfillmentCommandRequests)
        .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, [...keys]));
      await cleanupReservationFixture(fixture);
    }
  });

  it('allows exactly one picker CAS claim after both workers reach the work-item lock barrier', async () => {
    const suffix = randomUUID();
    const fixture = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as DbTx;
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `v2-claim-wh-${suffix}` })
        .returning();
      const [shipment] = await tx
        .insert(wmsTables.shipments)
        .values({ warehouseId: warehouse.id, status: 'planned' })
        .returning();
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({ batchNumber: `V2-CLAIM-${suffix}`, warehouseId: warehouse.id, pickingMethod: 'individual' })
        .returning();
      const [workItem] = await tx
        .insert(wmsTables.outboundBatchWorkItems)
        .values({ batchId: batch.id, shipmentId: shipment.id, status: 'queued' })
        .returning();
      return { warehouse, shipment, batch, workItem };
    });
    const prefix = `v2-claim-${randomUUID()}`;
    const keys = [`v2-claim-a-${randomUUID()}`, `v2-claim-b-${randomUUID()}`] as const;
    const workers = [
      { id: randomUUID(), roles: ['warehouse_worker'] },
      { id: randomUUID(), roles: ['warehouse_worker'] },
    ];
    try {
      const results = await raceBehindLock({
        applicationPrefix: prefix,
        lock: (tx) =>
          tx.execute(sql`SELECT id FROM outbound_batch_work_items WHERE id = ${fixture.workItem.id}::uuid FOR UPDATE`),
        first: (database) =>
          batchService(database).claimPicker(fixture.workItem.id, { expectedLeaseVersion: 0 }, keys[0], workers[0]),
        second: (database) =>
          batchService(database).claimPicker(fixture.workItem.id, { expectedLeaseVersion: 0 }, keys[1], workers[1]),
      });
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.map(conflictCode).filter((code) => code === 'WORK_ITEM_STALE_LEASE_VERSION')).toHaveLength(1);
      const [stored] = await db
        .select()
        .from(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItem.id));
      expect(stored).toMatchObject({ status: 'picking', leaseVersion: 1 });
      expect(workers.map((worker) => worker.id)).toContain(stored.pickerId);
    } finally {
      await db
        .delete(wmsTables.fulfillmentCommandRequests)
        .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, [...keys]));
      await db.delete(wmsTables.auditLogs).where(
        inArray(
          wmsTables.auditLogs.userId,
          workers.map((worker) => worker.id),
        ),
      );
      await db
        .delete(wmsTables.outboundBatchWorkItems)
        .where(eq(wmsTables.outboundBatchWorkItems.id, fixture.workItem.id));
      await db.delete(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, fixture.batch.id));
      await db.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, fixture.shipment.id));
      await db.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
    }
  });

  it('dispatches exactly once at the last-scan barrier and recalls exactly once at the recovery barrier', async () => {
    const fixture = await seedDispatchFixture();
    const dispatchPrefix = `v2-dispatch-${randomUUID()}`;
    const dispatchKeys = [`v2-dispatch-a-${randomUUID()}`, `v2-dispatch-b-${randomUUID()}`] as const;
    const recallKeys = [`v2-recall-a-${randomUUID()}`, `v2-recall-b-${randomUUID()}`] as const;
    const deniedRecallKey = `v2-recall-denied-${randomUUID()}`;
    const actor = { id: fixture.actorId, roles: ['logistics_worker'] };
    try {
      const dispatchResults = await raceBehindLock({
        applicationPrefix: dispatchPrefix,
        lock: (tx) => tx.execute(sql`SELECT id FROM shipments WHERE id = ${fixture.shipment.id}::uuid FOR UPDATE`),
        first: (database) =>
          dispatchService(database).inspectionScan(fixture.shipment.id, {
            barcode: fixture.barcode,
            quantity: 1,
            actor,
            idempotencyKey: dispatchKeys[0],
          }),
        second: (database) =>
          dispatchService(database).inspectionScan(fixture.shipment.id, {
            barcode: fixture.barcode,
            quantity: 1,
            actor,
            idempotencyKey: dispatchKeys[1],
          }),
      });
      expect(dispatchResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(dispatchResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect(dispatchResults.map(conflictCode).filter(Boolean)).toEqual(['SHIPMENT_WORK_ITEM_MISSING']);

      const attempts = await db
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.shipmentId, fixture.shipment.id));
      expect(attempts).toHaveLength(1);
      const sources = await db
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, attempts[0].id));
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({
        shipmentLineId: fixture.line.id,
        sourceLocationId: fixture.sourceLocation.id,
        qty: 2,
      });
      const shipEvents = await db
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, sources[0].stockEventId!));
      expect(shipEvents).toHaveLength(1);
      expect(shipEvents[0]).toMatchObject({
        transitionType: 'SHIP',
        quantity: 2,
        journalId: attempts[0].stockJournalId,
      });
      const dispatchOutbox = await db
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          inArray(wmsTables.outboxEvents.aggregateId, [
            fixture.shipment.id,
            fixture.fulfillmentOrder.id,
            sources[0].stockEventId!,
          ]),
        );
      expect(dispatchOutbox.map((event) => `${event.topic}:${event.idempotencyKey}`).sort()).toEqual(
        [
          `inventory.events.v1:stock-event:${sources[0].stockEventId}`,
          `shipments.events.v1:${attempts[0].id}`,
          `fulfillments.events.v2:${attempts[0].id}:${fixture.fulfillmentOrder.id}`,
          `fulfillments.events.v1:${fixture.fulfillmentOrder.id}:fully-shipped`,
        ].sort(),
      );
      const [afterDispatch] = await observer<{ on_hand: number; reserved: number }[]>`
        SELECT
          coalesce((SELECT sum(qty) FROM stock_ledgers WHERE sku_id = ${fixture.sku.id}::uuid AND stock_state = 'ON_HAND'), 0)::int AS on_hand,
          coalesce((SELECT sum(quantity) FROM stock_reservations WHERE sku_id = ${fixture.sku.id}::uuid AND status = 'confirmed'), 0)::int AS reserved
      `;
      expect(afterDispatch).toEqual({ on_hand: 0, reserved: 0 });
      expect(2).toBe(afterDispatch.on_hand + Number(shipEvents[0].quantity));
      await expectFoiDemandConservation({
        fulfillmentOrderItemId: fixture.item.id,
        expectedStatus: 'completed',
      });
      await expectSessionConservation(fixture.session.id);

      const recallDto = {
        dispatchAttemptId: attempts[0].id,
        expectedManifestVersion: fixture.shipment.manifestVersion,
        physicalRecoveryConfirmed: true as const,
        reason: 'package_recovered' as const,
      };
      const recallActor = { id: fixture.actorId, roles: ['recall_operator'] };
      await expect(
        recallService(db, false).report(fixture.shipment.id, attempts[0].id, recallDto, deniedRecallKey, recallActor),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        await db
          .select({ id: wmsTables.fulfillmentCommandRequests.id })
          .from(wmsTables.fulfillmentCommandRequests)
          .where(eq(wmsTables.fulfillmentCommandRequests.idempotencyKey, deniedRecallKey)),
      ).toHaveLength(0);

      const recallPrefix = `v2-recall-${randomUUID()}`;
      const recallResults = await raceBehindLock({
        applicationPrefix: recallPrefix,
        lock: (tx) =>
          tx.execute(sql`SELECT id FROM fulfillment_order_items WHERE id = ${fixture.item.id}::uuid FOR UPDATE`),
        first: (database) =>
          recallService(database).report(fixture.shipment.id, attempts[0].id, recallDto, recallKeys[0], recallActor),
        second: (database) =>
          recallService(database).report(fixture.shipment.id, attempts[0].id, recallDto, recallKeys[1], recallActor),
      });
      expect(recallResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(recallResults.filter((result) => result.status === 'rejected')).toHaveLength(1);
      // 플랜3: recall.report 가 동기 완료하며 manifestVersion 을 인라인으로 올린다 — 패자는 (구 async 모델의
      // recovery_required 상태로 인한 NOT_SHIPPED 대신) 먼저 stale manifest 가드에 걸린다. report 는 manifest
      // 검사(line 165)를 status 검사(line 168)보다 먼저 하므로 결정적이다.
      expect(recallResults.map(conflictCode).filter(Boolean)).toEqual(['SHIPMENT_RECALL_STALE_MANIFEST']);
      const acceptedRecall = recallResults.find(
        (result): result is PromiseFulfilledResult<Awaited<ReturnType<ShipmentRecallService['report']>>> =>
          result.status === 'fulfilled',
      )!;
      // 플랜3: recall.report 는 동기 완료 — 승자는 구 async saga 의 pending 이 아니라 즉시 completed 를 돌려준다.
      expect(acceptedRecall.value).toMatchObject({
        shipmentId: fixture.shipment.id,
        dispatchAttemptId: attempts[0].id,
        operationStatus: 'completed',
        invoiceOperationId: null,
      });
      const reportOperations = await db
        .select()
        .from(wmsTables.shipmentOperations)
        .where(inArray(wmsTables.shipmentOperations.idempotencyKey, [...recallKeys]));
      expect(reportOperations).toHaveLength(1);
      const operationId = reportOperations[0].id;
      expect(operationId).toBe(acceptedRecall.value.operationId);
      // 플랜3: recall intent 는 발송 증거로 invoice_id 를 더 이상 싣지 않는다(waybill 이 증거) — 식별 필드만 유지.
      const snapshot = reportOperations[0].beforeManifestSnapshot as {
        intent: { shipmentId: string; dispatchAttemptId: string; attemptNo: number };
      };
      expect(snapshot.intent).toMatchObject({
        shipmentId: fixture.shipment.id,
        dispatchAttemptId: attempts[0].id,
        attemptNo: attempts[0].attemptNo,
      });
      const operationMembers = await db
        .select()
        .from(wmsTables.shipmentOperationMembers)
        .where(eq(wmsTables.shipmentOperationMembers.operationId, operationId));
      expect(operationMembers).toEqual([expect.objectContaining({ shipmentId: fixture.shipment.id, role: 'source' })]);
      const reportCommands = await db
        .select()
        .from(wmsTables.fulfillmentCommandRequests)
        .where(inArray(wmsTables.fulfillmentCommandRequests.idempotencyKey, [...recallKeys]));
      expect(reportCommands).toHaveLength(1);
      expect(reportCommands[0]).toMatchObject({ status: 'completed', operationId });

      // 플랜3: report tx 안에서 voidForRecall 이 used→voided 로 이미 붕괴했다 — 구 async invoice-void→resume
      // 2단계 대신 여기서 waybill 의 종결 상태와 재고 역전 결과(아래)를 동기 end-state 로 직접 확인한다.
      const [voidedWaybill] = await db
        .select()
        .from(wmsTables.waybills)
        .where(eq(wmsTables.waybills.shipmentId, fixture.shipment.id));
      expect(voidedWaybill).toMatchObject({ id: fixture.waybill.id, status: 'voided' });
      expect(voidedWaybill.voidedAt).not.toBeNull();
      const [recalledAttempt] = await db
        .select()
        .from(wmsTables.dispatchAttempts)
        .where(eq(wmsTables.dispatchAttempts.id, attempts[0].id));
      const reversalEvents = await db
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.reversalOfEventId, sources[0].stockEventId!));
      const [operation] = await db
        .select()
        .from(wmsTables.shipmentOperations)
        .where(eq(wmsTables.shipmentOperations.id, operationId));
      const [recalledLine] = await db
        .select()
        .from(wmsTables.shipmentLines)
        .where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      const confirmed = await db
        .select()
        .from(wmsTables.stockReservations)
        .where(
          and(
            eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id),
            eq(wmsTables.stockReservations.status, 'confirmed'),
          ),
        );
      expect(operation.status).toBe('completed');
      expect(recalledAttempt).toMatchObject({ status: 'recalled', recoveryCode: null });
      expect(recalledAttempt.reversalJournalId).not.toBeNull();
      expect(reversalEvents).toHaveLength(1);
      expect(reversalEvents[0]).toMatchObject({
        transitionType: 'ADJUST_UP',
        quantity: 2,
        journalId: recalledAttempt.reversalJournalId,
      });
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].quantity).toBe(2);
      expect(recalledLine).toMatchObject({ qty: 2, reservedQty: 2, inspectedQty: 0 });
      const recallOutbox = await db
        .select()
        .from(wmsTables.outboxEvents)
        .where(eq(wmsTables.outboxEvents.aggregateId, fixture.shipment.id));
      expect(recallOutbox.filter((event) => event.eventType === 'ShipmentDispatchRecalled')).toHaveLength(1);
      const [afterRecall] = await observer<{ on_hand: number; reserved: number; available: number }[]>`
        SELECT
          coalesce((SELECT sum(qty) FROM stock_ledgers WHERE sku_id = ${fixture.sku.id}::uuid AND stock_state = 'ON_HAND'), 0)::int AS on_hand,
          coalesce((SELECT sum(quantity) FROM stock_reservations WHERE sku_id = ${fixture.sku.id}::uuid AND status = 'confirmed'), 0)::int AS reserved,
          (coalesce((SELECT sum(qty) FROM stock_ledgers WHERE sku_id = ${fixture.sku.id}::uuid AND stock_state = 'ON_HAND'), 0) - coalesce((SELECT sum(quantity) FROM stock_reservations WHERE sku_id = ${fixture.sku.id}::uuid AND status = 'confirmed'), 0))::int AS available
      `;
      expect(afterRecall).toEqual({ on_hand: 2, reserved: 2, available: 0 });
      expect(2).toBe(afterRecall.on_hand);
      await expectFoiDemandConservation({
        fulfillmentOrderItemId: fixture.item.id,
        expectedStatus: 'ready',
      });
      await expectSessionConservation(fixture.session.id);
    } finally {
      await cleanupDispatchFixture(fixture, [...dispatchKeys, ...recallKeys, deniedRecallKey]);
    }
  });
});
