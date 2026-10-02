import { outboxPublisherFor } from '../outbox/__support__/outbox-publisher.factory';
import { INVENTORY_STREAM } from '@packages/event-contracts/streams';
import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { acquireStockAvailabilityLock } from '../../inventory/shared/locks/stock-availability-lock';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { ProductSellableQuantityService } from '../../inventory/product-sellable-quantity/services/product-sellable-quantity.service';
import { StockEventStore } from '../../inventory/core/repositories/stock-event.store';
import { LocationService } from '../../inventory/core/services/location.service';
import { InventoryCommandService } from '../../inventory/core/services/inventory-command.service';
import {
  BatchInventorySessionFaultInjector,
  BatchInventorySessionService,
  handInRequestHash,
  shortageIdempotencyKey,
} from './batch-inventory-session.service';
import { SessionStartAllocation } from '../picking/allocation/allocation.types';
import { BatchSessionRecoveryService } from './batch-session-recovery.service';
import { inRollbackTx, makeDb } from './__support__';
import { seedBoxOverSameStock, seedReturnBin, seedTwoBoxBatch } from './__support__/simple-outbound-fixtures';
import { seedShortPickOperation } from './__support__/short-pick-fixtures';
import { assembleOutbound } from './__support__/simple-outbound-wiring';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
type Database = PostgresJsDatabase<typeof wmsSchema>;

class Rollback extends Error {}

