import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { OutboxService } from '../../shared/outbox/outbox.service';
import { ProductSellableQuantityService } from '../../product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../repositories/stock-event.store';
import { LocationService } from './location.service';
import { InventoryCommandService } from './inventory-command.service';
import { BatchControlledStockGuard } from './batch-controlled-stock.guard';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { ConflictException } from '@nestjs/common';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

class Rollback extends Error {}

describeIfDb('BatchControlledStockGuard common removal boundary (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let guard: BatchControlledStockGuard;
  let eventStore: StockEventStore;
  let command: InventoryCommandService;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    const dbService = {
      db,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : db.transaction((inner) => fn(inner as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;
    guard = new BatchControlledStockGuard();
    const outbox = new OutboxService(dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    eventStore = new StockEventStore(dbService, sellable, guard);
    command = new InventoryCommandService(dbService, eventStore, outbox, new LocationService(dbService), guard);
  });

  afterAll(async () => {
    await client.end();
  });

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (inner) => {
        await fn(inner as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function expectConflictCode(promise: Promise<unknown>, code: string) {
    try {
      await promise;
      throw new Error(`Expected ConflictException ${code}`);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({ code });
    }
  }

  async function expectSavepointConflict(tx: DbTx, fn: (savepoint: DbTx) => Promise<unknown>) {
    await expectConflictCode(
      tx.transaction((inner) => fn(inner as unknown as DbTx)),
      'BATCH_CONTROLLED_STOCK',
    );
  }

  async function seedControlled(
    tx: DbTx,
    options: { status?: 'active' | 'recovery_required'; onHandQty?: number; controlledQty?: number } = {},
  ) {
    const suffix = randomUUID();
    const status = options.status ?? 'active';
    const onHandQty = options.onHandQty ?? 10;
    const controlledQty = options.controlledQty ?? 4;
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `guard-wh-${suffix}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `guard-holder-${suffix}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'guard sku', code: `GUARD-${suffix}`, holderId: holder.id })
      .returning();
    const [source] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `GUARD-SRC-${suffix}`, locationType: 'zone' })
      .returning();
    const [destination] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: `GUARD-DST-${suffix}`, locationType: 'zone' })
      .returning();
    await tx.insert(wmsTables.stockLedgers).values({
      skuId: sku.id,
      warehouseId: warehouse.id,
      locationId: source.id,
      stockState: 'ON_HAND',
      qty: onHandQty,
    });
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({ batchNumber: `GUARD-BATCH-${suffix}`, warehouseId: warehouse.id, pickingMethod: 'individual' })
      .returning();
    const [session] = await tx
      .insert(wmsTables.batchInventorySessions)
      .values({
        batchId: batch.id,
        status,
        handedInQty: controlledQty,
        recoveryReason: status === 'recovery_required' ? 'fixture drift' : null,
      })
      .returning();
    await tx.insert(wmsTables.batchInventorySessionBalances).values({
      sessionId: session.id,
      skuId: sku.id,
      sourceLocationId: source.id,
      custodyType: 'AT_SOURCE',
      qty: controlledQty,
    });
    return { warehouse, sku, source, destination, batch, session, onHandQty, controlledQty };
  }

  async function onHand(tx: DbTx, skuId: string, warehouseId: string, locationId: string) {
    const [row] = await tx
      .select({ qty: wmsTables.stockLedgers.qty })
      .from(wmsTables.stockLedgers)
      .where(
        and(
          eq(wmsTables.stockLedgers.skuId, skuId),
          eq(wmsTables.stockLedgers.warehouseId, warehouseId),
          eq(wmsTables.stockLedgers.locationId, locationId),
          eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
        ),
      );
    return row?.qty ?? 0;
  }

  it('exposes controlled/general quantities and lets a real different-location move consume only the free remainder', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedControlled(tx);
      await expect(
        guard.getAvailability(
          {
            skuId: fixture.sku.id,
            warehouseId: fixture.warehouse.id,
            sourceLocationId: fixture.source.id,
          },
          tx,
        ),
      ).resolves.toMatchObject({ onHandQty: 10, batchControlledQty: 4, generallyAvailableQty: 6 });

      await command.moveInternal(
        {
          skuId: fixture.sku.id,
          warehouseId: fixture.warehouse.id,
          fromLocationId: fixture.source.id,
          toLocationId: fixture.destination.id,
          quantity: 6,
        },
        tx,
      );
      expect(await onHand(tx, fixture.sku.id, fixture.warehouse.id, fixture.source.id)).toBe(4);
      expect(await onHand(tx, fixture.sku.id, fixture.warehouse.id, fixture.destination.id)).toBe(6);
    });
  });

  it('blocks move, transfer, direct SCRAP, and adjustDown even when reservation protection is bypassed', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedControlled(tx);
      await expectSavepointConflict(tx, (savepoint) =>
        command.moveInternal(
          {
            skuId: fixture.sku.id,
            warehouseId: fixture.warehouse.id,
            fromLocationId: fixture.source.id,
            toLocationId: fixture.destination.id,
            quantity: 7,
          },
          savepoint,
        ),
      );
      await expectSavepointConflict(tx, (savepoint) =>
        command.transferShip(
          {
            skuId: fixture.sku.id,
            fromWarehouseId: fixture.warehouse.id,
            fromLocationId: fixture.source.id,
            quantity: 7,
          },
          savepoint,
        ),
      );
      await expectSavepointConflict(tx, (savepoint) =>
        command.adjustDown(
          {
            skuId: fixture.sku.id,
            warehouseId: fixture.warehouse.id,
            locationId: fixture.source.id,
            quantity: 7,
            bypassReservationGuard: true,
          },
          savepoint,
        ),
      );
      await expectSavepointConflict(tx, (savepoint) =>
        eventStore.createEvent(
          {
            skuId: fixture.sku.id,
            fromWarehouseId: fixture.warehouse.id,
            fromLocationId: fixture.source.id,
            fromState: 'ON_HAND',
            transitionType: 'SCRAP',
            quantity: 7,
            occurredAt: new Date(),
          },
          savepoint,
        ),
      );
      expect(await onHand(tx, fixture.sku.id, fixture.warehouse.id, fixture.source.id)).toBe(10);
    });
  });

  it('keeps recovery_required custody controlled', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedControlled(tx, { status: 'recovery_required' });
      await expect(
        guard.getAvailability(
          {
            skuId: fixture.sku.id,
            warehouseId: fixture.warehouse.id,
            sourceLocationId: fixture.source.id,
          },
          tx,
        ),
      ).resolves.toMatchObject({ batchControlledQty: 4, generallyAvailableQty: 6 });
      await expectSavepointConflict(tx, (savepoint) =>
        command.adjustDown(
          {
            skuId: fixture.sku.id,
            warehouseId: fixture.warehouse.id,
            locationId: fixture.source.id,
            quantity: 7,
            bypassReservationGuard: true,
          },
          savepoint,
        ),
      );
    });
  });

  async function seedAuthorizedDispatch(tx: DbTx) {
    const base = await seedControlled(tx, { onHandQty: 4, controlledQty: 4 });
    const suffix = randomUUID();
    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `guard-dispatch-${suffix}`,
        salesChannel: 'medusa',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId: salesOrder.id, warehouseId: base.warehouse.id })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fulfillmentOrder.id, skuId: base.sku.id, qty: 4 })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: base.warehouse.id,
        openedForFulfillmentOrderId: fulfillmentOrder.id,
        status: 'planned',
        recipientSnapshot: { name: 'Guard dispatch' },
        plannedAt: new Date(),
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: item.id,
        skuId: base.sku.id,
        qty: 4,
      })
      .returning();
    await tx
      .update(wmsTables.batchInventorySessionBalances)
      .set({ custodyType: 'PACKED', custodyRef: `packed-${suffix}`, shipmentLineId: line.id })
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, base.session.id));
    const [journal] = await tx
      .insert(wmsTables.stockJournals)
      .values({ sourceType: 'SHIPMENT_DISPATCH_ATTEMPT', sourceId: shipment.id })
      .returning();
    const [attempt] = await tx
      .insert(wmsTables.dispatchAttempts)
      .values({
        shipmentId: shipment.id,
        attemptNo: 1,
        idempotencyKey: `guard-attempt-${suffix}`,
        stockJournalId: journal.id,
      })
      .returning();
    const [dispatchSource] = await tx
      .insert(wmsTables.dispatchAttemptSources)
      .values({
        dispatchAttemptId: attempt.id,
        shipmentLineId: line.id,
        sourceLocationId: base.source.id,
        qty: 4,
      })
      .returning();
    return { ...base, shipment, line, journal, attempt, dispatchSource };
  }

  it('requires an exact caller-tx dispatch capability, links it atomically, and replays without a second decrement', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAuthorizedDispatch(tx);
      const idempotencyKey = `guard-ship-${randomUUID()}`;
      const input = {
        skuId: fixture.sku.id,
        warehouseId: fixture.warehouse.id,
        locationId: fixture.source.id,
        quantity: 4,
        journalId: fixture.journal.id,
        idempotencyKey,
        batchSessionDispatch: {
          sessionId: fixture.session.id,
          dispatchAttemptSourceId: fixture.dispatchSource.id,
        },
      };
      await expect(command.ship(input)).rejects.toThrow('requires the caller dispatch transaction');
      await expectSavepointConflict(tx, (savepoint) =>
        command.ship({ ...input, batchSessionDispatch: undefined }, savepoint),
      );

      const first = await command.ship(input, tx);
      const replay = await command.ship(input, tx);
      if (!first.eventId) throw new Error('Authorized dispatch did not return its stock event');
      expect(replay.eventId).toBe(first.eventId);
      expect(await onHand(tx, fixture.sku.id, fixture.warehouse.id, fixture.source.id)).toBe(0);
      const [linked] = await tx
        .select({ stockEventId: wmsTables.dispatchAttemptSources.stockEventId })
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.id, fixture.dispatchSource.id));
      expect(linked.stockEventId).toBe(first.eventId);
      const outboxRows = await tx
        .select({ id: wmsTables.outboxEvents.id, payload: wmsTables.outboxEvents.payload })
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.eventType, 'StockShipped'),
            eq(wmsTables.outboxEvents.aggregateId, first.eventId),
          ),
        );
      expect(outboxRows).toHaveLength(1);
      expect(INVENTORY_STREAM.events.StockShipped.schema!.parse(outboxRows[0].payload)).toEqual(outboxRows[0].payload);

      await expectConflictCode(
        tx.transaction((inner) =>
          command.ship(
            {
              ...input,
              batchSessionDispatch: { ...input.batchSessionDispatch, sessionId: randomUUID() },
            },
            inner as unknown as DbTx,
          ),
        ),
        'BATCH_DISPATCH_SESSION_MISMATCH',
      );
    });
  });

  it('rolls back the dispatch source link and stock projection with the caller transaction', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAuthorizedDispatch(tx);
      await expect(
        tx.transaction(async (inner) => {
          await command.ship(
            {
              skuId: fixture.sku.id,
              warehouseId: fixture.warehouse.id,
              locationId: fixture.source.id,
              quantity: 4,
              journalId: fixture.journal.id,
              idempotencyKey: `guard-rollback-${randomUUID()}`,
              batchSessionDispatch: {
                sessionId: fixture.session.id,
                dispatchAttemptSourceId: fixture.dispatchSource.id,
              },
            },
            inner as unknown as DbTx,
          );
          throw new Error('dispatch settlement failed');
        }),
      ).rejects.toThrow('dispatch settlement failed');

      expect(await onHand(tx, fixture.sku.id, fixture.warehouse.id, fixture.source.id)).toBe(4);
      const [source] = await tx
        .select({ stockEventId: wmsTables.dispatchAttemptSources.stockEventId })
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.id, fixture.dispatchSource.id));
      expect(source.stockEventId).toBeNull();
    });
  });
});
