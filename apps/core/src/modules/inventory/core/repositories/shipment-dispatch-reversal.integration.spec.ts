import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { eq, inArray, sql as drizzleSql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from './stock-event.store';
import { InventoryCommandService } from '../services/inventory-command.service';
import { LocationService } from '../services/location.service';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('shipment dispatch stock reversal (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let eventStore: StockEventStore;
  let command: InventoryCommandService;
  let recalculateSellable: jest.SpiedFunction<ProductSellableQuantityService['recalculateAndPublishForSku']>;
  const cleanupFixtures: Array<Awaited<ReturnType<typeof seedDispatchedAttempt>>> = [];

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 5 });
    db = drizzle(client, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((inner) => fn(inner as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    recalculateSellable = jest.spyOn(sellable, 'recalculateAndPublishForSku');
    eventStore = new StockEventStore(dbService, sellable);
    command = new InventoryCommandService(dbService, eventStore, outbox, new LocationService(dbService));
  });

  afterAll(async () => client.end());
  beforeEach(() => recalculateSellable.mockClear());
  afterEach(async () => {
    for (const fixture of cleanupFixtures.splice(0).reverse()) {
      await cleanupCommittedFixture(fixture);
    }
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (inner) => {
        await fn(inner as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function seedDispatchedAttempt(tx: DbTx, quantity = 3) {
    const suffix = randomUUID();
    const actorId = randomUUID();
    const attemptId = randomUUID();
    const recallOperationId = randomUUID();
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
        displayName: 'Outbound rework',
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
      .values({ salesOrderId: salesOrder.id, warehouseId: warehouse.id, status: 'completed', totalQty: quantity })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fulfillmentOrder.id, skuId: sku.id, qty: quantity, shippedQty: quantity })
      .returning();
    const dispatchedAt = new Date('2026-07-15T08:00:00.000Z');
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: warehouse.id,
        openedForFulfillmentOrderId: fulfillmentOrder.id,
        status: 'shipped',
        recipientSnapshot: { name: 'Recall' },
        shippedAt: dispatchedAt,
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({ shipmentId: shipment.id, fulfillmentOrderItemId: item.id, skuId: sku.id, qty: quantity })
      .returning();
    const [dispatchJournal] = await tx
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
        sourceId: attemptId,
        idempotencyKey: `dispatch-journal-${suffix}`,
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
        idempotencyKey: `dispatch-attempt-${suffix}`,
        stockJournalId: dispatchJournal.id,
        dispatchedAt,
      })
      .returning();
    const [originalEvent] = await tx
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
        idempotencyKey: `dispatch-event-${suffix}`,
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
        stockEventId: originalEvent.id,
      })
      .returning();
    const [reversalJournal] = await tx
      .insert(wmsTables.stockJournals)
      .values({
        sourceType: 'SHIPMENT_RECALL',
        sourceId: recallOperationId,
        idempotencyKey: `recall-journal-${suffix}`,
        actorId,
      })
      .returning();
    return {
      actorId,
      attempt,
      dispatchJournal,
      dispatchSource,
      fulfillmentOrder,
      holder,
      item,
      line,
      originalEvent,
      quantity,
      recallOperationId,
      reversalJournal,
      reworkLocation,
      salesOrder,
      shipment,
      sku,
      sourceLocation,
      warehouse,
    };
  }

  async function cleanupCommittedFixture(fixture: Awaited<ReturnType<typeof seedDispatchedAttempt>>) {
    await db.transaction(async (tx) => {
      await tx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fixture.line.id));
      await tx
        .delete(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.dispatchAttemptId, fixture.attempt.id));
      await tx.delete(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, fixture.sku.id));
      await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, fixture.sku.id));
      await tx.delete(wmsTables.dispatchAttempts).where(eq(wmsTables.dispatchAttempts.id, fixture.attempt.id));
      await tx
        .delete(wmsTables.stockJournals)
        .where(inArray(wmsTables.stockJournals.id, [fixture.dispatchJournal.id, fixture.reversalJournal.id]));
      await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, fixture.line.id));
      await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, fixture.shipment.id));
      await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, fixture.item.id));
      await tx
        .delete(wmsTables.fulfillmentOrders)
        .where(eq(wmsTables.fulfillmentOrders.id, fixture.fulfillmentOrder.id));
      await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, fixture.salesOrder.id));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, fixture.warehouse.id));
      await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, fixture.sku.id));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, fixture.holder.id));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
    });
  }

  function recallInput(fixture: Awaited<ReturnType<typeof seedDispatchedAttempt>>) {
    return {
      dispatchAttemptId: fixture.attempt.id,
      reversalJournalId: fixture.reversalJournal.id,
      recallOperationId: fixture.recallOperationId,
      actorId: fixture.actorId,
      reason: 'Physical package recovered',
      occurredAt: new Date('2026-07-15T09:00:00.000Z'),
    };
  }

  it('posts null -> OUTBOUND_REWORK, links the exact SHIP source, and keeps available unchanged after reservation restore', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedDispatchedAttempt(tx);
      const result = await command.reverseShipmentDispatch(recallInput(fixture), tx);
      expect(result.affectedSkuIds).toEqual([fixture.sku.id]);
      expect(result.sources).toHaveLength(1);

      const [reversal] = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, result.sources[0].reversalEventId));
      expect(reversal).toMatchObject({
        journalId: fixture.reversalJournal.id,
        skuId: fixture.sku.id,
        fromWarehouseId: null,
        fromLocationId: null,
        fromState: null,
        toWarehouseId: fixture.warehouse.id,
        toLocationId: fixture.reworkLocation.id,
        toState: 'ON_HAND',
        transitionType: 'ADJUST_UP',
        quantity: fixture.quantity,
        reversalOfEventId: fixture.originalEvent.id,
      });
      const [ledger] = await tx
        .select({ qty: wmsTables.stockLedgers.qty })
        .from(wmsTables.stockLedgers)
        .where(eq(wmsTables.stockLedgers.locationId, fixture.reworkLocation.id));
      expect(ledger.qty).toBe(fixture.quantity);
      expect(recalculateSellable).not.toHaveBeenCalled();

      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'SHIPMENT_LINE',
        targetId: fixture.line.id,
        shipmentLineId: fixture.line.id,
        skuId: fixture.sku.id,
        warehouseId: fixture.warehouse.id,
        quantity: fixture.quantity,
        status: 'confirmed',
      });
      const [available] = await tx
        .select({
          qty: drizzleSql<number>`
            coalesce((select sum(qty) from stock_ledgers where sku_id = ${fixture.sku.id} and warehouse_id = ${fixture.warehouse.id} and stock_state = 'ON_HAND'), 0)
            - coalesce((select sum(quantity) from stock_reservations where sku_id = ${fixture.sku.id} and warehouse_id = ${fixture.warehouse.id} and status = 'confirmed'), 0)
          `,
        })
        .from(wmsTables.warehouses)
        .where(eq(wmsTables.warehouses.id, fixture.warehouse.id));
      expect(Number(available.qty)).toBe(0);

      await expect(command.reverseShipmentDispatch(recallInput(fixture), tx)).rejects.toBeInstanceOf(ConflictException);
      const reversals = await tx
        .select({ id: wmsTables.stockEvents.id })
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.reversalOfEventId, fixture.originalEvent.id));
      expect(reversals).toHaveLength(1);
    });
  });

  it('serializes generic and dispatch-specific reversal so only one can reverse an original event', async () => {
    const fixture = await db.transaction((tx) => seedDispatchedAttempt(tx as unknown as DbTx));
    cleanupFixtures.push(fixture);
    const results = await Promise.allSettled([
      db.transaction((tx) => eventStore.reverseEvent(fixture.originalEvent.id, 'generic race', tx as unknown as DbTx)),
      db.transaction((tx) => command.reverseShipmentDispatch(recallInput(fixture), tx as unknown as DbTx)),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect(results[0].status === 'rejected' ? results[0].reason : null).toBeInstanceOf(ConflictException);
    const reversals = await db
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.reversalOfEventId, fixture.originalEvent.id));
    expect(reversals).toHaveLength(1);
  });

  it('rejects a concurrent duplicate recall reversal and posts one ledger increment', async () => {
    const fixture = await db.transaction((tx) => seedDispatchedAttempt(tx as unknown as DbTx, 4));
    cleanupFixtures.push(fixture);
    const results = await Promise.allSettled([
      db.transaction((tx) => command.reverseShipmentDispatch(recallInput(fixture), tx as unknown as DbTx)),
      db.transaction((tx) => command.reverseShipmentDispatch(recallInput(fixture), tx as unknown as DbTx)),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')?.reason).toBeInstanceOf(ConflictException);
    const reversals = await db
      .select({ id: wmsTables.stockEvents.id })
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.reversalOfEventId, fixture.originalEvent.id));
    const [ledger] = await db
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.locationId, fixture.reworkLocation.id));
    expect(reversals).toHaveLength(1);
    expect(ledger.qty).toBe(4);
  });
});