describeIfDb('BatchInventorySessionService (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  const actorId = randomUUID();

  let client: postgres.Sql;
  let db: Database;
  let concurrentClient: postgres.Sql;
  let concurrentDb: Database;
  let services: ReturnType<typeof makeServices>;
  let concurrentServices: ReturnType<typeof makeServices>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    concurrentClient = postgres(DATABASE_URL as string, { max: 2 });
    concurrentDb = drizzle(concurrentClient, { schema: wmsSchema });
    services = makeServices(db);
    concurrentServices = makeServices(concurrentDb);
  });

  afterAll(async () => {
    await Promise.all([client.end(), concurrentClient.end()]);
  });

  function dbServiceFor(database: Database): DbService<typeof wmsSchema> {
    return {
      db: database,
      run: <T>(fn: (tx: DbTx) => Promise<T>, tx?: DbTx): Promise<T> =>
        tx ? fn(tx) : database.transaction((trx) => fn(trx as unknown as DbTx)),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function makeServices(database: Database, faultInjector?: BatchInventorySessionFaultInjector) {
    const dbService = dbServiceFor(database);
    const guard = new BatchControlledStockGuard();
    const audit = new AuditService(dbService);
    const sessions = new BatchInventorySessionService(dbService, audit, faultInjector);
    const recovery = new BatchSessionRecoveryService(dbService, audit, guard);
    const outbox = outboxPublisherFor(INVENTORY_STREAM, dbService);
    const sellable = new ProductSellableQuantityService(dbService as never, outbox);
    const eventStore = new StockEventStore(dbService, sellable, guard);
    const command = new InventoryCommandService(dbService, eventStore, outbox, new LocationService(dbService), guard);
    return { dbService, guard, audit, sessions, recovery, command };
  }

  async function inRollbackTx(fn: (tx: DbTx) => Promise<void>) {
    await expect(
      db.transaction(async (trx) => {
        await fn(trx as unknown as DbTx);
        throw new Rollback('intentional rollback');
      }),
    ).rejects.toThrow(Rollback);
  }

  async function expectConflict(action: Promise<unknown>, code: string): Promise<void> {
    let caught: unknown;
    try {
      await action;
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ response: { code } });
  }

  async function seedAllocatedBatch(
    tx: DbTx,
    options: {
      quantity?: number;
      source?: { warehouseId: string; locationId: string; skuId: string; stockVersion: number };
    } = {},
  ) {
    const suffix = randomUUID();
    const quantity = options.quantity ?? 4;
    let source = options.source;
    if (!source) {
      const [warehouse] = await tx
        .insert(wmsTables.warehouses)
        .values({ name: `session-wh-${suffix}` })
        .returning();
      const [holder] = await tx
        .insert(wmsTables.holders)
        .values({ name: `session-holder-${suffix}` })
        .returning();
      const [sku] = await tx
        .insert(wmsTables.skus)
        .values({ name: 'session sku', code: `SESSION-${suffix}`, holderId: holder.id })
        .returning();
      const [location] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: `SESSION-ZONE-${suffix}`, locationType: 'zone' })
        .returning();
      const [ledger] = await tx
        .insert(wmsTables.stockLedgers)
        .values({
          skuId: sku.id,
          warehouseId: warehouse.id,
          locationId: location.id,
          stockState: 'ON_HAND',
          qty: 10,
        })
        .returning();
      source = {
        warehouseId: warehouse.id,
        locationId: location.id,
        skuId: sku.id,
        stockVersion: ledger.version,
      };
    }

    const [salesOrder] = await tx
      .insert(wmsTables.salesOrders)
      .values({
        channelOrderId: `session-order-${suffix}`,
        salesChannel: 'medusa',
        shippingAddress: {},
        orderDate: new Date(),
      })
      .returning();
    const [fulfillmentOrder] = await tx
      .insert(wmsTables.fulfillmentOrders)
      .values({ salesOrderId: salesOrder.id, warehouseId: source.warehouseId })
      .returning();
    const [item] = await tx
      .insert(wmsTables.fulfillmentOrderItems)
      .values({ fulfillmentOrderId: fulfillmentOrder.id, skuId: source.skuId, qty: quantity })
      .returning();
    const [shipment] = await tx
      .insert(wmsTables.shipments)
      .values({
        warehouseId: source.warehouseId,
        openedForFulfillmentOrderId: fulfillmentOrder.id,
        status: 'planned',
        recipientSnapshot: { name: 'Session fixture' },
        plannedAt: new Date(),
      })
      .returning();
    const [line] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: shipment.id,
        fulfillmentOrderItemId: item.id,
        skuId: source.skuId,
        qty: quantity,
      })
      .returning();
    await tx.insert(wmsTables.stockReservations).values({
      targetType: 'FULFILLMENT_ORDER',
      targetId: fulfillmentOrder.id,
      fulfillmentOrderItemId: item.id,
      shipmentLineId: line.id,
      skuId: source.skuId,
      warehouseId: source.warehouseId,
      quantity,
      status: 'confirmed',
      requestedAt: new Date(),
    });
    const [batch] = await tx
      .insert(wmsTables.outboundBatches)
      .values({
        batchNumber: `SESSION-BATCH-${suffix}`,
        warehouseId: source.warehouseId,
        pickingMethod: 'individual',
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
    const [allocation] = await tx
      .insert(wmsTables.pickingSourceAllocations)
      .values({
        workItemId: workItem.id,
        shipmentLineId: line.id,
        sourceLocationId: source.locationId,
        qty: quantity,
        sourceStockVersion: source.stockVersion,
      })
      .returning();
    return { source, salesOrder, fulfillmentOrder, item, shipment, line, batch, workItem, allocation, quantity };
  }

  /** 배치의 작업 항목 배정 전부 — 배치 시작(`startBatchPicking`)이 세션에 넘기는 모양 그대로. */
  async function batchAllocations(tx: DbTx, batchId: string): Promise<SessionStartAllocation[]> {
    return tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        workItemId: wmsTables.outboundBatchWorkItems.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        skuId: wmsTables.shipmentLines.skuId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        quantity: wmsTables.pickingSourceAllocations.qty,
        sourceStockVersion: wmsTables.pickingSourceAllocations.sourceStockVersion,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.outboundBatchWorkItems,
        eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
      )
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(eq(wmsTables.outboundBatchWorkItems.batchId, batchId));
  }

  /** 배치 시작이 하는 인계(HAND_IN)와 `started_at` 표시를 재현한다. tx 가 없으면 자기 트랜잭션을 연다. */
  function handIn(svc: ReturnType<typeof makeServices>, batchId: string, tx?: DbTx) {
    return svc.dbService.run(async (trx) => {
      const session = await svc.sessions.startSession(
        { batchId, actorId, allocations: await batchAllocations(trx, batchId) },
        trx,
      );
      await trx
        .update(wmsTables.outboundBatches)
        .set({ startedAt: new Date() })
        .where(eq(wmsTables.outboundBatches.id, batchId));
      return session;
    }, tx);
  }

  it('hands in batch allocations without stock-ledger writes', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx);
      const beforeStockEvents = await tx.select({ count: sql<number>`count(*)::int` }).from(wmsTables.stockEvents);
      const started = await handIn(services, fixture.batch.id, tx);

      expect(started).toMatchObject({ handedInQty: fixture.quantity, settledQty: 0, returnedQty: 0, version: 2 });
      const events = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.sessionId, started.id));
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        idempotencyKey: `start:${fixture.batch.id}:${fixture.allocation.id}`,
        eventType: 'HAND_IN',
        quantity: fixture.quantity,
      });
      expect(events[0].payload).toEqual(
        expect.objectContaining({
          sequence: 1,
          batchId: fixture.batch.id,
          workItemId: fixture.workItem.id,
          allocationId: fixture.allocation.id,
        }),
      );
      // 인계 해시는 배치 신원 + 그 배정으로 고정된다 — 재생·복구가 같은 식으로 다시 계산한다.
      const [handedIn] = (await batchAllocations(tx, fixture.batch.id)).filter(
        (allocation) => allocation.id === fixture.allocation.id,
      );
      expect((events[0].payload as Record<string, unknown>).requestHash).toBe(
        handInRequestHash(fixture.batch.id, handedIn),
      );
      const availability = await services.guard.getAvailability(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          sourceLocationId: fixture.source.locationId,
        },
        tx,
      );
      expect(availability).toMatchObject({ onHandQty: 10, batchControlledQty: 4, generallyAvailableQty: 6 });
      const afterStockEvents = await tx.select({ count: sql<number>`count(*)::int` }).from(wmsTables.stockEvents);
      expect(afterStockEvents).toEqual(beforeStockEvents);
    });
  });

  it('moves custody idempotently, rejects payload reuse, returns it, and replays after terminal settlement', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx);
      const session = await handIn(services, fixture.batch.id, tx);
      const handoff = {
        sessionId: session.id,
        idempotencyKey: `handoff-${randomUUID()}`,
        actorId,
        quantity: fixture.quantity,
        from: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'AT_SOURCE' as const,
        },
        to: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'WORKER' as const,
          custodyRef: randomUUID(),
          shipmentLineId: fixture.line.id,
        },
      };
      const moved = await services.sessions.moveCustody(handoff, tx);
      const replayedMove = await services.sessions.moveCustody(handoff, tx);
      expect(moved.replayed).toBe(false);
      expect(replayedMove).toMatchObject({ replayed: true, event: { id: moved.event.id } });
      await expectConflict(
        services.sessions.moveCustody({ ...handoff, quantity: fixture.quantity - 1 }, tx),
        'SESSION_IDEMPOTENCY_MISMATCH',
      );

      const bin = await seedReturnBin(tx, fixture.source.warehouseId, actorId);
      await services.sessions.removeToReturnBin(
        {
          sessionId: session.id,
          operationId: randomUUID(),
          actorId,
          workItemId: fixture.workItem.id,
          allocationId: fixture.allocation.id,
          shipmentLineId: fixture.line.id,
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          quantity: fixture.quantity,
          from: { custodyType: 'WORKER', custodyRef: handoff.to.custodyRef, shipmentLineId: fixture.line.id },
          returnBin: bin,
        },
        tx,
      );
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 0 })
        .where(eq(wmsTables.pickingSourceAllocations.id, fixture.allocation.id));
      const putaway = {
        sessionId: session.id,
        operationId: randomUUID(),
        actorId,
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        quantity: fixture.quantity,
        returnBin: bin,
      };
      const returned = await services.sessions.putawayReturn(putaway, tx);
      expect(returned.session).toMatchObject({ status: 'settled', returnedQty: fixture.quantity });
      const terminalReplay = await services.sessions.putawayReturn(putaway, tx);
      expect(terminalReplay).toMatchObject({ replayed: true, event: { id: returned.event.id } });
    });
  });

  it('부족 승인은 안 집은 몫(AT_SOURCE)에서 배정 신원을 싣고 줄인다 — 형제 박스의 보관은 그대로, 같은 키는 재생', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx, { quantity: 3 });
      const suffix = randomUUID();
      const [salesOrder] = await tx
        .insert(wmsTables.salesOrders)
        .values({
          channelOrderId: `session-sibling-${suffix}`,
          salesChannel: 'medusa',
          shippingAddress: {},
          orderDate: new Date(),
        })
        .returning();
      const [fulfillmentOrder] = await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ salesOrderId: salesOrder.id, warehouseId: fixture.source.warehouseId })
        .returning();
      const [item] = await tx
        .insert(wmsTables.fulfillmentOrderItems)
        .values({ fulfillmentOrderId: fulfillmentOrder.id, skuId: fixture.source.skuId, qty: 2 })
        .returning();
      const [siblingShipment] = await tx
        .insert(wmsTables.shipments)
        .values({
          warehouseId: fixture.source.warehouseId,
          openedForFulfillmentOrderId: fulfillmentOrder.id,
          status: 'planned',
          recipientSnapshot: { name: 'Sibling fixture' },
          plannedAt: new Date(),
        })
        .returning();
      const [siblingLine] = await tx
        .insert(wmsTables.shipmentLines)
        .values({
          shipmentId: siblingShipment.id,
          fulfillmentOrderItemId: item.id,
          skuId: fixture.source.skuId,
          qty: 2,
        })
        .returning();
      await tx.insert(wmsTables.stockReservations).values({
        targetType: 'SHIPMENT_LINE',
        targetId: siblingLine.id,
        shipmentLineId: siblingLine.id,
        skuId: fixture.source.skuId,
        warehouseId: fixture.source.warehouseId,
        quantity: 2,
        status: 'confirmed',
        requestedAt: new Date(),
      });
      const [siblingWorkItem] = await tx
        .insert(wmsTables.outboundBatchWorkItems)
        .values({
          batchId: fixture.batch.id,
          shipmentId: siblingShipment.id,
          status: 'queued',
        })
        .returning();
      await tx.insert(wmsTables.pickingSourceAllocations).values({
        workItemId: siblingWorkItem.id,
        shipmentLineId: siblingLine.id,
        sourceLocationId: fixture.source.locationId,
        qty: 2,
        sourceStockVersion: fixture.source.stockVersion,
      });
      const session = await handIn(services, fixture.batch.id, tx);
      // 한 개는 집었다 — WORKER 1(줄 귀속). 안 집은 몫 = 3 − 1 = 2
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId,
          quantity: 1,
          from: { skuId: fixture.source.skuId, sourceLocationId: fixture.source.locationId, custodyType: 'AT_SOURCE' },
          to: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'WORKER',
            custodyRef: actorId,
            shipmentLineId: fixture.line.id,
          },
        },
        tx,
      );
      const operation = await seedShortPickOperation(tx, {
        shipmentId: fixture.shipment.id,
        workItemId: fixture.workItem.id,
        sessionId: session.id,
        actorId,
        lines: [
          {
            shipmentLineId: fixture.line.id,
            sourceLocationId: fixture.source.locationId,
            shortQty: 2,
            allocationQty: 3,
          },
        ],
      });
      const input = {
        sessionId: session.id,
        idempotencyKey: shortageIdempotencyKey(operation.id, fixture.allocation.id),
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
        shipmentLineId: fixture.line.id,
        quantity: 2,
        from: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'AT_SOURCE' as const,
        },
        reasonCode: 'MISSING' as const,
        reason: operation.reason,
        approverId: actorId,
      };

      const approved = await services.sessions.approveShortage(input, tx);

      expect(approved.session).toMatchObject({ shortageQty: 2, returnedQty: 0 });
      expect(approved.event.payload).toMatchObject({
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
      });
      // AT_SOURCE = 3(본 박스) + 2(형제) − 1(집음) − 2(부족) = 2 — 형제 몫 2 가 그대로다
      const [atSource] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        );
      expect(atSource.qty).toBe(2);
      expect((await services.sessions.approveShortage(input, tx)).replayed).toBe(true);
    });
  });

  it('부족 승인은 줄 귀속 보관에서 하지 않고, 안 집은 몫을 넘지 않는다', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx, { quantity: 3 });
      const session = await handIn(services, fixture.batch.id, tx);
      const worker = {
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        custodyType: 'WORKER' as const,
        custodyRef: actorId,
        shipmentLineId: fixture.line.id,
      };
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `pick-${randomUUID()}`,
          actorId,
          quantity: 2,
          from: { skuId: fixture.source.skuId, sourceLocationId: fixture.source.locationId, custodyType: 'AT_SOURCE' },
          to: worker,
        },
        tx,
      );
      const operation = await seedShortPickOperation(tx, {
        shipmentId: fixture.shipment.id,
        workItemId: fixture.workItem.id,
        sessionId: session.id,
        actorId,
        lines: [
          {
            shipmentLineId: fixture.line.id,
            sourceLocationId: fixture.source.locationId,
            shortQty: 2,
            allocationQty: 3,
          },
        ],
      });
      const base = {
        sessionId: session.id,
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
        shipmentLineId: fixture.line.id,
        reasonCode: 'MISSING' as const,
        reason: operation.reason,
        approverId: actorId,
      };
      await expect(
        services.sessions.approveShortage(
          { ...base, idempotencyKey: `s-${randomUUID()}`, quantity: 1, from: worker },
          tx,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      // 안 집은 몫 = 3 − 2 = 1 < 2
      await expectConflict(
        services.sessions.approveShortage(
          {
            ...base,
            idempotencyKey: shortageIdempotencyKey(operation.id, fixture.allocation.id),
            quantity: 2,
            from: {
              skuId: fixture.source.skuId,
              sourceLocationId: fixture.source.locationId,
              custodyType: 'AT_SOURCE',
            },
          },
          tx,
        ),
        'SESSION_SHORTAGE_EXCEEDS_ALLOCATION',
      );
    });
  });

  it('완료된 결품 오퍼레이션은 같은 키의 재생만 받는다', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx, { quantity: 3 });
      const session = await handIn(services, fixture.batch.id, tx);
      const operation = await seedShortPickOperation(tx, {
        shipmentId: fixture.shipment.id,
        workItemId: fixture.workItem.id,
        sessionId: session.id,
        actorId,
        lines: [
          {
            shipmentLineId: fixture.line.id,
            sourceLocationId: fixture.source.locationId,
            shortQty: 1,
            allocationQty: 3,
          },
        ],
      });
      const input = {
        sessionId: session.id,
        idempotencyKey: shortageIdempotencyKey(operation.id, fixture.allocation.id),
        shortPickOperationId: operation.id,
        workItemId: fixture.workItem.id,
        allocationId: fixture.allocation.id,
        shipmentLineId: fixture.line.id,
        quantity: 1,
        from: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'AT_SOURCE' as const,
        },
        reasonCode: 'MISSING' as const,
        reason: operation.reason,
        approverId: actorId,
      };
      await services.sessions.approveShortage(input, tx);
      await tx
        .update(wmsTables.shipmentOperations)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(wmsTables.shipmentOperations.id, operation.id));
      expect((await services.sessions.approveShortage(input, tx)).replayed).toBe(true);
      await expectConflict(
        services.sessions.approveShortage({ ...input, idempotencyKey: `completed-new-${randomUUID()}` }, tx),
        'SESSION_SHORTAGE_OPERATION_COMPLETED',
      );
    });
  });

  it('rolls event and balance back together when the process crashes between the stages', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx);
      const session = await handIn(services, fixture.batch.id, tx);
      const crashing = makeServices(db, {
        afterEventAppended: () => {
          throw new Error('simulated process crash after event append');
        },
      });
      const idempotencyKey = `crash-${randomUUID()}`;
      await expect(
        tx.transaction((savepoint) =>
          crashing.sessions.moveCustody(
            {
              sessionId: session.id,
              idempotencyKey,
              actorId,
              quantity: 1,
              from: {
                skuId: fixture.source.skuId,
                sourceLocationId: fixture.source.locationId,
                custodyType: 'AT_SOURCE',
              },
              to: {
                skuId: fixture.source.skuId,
                sourceLocationId: fixture.source.locationId,
                custodyType: 'WORKER',
                custodyRef: randomUUID(),
                shipmentLineId: fixture.line.id,
              },
            },
            savepoint as unknown as DbTx,
          ),
        ),
      ).rejects.toThrow('simulated process crash');

      const [eventCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, session.id),
            eq(wmsTables.batchInventorySessionEvents.idempotencyKey, idempotencyKey),
          ),
        );
      const [source] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        );
      expect(eventCount.count).toBe(0);
      expect(source.qty).toBe(fixture.quantity);
    });
  });

  it('rejects general stock movement against controlled quantity', async () => {
    await inRollbackTx(async (tx) => {
      const first = await seedAllocatedBatch(tx, { quantity: 7 });
      const [targetLocation] = await tx
        .insert(wmsTables.locations)
        .values({
          warehouseId: first.source.warehouseId,
          code: `SESSION-MOVE-${randomUUID()}`,
          locationType: 'zone',
        })
        .returning();
      await handIn(services, first.batch.id, tx);
      await expectConflict(
        services.command.moveInternal(
          {
            skuId: first.source.skuId,
            warehouseId: first.source.warehouseId,
            fromLocationId: first.source.locationId,
            toLocationId: targetLocation.id,
            quantity: 4,
          },
          tx,
        ),
        'BATCH_CONTROLLED_STOCK',
      );
    });
  });

  it('marks balance drift for recovery, rebuilds only from events, and rejects corrupted event identity', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx);
      const session = await handIn(services, fixture.batch.id, tx);
      const custodyRef = randomUUID();
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `recovery-move-${randomUUID()}`,
          actorId,
          quantity: 2,
          from: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'AT_SOURCE',
          },
          to: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'WORKER',
            custodyRef,
            shipmentLineId: fixture.line.id,
          },
        },
        tx,
      );
      await tx
        .update(wmsTables.batchInventorySessionBalances)
        .set({ qty: 1 })
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'WORKER'),
          ),
        );
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({
        healthy: false,
        recoveryRequired: true,
      });
      expect(
        await services.guard.getAvailability(
          {
            skuId: fixture.source.skuId,
            warehouseId: fixture.source.warehouseId,
            sourceLocationId: fixture.source.locationId,
          },
          tx,
        ),
      ).toMatchObject({ batchControlledQty: 3, generallyAvailableQty: 7 });
      expect(await services.recovery.rebuildFromEvents(session.id, tx)).toMatchObject({
        healthy: true,
        recoveryRequired: false,
      });
      const [worker] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'WORKER'),
          ),
        );
      expect(worker.qty).toBe(2);

      const [startEvent] = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(
          and(
            eq(wmsTables.batchInventorySessionEvents.sessionId, session.id),
            eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          ),
        );
      await tx
        .update(wmsTables.batchInventorySessionEvents)
        .set({ payload: { ...(startEvent.payload as object), requestHash: '0'.repeat(64) } })
        .where(eq(wmsTables.batchInventorySessionEvents.id, startEvent.id));
      const rejected = await services.recovery.rebuildFromEvents(session.id, tx);
      expect(rejected).toMatchObject({ healthy: false, recoveryRequired: true });
      expect(rejected.issues.join(' ')).toContain('canonical request hash differs');
      const [unchangedWorker] = await tx
        .select()
        .from(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.id, worker.id));
      expect(unchangedWorker.qty).toBe(2);
    });
  });

  it('replays generic MOVE_CUSTODY context independent of key order and rejects tampering', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx);
      const session = await handIn(services, fixture.batch.id, tx);
      const moved = await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `context-move-${randomUUID()}`,
          actorId,
          quantity: 1,
          from: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'AT_SOURCE',
          },
          to: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'TOTE',
            custodyRef: randomUUID(),
            shipmentLineId: fixture.line.id,
          },
          context: {
            inspection: { outcome: 'accepted', station: 'station-1' },
            tote: { slot: 2, label: 'T-2' },
          },
        },
        tx,
      );
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({ healthy: true });

      const payload = moved.event.payload as Record<string, unknown>;
      await tx
        .update(wmsTables.batchInventorySessionEvents)
        .set({
          payload: {
            tote: { label: 'T-2', slot: 2 },
            inspection: { station: 'station-1', outcome: 'accepted' },
            actorId: payload.actorId,
            requestHash: payload.requestHash,
            sequence: payload.sequence,
          },
        })
        .where(eq(wmsTables.batchInventorySessionEvents.id, moved.event.id));
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({ healthy: true });

      await tx
        .update(wmsTables.batchInventorySessionEvents)
        .set({
          payload: {
            tote: { label: 'T-2', slot: 2 },
            inspection: { station: 'station-1', outcome: 'rejected' },
            actorId: payload.actorId,
            requestHash: payload.requestHash,
            sequence: payload.sequence,
          },
        })
        .where(eq(wmsTables.batchInventorySessionEvents.id, moved.event.id));
      const rejected = await services.recovery.reconcile(session.id, tx);
      expect(rejected).toMatchObject({ healthy: false, recoveryRequired: true });
      expect(rejected.issues.join(' ')).toContain('canonical request hash differs');
    });
  });

  it('links an exact SHIP before settlement and rolls the ledger, link, event and balance back together on failure', async () => {
    await inRollbackTx(async (tx) => {
      const fixture = await seedAllocatedBatch(tx);
      const session = await handIn(services, fixture.batch.id, tx);
      const packing = {
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        custodyType: 'PACKING' as const,
        custodyRef: randomUUID(),
        shipmentLineId: fixture.line.id,
      };
      await services.sessions.moveCustody(
        {
          sessionId: session.id,
          idempotencyKey: `packing-${randomUUID()}`,
          actorId,
          quantity: fixture.quantity,
          from: {
            skuId: fixture.source.skuId,
            sourceLocationId: fixture.source.locationId,
            custodyType: 'AT_SOURCE',
          },
          to: packing,
        },
        tx,
      );
      const [journal] = await tx
        .insert(wmsTables.stockJournals)
        .values({ sourceType: 'SHIPMENT_DISPATCH_ATTEMPT' })
        .returning();
      const [attempt] = await tx
        .insert(wmsTables.dispatchAttempts)
        .values({
          shipmentId: fixture.shipment.id,
          attemptNo: 1,
          idempotencyKey: `dispatch-${randomUUID()}`,
          status: 'pending',
          stockJournalId: journal.id,
        })
        .returning();
      const [dispatchSource] = await tx
        .insert(wmsTables.dispatchAttemptSources)
        .values({
          dispatchAttemptId: attempt.id,
          shipmentLineId: fixture.line.id,
          sourceLocationId: fixture.source.locationId,
          qty: fixture.quantity,
        })
        .returning();
      const shipKey = `session-ship-${randomUUID()}`;
      const settleKey = `session-settle-${randomUUID()}`;
      const crashing = makeServices(db, {
        afterEventAppended: (eventType) => {
          if (eventType === 'SETTLE_FOR_DISPATCH') throw new Error('crash after settlement event');
        },
      });
      await expect(
        tx.transaction(async (savepoint) => {
          const trx = savepoint as unknown as DbTx;
          await services.command.ship(
            {
              skuId: fixture.source.skuId,
              warehouseId: fixture.source.warehouseId,
              locationId: fixture.source.locationId,
              quantity: fixture.quantity,
              journalId: journal.id,
              idempotencyKey: shipKey,
              batchSessionDispatch: { sessionId: session.id, dispatchAttemptSourceId: dispatchSource.id },
            },
            trx,
          );
          await crashing.sessions.settleForDispatch(
            {
              sessionId: session.id,
              idempotencyKey: settleKey,
              actorId,
              quantity: fixture.quantity,
              from: packing,
              dispatchAttemptSourceId: dispatchSource.id,
            },
            trx,
          );
        }),
      ).rejects.toThrow('crash after settlement event');
      const [rolledBackSource] = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.id, dispatchSource.id));
      const [rolledBackLedger] = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(
          and(
            eq(wmsTables.stockLedgers.skuId, fixture.source.skuId),
            eq(wmsTables.stockLedgers.locationId, fixture.source.locationId),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
          ),
        );
      expect(rolledBackSource.stockEventId).toBeNull();
      expect(rolledBackLedger.qty).toBe(10);

      const shipped = await services.command.ship(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          locationId: fixture.source.locationId,
          quantity: fixture.quantity,
          journalId: journal.id,
          idempotencyKey: shipKey,
          batchSessionDispatch: { sessionId: session.id, dispatchAttemptSourceId: dispatchSource.id },
        },
        tx,
      );
      const settled = await services.sessions.settleForDispatch(
        {
          sessionId: session.id,
          idempotencyKey: settleKey,
          actorId,
          quantity: fixture.quantity,
          from: packing,
          dispatchAttemptSourceId: dispatchSource.id,
        },
        tx,
      );
      const [linkedSource] = await tx
        .select()
        .from(wmsTables.dispatchAttemptSources)
        .where(eq(wmsTables.dispatchAttemptSources.id, dispatchSource.id));
      expect(linkedSource.stockEventId).toBe(shipped.eventId);
      expect(settled.session).toMatchObject({ status: 'settled', settledQty: fixture.quantity });
      expect(await services.recovery.reconcile(session.id, tx)).toMatchObject({ healthy: true });
    });
  });

  it('fails a rebuild closed when a general move consumes corrupt undercounted custody first', async () => {
    const fixture = await db.transaction((trx) => seedAllocatedBatch(trx as unknown as DbTx, { quantity: 10 }));
    const session = await handIn(services, fixture.batch.id);
    const [targetLocation] = await db
      .insert(wmsTables.locations)
      .values({
        warehouseId: fixture.source.warehouseId,
        code: `SESSION-RECOVERY-MOVE-${randomUUID()}`,
        locationType: 'zone',
      })
      .returning();
    await db
      .update(wmsTables.batchInventorySessionBalances)
      .set({ qty: 0 })
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
        ),
      );
    expect(await services.recovery.reconcile(session.id)).toMatchObject({
      healthy: false,
      recoveryRequired: true,
    });

    let releaseMove!: () => void;
    let moveHasStockLock!: () => void;
    const moveGate = new Promise<void>((resolve) => {
      releaseMove = resolve;
    });
    const stockLockReady = new Promise<void>((resolve) => {
      moveHasStockLock = resolve;
    });
    const movePromise = concurrentDb.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      await acquireStockAvailabilityLock(tx, fixture.source.skuId, fixture.source.warehouseId);
      moveHasStockLock();
      await moveGate;
      return concurrentServices.command.moveInternal(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          fromLocationId: fixture.source.locationId,
          toLocationId: targetLocation.id,
          quantity: fixture.quantity,
          idempotencyKey: `recovery-race-move-${randomUUID()}`,
        },
        tx,
      );
    });
    await stockLockReady;
    const rebuildPromise = services.recovery.rebuildFromEvents(session.id);
    releaseMove();
    const [moveResult, rebuildResult] = await Promise.all([movePromise, rebuildPromise]);

    expect(moveResult.eventId).not.toBeNull();
    expect(rebuildResult).toMatchObject({ healthy: false, recoveryRequired: true });
    expect(rebuildResult.issues.join(' ')).toContain('cannot restore controlled=10');
    const availability = await db.transaction((trx) =>
      services.guard.getAvailability(
        {
          skuId: fixture.source.skuId,
          warehouseId: fixture.source.warehouseId,
          sourceLocationId: fixture.source.locationId,
        },
        trx as unknown as DbTx,
      ),
    );
    expect(availability.onHandQty).toBe(0);
    expect(availability.batchControlledQty).toBe(0);
    expect(availability.onHandQty).toBeGreaterThanOrEqual(availability.batchControlledQty);
    const [recoverySession] = await db
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, session.id));
    expect(recoverySession.status).toBe('recovery_required');
  });

  it('rebuilds from the post-lock event stream when a concurrent return settles first', async () => {
    const fixture = await db.transaction((trx) => seedAllocatedBatch(trx as unknown as DbTx));
    const session = await handIn(services, fixture.batch.id);
    const worker = {
      skuId: fixture.source.skuId,
      sourceLocationId: fixture.source.locationId,
      custodyType: 'WORKER' as const,
      custodyRef: randomUUID(),
      shipmentLineId: fixture.line.id,
    };
    await services.sessions.moveCustody({
      sessionId: session.id,
      idempotencyKey: `recovery-return-move-${randomUUID()}`,
      actorId,
      quantity: fixture.quantity,
      from: {
        skuId: fixture.source.skuId,
        sourceLocationId: fixture.source.locationId,
        custodyType: 'AT_SOURCE',
      },
      to: worker,
    });

    const bin = await db.transaction(async (trx) => {
      const tx = trx as unknown as DbTx;
      const returnBin = await seedReturnBin(tx, fixture.source.warehouseId, actorId);
      await services.sessions.removeToReturnBin(
        {
          sessionId: session.id,
          operationId: randomUUID(),
          actorId,
          workItemId: fixture.workItem.id,
          allocationId: fixture.allocation.id,
          shipmentLineId: fixture.line.id,
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          quantity: fixture.quantity,
          from: { custodyType: 'WORKER', custodyRef: worker.custodyRef, shipmentLineId: fixture.line.id },
          returnBin,
        },
        tx,
      );
      await tx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: 0 })
        .where(eq(wmsTables.pickingSourceAllocations.id, fixture.allocation.id));
      return returnBin;
    });

    let rebuildPromise!: ReturnType<BatchSessionRecoveryService['rebuildFromEvents']>;
    await concurrentDb.transaction(async (trx) => {
      const returned = await concurrentServices.sessions.putawayReturn(
        {
          sessionId: session.id,
          operationId: randomUUID(),
          actorId,
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          quantity: fixture.quantity,
          returnBin: bin,
        },
        trx as unknown as DbTx,
      );
      expect(returned.session.status).toBe('settled');

      // The uncommitted return holds plan/session. Recovery must wait there
      // without taking the stock advisory lock, then replay the committed
      // terminal event before it acquires and revalidates stock.
      rebuildPromise = services.recovery.rebuildFromEvents(session.id);
      const stockLockKey = `${fixture.source.skuId}:${fixture.source.warehouseId}`;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const [lockState] = await concurrentClient<{ locked: boolean }[]>`
        SELECT EXISTS (
          SELECT 1
          FROM pg_locks
          WHERE locktype = 'advisory'
            AND granted
            AND pid <> pg_backend_pid()
            AND classid::bigint = ((hashtext(${stockLockKey})::bigint >> 32) & 4294967295)
            AND objid::bigint = (hashtext(${stockLockKey})::bigint & 4294967295)
            AND objsubid = 1
        ) AS locked
      `;
      expect(lockState.locked).toBe(false);
    });

    expect(await rebuildPromise).toMatchObject({ healthy: true, recoveryRequired: false });
    const [rebuiltSession] = await db
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, session.id));
    expect(rebuiltSession).toMatchObject({ status: 'settled', recoveryReason: null });
    const liveBalances = await db
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, session.id),
          sql`${wmsTables.batchInventorySessionBalances.qty} > 0`,
        ),
      );
    expect(liveBalances).toHaveLength(0);
  });

  it('serializes concurrent overdrawn custody moves so exactly one succeeds', async () => {
    const fixture = await db.transaction((trx) => seedAllocatedBatch(trx as unknown as DbTx));
    const session = await handIn(services, fixture.batch.id);
    const move = (service: BatchInventorySessionService, suffix: string) =>
      service.moveCustody({
        sessionId: session.id,
        idempotencyKey: `concurrent-custody-${suffix}-${randomUUID()}`,
        actorId,
        quantity: 3,
        from: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'AT_SOURCE',
        },
        to: {
          skuId: fixture.source.skuId,
          sourceLocationId: fixture.source.locationId,
          custodyType: 'WORKER',
          custodyRef: randomUUID(),
          shipmentLineId: fixture.line.id,
        },
      });
    const outcomes = await Promise.allSettled([move(services.sessions, 'a'), move(concurrentServices.sessions, 'b')]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const balances = await db
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id));
    expect(balances.find((balance) => balance.custodyType === 'AT_SOURCE')?.qty).toBe(1);
    expect(
      balances.filter((balance) => balance.custodyType === 'WORKER').reduce((total, balance) => total + balance.qty, 0),
    ).toBe(3);
  });
});

