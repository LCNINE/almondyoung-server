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
import { CarrierGatewayRegistry } from '../waybill/carrier/carrier-gateway.registry';
import type { HanjinConfig } from '../waybill/carrier/hanjin/hanjin.config';
import { WaybillIssueMachine } from '../waybill/waybill-issue.machine';
import { WaybillManager } from '../waybill/waybill.manager';
import { WaybillReader } from '../waybill/waybill.reader';
import { WaybillRepository } from '../waybill/waybill.repository';
import { WaybillService } from '../waybill/waybill.service';
import {
  fakeCarrierGateway,
  seedUsedWaybillForShipment,
  WAYBILL_RECIPIENT,
} from '../waybill/__support__/waybill-fixtures';
import { makeDbService } from './__support__';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentProgressService } from './fulfillment-progress.service';
import { ShipmentRecallService } from './shipment-recall.service';
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
  waybill: typeof wmsTables.waybills.$inferSelect;
};

// voidForRecall/getActiveWaybill 은 carrier config 를 쓰지 않는다(HTTP 없음) — 최소 stub 으로 충분.
const HANJIN_STUB = {} as HanjinConfig;

describeIfDb('ShipmentRecallService (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let dbService: DbService<typeof wmsSchema>;
  let reservations: ShipmentReservationService;
  let service: ShipmentRecallService;
  const cleanupFixtures: RecallFixture[] = [];

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 6 });
    db = drizzle(client, { schema: wmsSchema });
    dbService = makeDbService(db);
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
    // report 가 소비하는 실제 WaybillService(getActiveWaybill + voidForRecall). registry/machine/config 는
    // recall 경로에서 실행되지 않으므로(carrier HTTP 없음) fake gateway + stub config 로 배선한다.
    const registry = new CarrierGatewayRegistry([fakeCarrierGateway()]);
    const waybillRepo = new WaybillRepository(dbService);
    const waybills = new WaybillService(
      new WaybillManager(
        new WaybillReader(dbService),
        waybillRepo,
        new WaybillIssueMachine(waybillRepo, registry, dbService),
        registry,
        new FulfillmentCommandService(dbService),
        HANJIN_STUB,
        dbService,
      ),
    );
    service = new ShipmentRecallService(
      dbService,
      new FulfillmentCommandService(dbService),
      {} as never, // authorization — actor.roles=['master'] 로 우회
      waybills,
      inventory,
      reservations,
      new FulfillmentOutboxService(dbService),
      new AuditService(dbService),
      { assertV2MutationAllowed: jest.fn() } as never,
    );
  });

  afterAll(async () => client.end());

  afterEach(async () => {
    for (const fixture of cleanupFixtures.splice(0).reverse()) {
      await cleanupRecallFixture(fixture);
    }
  });

  // 발송 완료(DISPATCHED) 상태를 시드: shipment=shipped + dispatch_attempts(status=dispatched,
  // waybill_id·stock_journal_id·dispatched_at set) + waybill=used(seedUsedWaybillForShipment). report 가
  // 진입점이므로 shipmentOperations/Members 는 시드하지 않는다(report 가 생성). 역전(resumePending) 이 재사용하는
  // dispatchAttemptSources/stockEvents/consumedReservation 는 그대로 시드.
  async function seedDispatchedRecallable(tx: DbTx, quantity = 3) {
    const suffix = randomUUID();
    const actorId = randomUUID();
    const attemptId = randomUUID();
    const dispatchedAt = new Date('2026-07-15T08:00:00.000Z');
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `recall-wh-${suffix}` })
      .returning();
    const [sourceLocation] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `recall-source-${suffix}`, locationType: 'zone' })
      .returning();
    const [reworkLocation] = await tx
      .insert(wmsTables.locations)
      .values({
        warehouseId: warehouse.id,
        code: `recall-rework-${suffix}`,
        locationType: 'zone',
        isSystem: true,
        systemRole: 'outbound_rework',
        isActive: true,
      })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `recall-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'Recall SKU', code: `RECALL-${suffix}`, holderId: holder.id })
      .returning();
    const [profile] = await tx
      .insert(wmsTables.deliveryProfiles)
      .values({
        name: `recall-profile-${suffix}`,
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
        channelOrderId: `recall-order-${suffix}`,
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
        status: 'shipped',
        recipientSnapshot: WAYBILL_RECIPIENT,
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
    // Task 2 헬퍼 실사용 — used 운송장 1행(source='manual', status='used', trackingNo present,
    // recipientHash=hash(WAYBILL_RECIPIENT)). 이 태스크가 헬퍼의 제약 충족을 처음 검증한다(t2-m1).
    const waybill = await seedUsedWaybillForShipment(tx, shipment.id, shipment.manifestVersion);
    const [dispatchJournal] = await tx
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
        sourceId: attemptId,
        idempotencyKey: `recall-dispatch-journal-${suffix}`,
        actorId,
      })
      .returning();
    const [attempt] = await tx
      .insert(wmsTables.dispatchAttempts)
      .values({
        id: attemptId,
        shipmentId: shipment.id,
        attemptNo: 1,
        status: 'dispatched',
        idempotencyKey: `recall-attempt-${suffix}`,
        waybillId: waybill.id,
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
        idempotencyKey: `recall-event-${suffix}`,
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
        providerEventId: `recall-tracking-event-${suffix}`,
        status: 'shipped',
        timestamp: dispatchedAt,
      })
      .returning();
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
    const fixture: RecallFixture = {
      actorId,
      attempt,
      consumedReservation,
      dispatchJournal,
      dispatchSource,
      fulfillmentOrder,
      holder,
      item,
      line,
      // report 성공 시 실제 operationId 로 덮어쓴다. 거부 경로에선 operation 이 생성되지 않으므로
      // 아무 것도 매칭하지 않는 placeholder UUID 를 둔다(cleanup 의 uuid 파라미터 유효성 보장).
      operationId: randomUUID(),
      profile,
      quantity,
      reworkLocation,
      shipment,
      sku,
      sourceLocation,
      salesOrder,
      tracking,
      warehouse,
      waybill,
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
      // report 의 outer command(operationId 컬럼) + inner voidForRecall command(resourceId=waybill.id) 둘 다 제거.
      await tx
        .delete(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.operationId, fixture.operationId));
      await tx
        .delete(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.resourceId, fixture.waybill.id));
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
      await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, fixture.shipment.id));
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

  it('recalls a dispatched shipment synchronously: voids the used waybill, reverses stock and reopens demand', async () => {
    const fixture = await db.transaction((tx) => seedDispatchedRecallable(tx as unknown as DbTx));

    const idempotencyKey = `recall-happy-${randomUUID()}`;
    const reportBody = {
      dispatchAttemptId: fixture.attempt.id,
      expectedManifestVersion: fixture.shipment.manifestVersion,
      physicalRecoveryConfirmed: true as const,
      reason: 'package_recovered' as const,
    };
    const reported = await service.report(fixture.shipment.id, fixture.attempt.id, reportBody, idempotencyKey, {
      id: fixture.actorId,
      roles: ['master'],
    });
    fixture.operationId = reported.operationId;
    // 구 async saga 는 pending 을 반환했다 — 새 동기 붕괴는 report 반환 시점에 이미 completed.
    expect(reported.operationStatus).toBe('completed');

    const [waybill] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, fixture.waybill.id));
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
    expect(waybill).toMatchObject({ status: 'voided' });
    expect(waybill.voidedAt).not.toBeNull();
    expect(shipment).toMatchObject({ status: 'draft', recoveryCode: null, manifestVersion: 5, shippedAt: null });
    expect(attempt).toMatchObject({ status: 'recalled', recoveryCode: null });
    expect(attempt.reversalJournalId).not.toBeNull();
    expect(line).toMatchObject({ reservedQty: fixture.quantity, inspectedQty: 0, forced: false });
    expect(item.shippedQty).toBe(0);
    expect(fo).toMatchObject({ status: 'ready', shippedAt: null, totalReservedQty: fixture.quantity });

    const reservationRows = await db
      .select()
      .from(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
    expect(reservationRows).toEqual(
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
    const reversals = await db
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.reversalOfEventId, fixture.dispatchSource.stockEventId!));
    expect(reversals.length).toBeGreaterThan(0);
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

    // 멱등: 같은 Idempotency-Key 로 재보고하면 command 계층이 캐시된 completed 응답을 돌려주고 부작용을 중복하지 않는다.
    const replay = await service.report(fixture.shipment.id, fixture.attempt.id, reportBody, idempotencyKey, {
      id: fixture.actorId,
      roles: ['master'],
    });
    expect(replay.operationId).toBe(reported.operationId);
    expect(replay.operationStatus).toBe('completed');
    const [itemAfterReplay] = await db
      .select({ shippedQty: wmsTables.fulfillmentOrderItems.shippedQty })
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
    expect(itemAfterReplay.shippedQty).toBe(0);
  });

  it.each([
    ['carrier accepted', 'accepted'],
    ['in-transit evidence', 'in_transit'],
    ['delivered evidence', 'delivered'],
  ] as const)(
    'rejects recall when the exact attempt has %s and leaves the used waybill intact',
    async (_label, evidence) => {
      const fixture = await db.transaction((tx) => seedDispatchedRecallable(tx as unknown as DbTx));
      if (evidence === 'accepted') {
        await db
          .update(wmsTables.dispatchAttempts)
          .set({ carrierAcceptedAt: new Date('2026-07-15T08:30:00.000Z') })
          .where(eq(wmsTables.dispatchAttempts.id, fixture.attempt.id));
      } else {
        await db.insert(wmsTables.shipmentTracking).values({
          shipmentId: fixture.shipment.id,
          dispatchAttemptId: fixture.attempt.id,
          providerEventId: `${evidence}-${randomUUID()}`,
          status: evidence,
          timestamp: new Date('2026-07-15T08:30:00.000Z'),
        });
      }

      await expect(
        service.report(
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

      const [waybill] = await db.select().from(wmsTables.waybills).where(eq(wmsTables.waybills.id, fixture.waybill.id));
      expect(waybill.status).toBe('used');
      expect(waybill.voidedAt).toBeNull();
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
    },
  );
});