describeIfDb('세션 — 실행 중 인계와 반납 (PR 2)', () => {
  jest.setTimeout(120_000);
  const { sql: pgClient, db: pgDb } = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await pgClient.end({ timeout: 5 });
  });

  async function startedTwoBoxes(tx: DbTx) {
    const { first, second } = await seedTwoBoxBatch(tx, 1, 10);
    const wiring = assembleOutbound(tx);
    const started = await wiring.picking.start(
      { batchId: first.batchId, actorId: first.actorId, idempotencyKey: `s-${randomUUID()}` },
      tx,
    );
    const [allocation] = await tx
      .select()
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, second.workItemId));
    return { first, second, wiring, sessionId: started.sessionId, allocation };
  }

  const atSource = async (tx: DbTx, sessionId: string) =>
    (
      await tx
        .select({ qty: wmsTables.batchInventorySessionBalances.qty })
        .from(wmsTables.batchInventorySessionBalances)
        .where(
          and(
            eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
            eq(wmsTables.batchInventorySessionBalances.custodyType, 'AT_SOURCE'),
          ),
        )
    ).reduce((total, row) => total + row.qty, 0);

  it('handBack 은 AT_SOURCE 를 줄이고 HAND_BACK 이벤트에 신원을 싣고 헤더 반납 수량을 올린다 — 같은 명령이면 한 번', async () => {
    await inRollbackTx(pgDb, async (tx) => {
      const { second, wiring, sessionId, allocation } = await startedTwoBoxes(tx);
      const input = {
        sessionId,
        operationId: randomUUID(),
        actorId: second.actorId,
        workItemId: second.workItemId,
        allocationId: allocation.id,
        shipmentLineId: second.shipmentLineId,
        skuId: second.skuId,
        sourceLocationId: second.locationId,
        quantity: 1,
      };
      const before = await atSource(tx, sessionId);
      const first = await wiring.sessions.handBack(input, tx);
      const replay = await wiring.sessions.handBack(input, tx);

      expect(first.replayed).toBe(false);
      expect(replay.replayed).toBe(true);
      expect(await atSource(tx, sessionId)).toBe(before - 1);
      expect(first.event.eventType).toBe('HAND_BACK');
      expect(first.event.idempotencyKey).toBe(`hand-back:${input.operationId}:${allocation.id}`);
      expect(first.event.payload).toMatchObject({
        operationId: input.operationId,
        workItemId: second.workItemId,
        allocationId: allocation.id,
        shipmentLineId: second.shipmentLineId,
      });
      expect(first.session.handedBackQty).toBe(1);
      expect(first.session.handedInQty).toBe(3);
    });
  });

  it('handIn 은 실행 중 세션에 이어서 인계한다 — 순번이 이어지고 인계 수량·AT_SOURCE 가 는다', async () => {
    await inRollbackTx(pgDb, async (tx) => {
      const { first, wiring, sessionId } = await startedTwoBoxes(tx);
      const third = await seedBoxOverSameStock(tx, first, 2);
      await tx
        .update(wmsTables.outboundBatchWorkItems)
        .set({ batchId: first.batchId })
        .where(eq(wmsTables.outboundBatchWorkItems.id, third.workItemId));
      const [row] = await tx
        .insert(wmsTables.pickingSourceAllocations)
        .values({
          workItemId: third.workItemId,
          shipmentLineId: third.shipmentLineId,
          sourceLocationId: third.locationId,
          qty: 2,
          sourceStockVersion: 1,
        })
        .returning();
      const [before] = await tx
        .select()
        .from(wmsTables.batchInventorySessions)
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      const operationId = randomUUID();

      const after = await wiring.sessions.handIn(
        {
          sessionId,
          batchId: first.batchId,
          actorId: first.actorId,
          operationId,
          allocations: [
            {
              id: row.id,
              workItemId: third.workItemId,
              shipmentLineId: third.shipmentLineId,
              skuId: third.skuId,
              sourceLocationId: third.locationId,
              quantity: 2,
              sourceStockVersion: 1,
            },
          ],
        },
        tx,
      );

      expect(after.handedInQty).toBe(before.handedInQty + 2);
      expect(after.version).toBe(before.version + 1);
      expect(await atSource(tx, sessionId)).toBe(5);
      const [event] = await tx
        .select()
        .from(wmsTables.batchInventorySessionEvents)
        .where(eq(wmsTables.batchInventorySessionEvents.idempotencyKey, `hand-in:${operationId}:${row.id}`));
      expect(event.payload).toMatchObject({
        sequence: before.version,
        workItemId: third.workItemId,
        allocationId: row.id,
      });
    });
  });

  it('active 가 아닌 세션에는 인계하지 않는다', async () => {
    await inRollbackTx(pgDb, async (tx) => {
      const { first, wiring, sessionId, allocation } = await startedTwoBoxes(tx);
      await tx
        .update(wmsTables.batchInventorySessions)
        .set({ status: 'recovery_required', recoveryReason: 'test' })
        .where(eq(wmsTables.batchInventorySessions.id, sessionId));
      await expect(
        wiring.sessions.handIn(
          {
            sessionId,
            batchId: first.batchId,
            actorId: first.actorId,
            operationId: randomUUID(),
            allocations: [
              {
                id: allocation.id,
                workItemId: allocation.workItemId!,
                shipmentLineId: allocation.shipmentLineId,
                skuId: first.skuId,
                sourceLocationId: allocation.sourceLocationId,
                quantity: 1,
                sourceStockVersion: 1,
              },
            ],
          },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'SESSION_NOT_MUTABLE' } });
    });
  });
});
