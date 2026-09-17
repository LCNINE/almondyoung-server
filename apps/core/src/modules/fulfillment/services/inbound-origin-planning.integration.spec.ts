import { isPreparationBlocked } from './outbound-preparation-result';
import { randomUUID } from 'crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql as sqlQuery } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { buildWiring, makeInboundReceiptKernel } from '../../inventory/inbound/services/__fixtures__/inbound-harness';
import { StockProjectionReader } from '../../inventory/stock-projection/services/stock-projection.reader';
import { StockProjectionService } from '../../inventory/stock-projection/services/stock-projection.service';
import { StockProjectionController } from '../../inventory/stock-projection/controllers/stock-projection.controller';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { planPicking } from '../picking/plan/picking-plan';
import { PickingPlanDeps } from '../picking/plan/picking-plan.types';
import { WaybillService } from '../waybill/waybill.service';
import { WaybillManager } from '../waybill/waybill.manager';
import { WaybillReader } from '../waybill/waybill.reader';
import { WaybillRepository } from '../waybill/waybill.repository';
import { BatchInventorySessionService } from './batch-inventory-session.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { ambientDbService, inRollbackTx, makeDb, seedPickableShipment, assembleSimpleOutbound } from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

function planning(tx: DbTx): PickingPlanDeps {
  const dbService = ambientDbService(tx);
  const { guard } = buildWiring(tx as never);
  return {
    commands: new FulfillmentCommandService(dbService),
    workflowGate: new FulfillmentWorkflowGate(
      new ConfigService({ FULFILLMENT_WORKFLOW_MODE: 'v2', FULFILLMENT_V2_CUTOVER_AT: '1970-01-01T00:00:00.000Z' }),
    ),
    sessions: new BatchInventorySessionService(dbService, guard, new AuditService(dbService)),
    invariant: new FulfillmentInvariantService(),
    controlledStock: guard,
    waybills: new WaybillService(
      new WaybillManager(
        new WaybillReader(dbService),
        new WaybillRepository(dbService),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        dbService,
      ),
    ),
  };
}

async function fixture(tx: DbTx, qty = 6, freeAtOrigin = 0) {
  const f = await seedPickableShipment(tx, qty);
  await tx.update(wmsTables.stockLedgers).set({ qty: 0 }).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
  const kernel = makeInboundReceiptKernel(tx as never);
  const receipt = await kernel.recordArrival(
    {
      source: 'direct',
      method: 'simple',
      warehouseId: f.warehouseId,
      reason: 'planning',
      lines: [{ skuId: f.skuId, quantity: 10, eventKey: randomUUID() }],
    },
    tx,
  );
  const line = receipt.lines[0];
  if (freeAtOrigin)
    await tx
      .update(wmsTables.stockLedgers)
      .set({ qty: 10 + freeAtOrigin })
      .where(
        and(eq(wmsTables.stockLedgers.skuId, f.skuId), eq(wmsTables.stockLedgers.locationId, line.originLocationId!)),
      );
  return { ...f, origin: line.originLocationId!, lineId: line.id, kernel, deps: planning(tx) };
}

function plan(f: Awaited<ReturnType<typeof fixture>>, tx: DbTx) {
  return planPicking(
    f.deps,
    'discrete',
    { batchId: f.batchId, shipmentIds: [f.shipmentId], actorId: f.actorId, idempotencyKey: randomUUID() },
    tx,
  );
}
function contents(tx: DbTx, locationId: string) {
  const { eventStore } = buildWiring(tx as never);
  const reader = new StockProjectionReader(ambientDbService(tx), eventStore);
  const service = new StockProjectionService(reader, {} as never, {} as never, {} as never, ambientDbService(tx));
  return new StockProjectionController(service).getLocationContents(locationId);
}

describeIfDb('Inbound origin planning and location contents (real PostgreSQL)', () => {
  const { sql } = makeDb(DATABASE_URL as string);
  const queries: string[] = [];
  const db = drizzle(sql, {
    schema: wmsSchema,
    logger: {
      logQuery: (query) => {
        queries.push(query);
      },
    },
  });
  afterAll(() => sql.end({ timeout: 5 }));

  it('shows ten pending, allocates none before putaway, then allocates only six on the shelf', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await fixture(tx);
      const locationContents = await contents(tx, f.origin);
      expect(locationContents.items[0]).toMatchObject({ quantity: 10, inboundPendingQty: 10, generallyMovableQty: 0 });
      await expect(plan(f, tx)).rejects.toMatchObject({ response: { code: 'PICKING_SOURCE_INSUFFICIENT' } });
      await f.kernel.putaway(
        { receiptLineId: f.lineId, toLocationId: f.locationId, quantity: 6, eventKey: randomUUID() },
        tx,
      );
      const result = await plan(f, tx);
      const allocations = await tx
        .select()
        .from(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.planId, result.planId));
      expect(allocations.every((a) => a.sourceLocationId !== f.origin)).toBe(true);
      expect(allocations.reduce((sum, a) => sum + a.qty, 0)).toBe(6);
      expect((await contents(tx, f.locationId)).items[0]).toMatchObject({
        quantity: 6,
        inboundPendingQty: 0,
        generallyMovableQty: 6,
      });
    });
  });
  it('revalidates pending after planning even when the ledger version is unchanged', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await fixture(tx, 6, 2);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ canceledQty: 8 })
        .where(eq(wmsTables.inboundReceiptLines.id, f.lineId));
      const first = await plan(f, tx);
      expect((await plan(f, tx)).planId).toBe(first.planId);
      const [before] = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(and(eq(wmsTables.stockLedgers.skuId, f.skuId), eq(wmsTables.stockLedgers.locationId, f.origin)));
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ canceledQty: 0 })
        .where(eq(wmsTables.inboundReceiptLines.id, f.lineId));
      await expect(f.deps.sessions.startSession(f.batchId, first.planId, tx, f.actorId)).rejects.toMatchObject({
        response: { code: 'PICKING_PLAN_SOURCE_STALE' },
      });
      expect(await plan(f, tx)).toMatchObject({ state: 'invalidated', planId: first.planId });
      const [after] = await tx
        .select()
        .from(wmsTables.stockLedgers)
        .where(and(eq(wmsTables.stockLedgers.skuId, f.skuId), eq(wmsTables.stockLedgers.locationId, f.origin)));
      expect(after.version).toBe(before.version);
      expect(
        await tx
          .select()
          .from(wmsTables.batchInventorySessions)
          .where(eq(wmsTables.batchInventorySessions.batchId, f.batchId)),
      ).toHaveLength(0);
    });
  });

  it('acquires two free units, shows pending10 + custody2 against ledger12 as zero, and rejects overlap', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await fixture(tx, 2, 2);
      const result = await plan(f, tx);
      const session = await f.deps.sessions.startSession(f.batchId, result.planId, tx, f.actorId);
      expect((await contents(tx, f.origin)).items[0]).toMatchObject({
        quantity: 12,
        inboundPendingQty: 10,
        generallyMovableQty: 0,
      });
      expect(
        await tx
          .select()
          .from(wmsTables.batchInventorySessionBalances)
          .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id)),
      ).toEqual([expect.objectContaining({ qty: 2, custodyType: 'AT_SOURCE', sourceLocationId: f.origin })]);
      await tx
        .update(wmsTables.stockLedgers)
        .set({ qty: 10 })
        .where(and(eq(wmsTables.stockLedgers.skuId, f.skuId), eq(wmsTables.stockLedgers.locationId, f.origin)));
      await expect(contents(tx, f.origin)).rejects.toMatchObject({
        response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' },
      });
      await expect(
        f.deps.controlledStock.getAvailability(
          { skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: f.origin },
          tx,
        ),
      ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' } });
    });
  });

  it('final simple dispatch consumes only the two free units and leaves all pending receipts', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await fixture(tx, 2, 2);
      const result = await assembleSimpleOutbound(tx).scan(
        f.shipmentId,
        {
          barcode: f.barcode,
          quantity: 2,
          actor: { id: f.actorId, roles: ['logistics_worker'] },
          idempotencyKey: randomUUID(),
        },
        tx,
      );
      if (isPreparationBlocked(result)) throw new Error('Expected prepared outbound state');
      expect(result.status).toBe('shipped');
      expect((await contents(tx, f.origin)).items[0]).toMatchObject({
        quantity: 10,
        inboundPendingQty: 10,
        generallyMovableQty: 0,
      });
      const [line] = await tx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, f.lineId));
      expect(line).toMatchObject({ quantity: 10, putawayFromOriginQty: 0, canceledQty: 0, returnedQty: 0 });
    });
  });

  it.each([
    { quantity: 0 },
    { quantity: -1 },
    { putawayFromOriginQty: -1 },
    { returnedQty: -1 },
    { canceledQty: -1 },
    { putawayFromOriginQty: 11 },
    { canceledQty: 11 },
    { returnedQty: 11 },
    { originLocationId: null },
  ])('bulk display rejects the same invalid receipt facts as the guard: %j', async (patch) => {
    await inRollbackTx(db, async (tx) => {
      const f = await fixture(tx);
      await tx.update(wmsTables.inboundReceiptLines).set(patch).where(eq(wmsTables.inboundReceiptLines.id, f.lineId));
      for (const locationId of patch.originLocationId === null ? [f.origin, f.locationId] : [f.origin]) {
        await expect(contents(tx, locationId)).rejects.toMatchObject({
          response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' },
        });
        await expect(
          f.deps.controlledStock.getAvailability(
            { skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: locationId },
            tx,
          ),
        ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' } });
      }
    });
  });

  it('aggregates many SKUs and multiple receipts without multiplying stock, and preserves other states', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await fixture(tx);
      const skus = await tx
        .insert(wmsTables.skus)
        .values(
          Array.from({ length: 25 }, (_, i) => ({
            holderId: f.holderId,
            code: `BULK-${i}-${randomUUID()}`,
            name: `Bulk ${i}`,
          })),
        )
        .returning();
      await f.kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: f.warehouseId,
          reason: 'bulk',
          lines: skus.map((sku) => ({ skuId: sku.id, quantity: 3, eventKey: randomUUID() })),
        },
        tx,
      );
      await f.kernel.recordArrival(
        {
          source: 'purchase_order',
          warehouseId: f.warehouseId,
          reason: 'bulk',
          lines: skus.map((sku) => ({ skuId: sku.id, quantity: 4, eventKey: randomUUID() })),
        },
        tx,
      );
      await tx.insert(wmsTables.stockLedgers).values(
        ['DEFECTIVE', 'IN_TRANSFER'].map((stockState) => ({
          skuId: f.skuId,
          warehouseId: f.warehouseId,
          locationId: f.origin,
          stockState: stockState as 'DEFECTIVE' | 'IN_TRANSFER',
          qty: 5,
        })),
      );
      queries.length = 0;
      const result = await contents(tx, f.origin);
      expect(queries).toHaveLength(2); // Location identity + one bulk statement, independent of SKU/receipt count.
      expect(result.items).toHaveLength(28);
      for (const sku of skus)
        expect(result.items.find((item) => item.skuId === sku.id)).toMatchObject({
          quantity: 7,
          inboundPendingQty: 7,
          generallyMovableQty: 0,
        });
      for (const item of result.items.filter((item) => item.stockState !== 'ON_HAND'))
        expect(item).toMatchObject({ quantity: 5, inboundPendingQty: 0, generallyMovableQty: 0 });
    });
  });

  it('excludes voided receipts and ordinary shelf receipts from pending', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await fixture(tx);
      const [line] = await tx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, f.lineId));
      await tx
        .update(wmsTables.inboundReceipts)
        .set({ status: 'voided' })
        .where(eq(wmsTables.inboundReceipts.id, line.receiptId));
      expect((await contents(tx, f.origin)).items[0]).toMatchObject({
        quantity: 10,
        inboundPendingQty: 0,
        generallyMovableQty: 10,
      });
      await f.kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          locationId: f.locationId,
          warehouseId: f.warehouseId,
          reason: 'shelf arrival',
          lines: [{ skuId: f.skuId, quantity: 3, eventKey: randomUUID() }],
        },
        tx,
      );
      expect((await contents(tx, f.locationId)).items[0]).toMatchObject({
        quantity: 3,
        inboundPendingQty: 0,
        generallyMovableQty: 3,
      });
    });
  });

  it.each(['putaway', 'acquire'] as const)(
    '%s first serializes putaway against session acquisition on independent connections',
    async (first) => {
      const workerA = makeDb(DATABASE_URL as string);
      const workerB = makeDb(DATABASE_URL as string);
      let release!: () => void;
      const barrier = new Promise<void>((resolve) => {
        release = resolve;
      });
      let ready!: () => void;
      const entered = new Promise<void>((resolve) => {
        ready = resolve;
      });
      let a: Promise<unknown> | undefined;
      let b: Promise<unknown> | undefined;
      const f = await db.transaction(async (tx) => {
        const seeded = await fixture(tx, 2, 2);
        const planned = await plan(seeded, tx);
        return { ...seeded, planId: planned.planId };
      });
      try {
        const [{ pid: pidA }] = await workerA.sql<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        const [{ pid: pidB }] = await workerB.sql<{ pid: number }[]>`SELECT pg_backend_pid()::int AS pid`;
        const run = async (action: 'putaway' | 'acquire', tx: DbTx) => {
          if (action === 'putaway') {
            await makeInboundReceiptKernel(tx as never).putaway(
              { receiptLineId: f.lineId, toLocationId: f.locationId, quantity: 6, eventKey: randomUUID() },
              tx,
            );
          } else {
            const result = planning(tx).sessions.startSession(f.batchId, f.planId, tx, f.actorId);
            if (first === 'putaway')
              await expect(result).rejects.toMatchObject({ response: { code: 'PICKING_PLAN_SOURCE_STALE' } });
            else await result;
          }
        };
        a = workerA.db.transaction(async (tx) => {
          await tx.execute(sqlQuery`SET LOCAL statement_timeout = '8s'`);
          await run(first, tx);
          ready();
          await barrier;
        });
        const outcomeA = a.then(
          () => ({ ok: true as const }),
          (error: unknown) => ({ ok: false as const, error }),
        );
        await Promise.race([
          entered,
          outcomeA.then((outcome) => {
            if (!outcome.ok) throw outcome.error;
            throw new Error('first worker missed barrier');
          }),
        ]);
        let completed = false;
        b = workerB.db.transaction(async (tx) => {
          await tx.execute(sqlQuery`SET LOCAL statement_timeout = '8s'`);
          await run(first === 'putaway' ? 'acquire' : 'putaway', tx);
        });
        const outcomeB = b.then(
          () => {
            completed = true;
            return { ok: true as const };
          },
          (error: unknown) => {
            completed = true;
            return { ok: false as const, error };
          },
        );
        let blocked = false;
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline && !completed) {
          const [{ waiting }] = await sql<
            { waiting: boolean }[]
          >`SELECT ${pidA}::int = ANY(pg_blocking_pids(${pidB}::int)) AS waiting`;
          if (waiting) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        expect(completed).toBe(false);
        release();
        for (const outcome of await Promise.all([outcomeA, outcomeB])) if (!outcome.ok) throw outcome.error;
        await db.transaction(async (tx) => {
          const availability = await planning(tx).controlledStock.getAvailability(
            { skuId: f.skuId, warehouseId: f.warehouseId, sourceLocationId: f.origin },
            tx,
          );
          expect(availability).toMatchObject({
            onHandQty: 6,
            inboundPendingQty: 4,
            batchControlledQty: first === 'acquire' ? 2 : 0,
            generallyAvailableQty: first === 'acquire' ? 0 : 2,
          });
          const [line] = await tx
            .select()
            .from(wmsTables.inboundReceiptLines)
            .where(eq(wmsTables.inboundReceiptLines.id, f.lineId));
          expect(line).toMatchObject({ quantity: 10, putawayFromOriginQty: 6, returnedQty: 0, canceledQty: 0 });
          expect((await contents(tx, f.locationId)).items[0]).toMatchObject({ quantity: 6, generallyMovableQty: 6 });
          expect(
            await tx
              .select()
              .from(wmsTables.batchInventorySessionBalances)
              .where(eq(wmsTables.batchInventorySessionBalances.skuId, f.skuId)),
          ).toHaveLength(first === 'acquire' ? 1 : 0);
        });
      } finally {
        release();
        await Promise.allSettled([a, b].filter((promise): promise is Promise<unknown> => Boolean(promise)));
        await Promise.all([workerA.sql.end(), workerB.sql.end()]);
        await cleanup(f);
      }
    },
  );

  async function cleanup(f: Awaited<ReturnType<typeof fixture>> & { planId: string }) {
    await db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(wmsTables.fulfillmentOrderItems)
        .where(eq(wmsTables.fulfillmentOrderItems.skuId, f.skuId));
      if (!item?.salesOrderId || !item.salesOrderLineId) {
        throw new Error('Expected the seeded shipment to retain its sales order and line for cleanup.');
      }
      const [sku] = await tx.select().from(wmsTables.skus).where(eq(wmsTables.skus.id, f.skuId));
      await tx.execute(
        sqlQuery`DELETE FROM batch_inventory_session_events WHERE session_id IN (SELECT id FROM batch_inventory_sessions WHERE batch_id = ${f.batchId})`,
      );
      await tx
        .delete(wmsTables.batchInventorySessionBalances)
        .where(eq(wmsTables.batchInventorySessionBalances.skuId, f.skuId));
      await tx.delete(wmsTables.batchInventorySessions).where(eq(wmsTables.batchInventorySessions.batchId, f.batchId));
      await tx
        .delete(wmsTables.pickingSourceAllocations)
        .where(eq(wmsTables.pickingSourceAllocations.planId, f.planId));
      await tx.delete(wmsTables.pickingPlanMembers).where(eq(wmsTables.pickingPlanMembers.planId, f.planId));
      await tx.delete(wmsTables.pickingPlans).where(eq(wmsTables.pickingPlans.id, f.planId));
      await tx
        .delete(wmsTables.fulfillmentCommandRequests)
        .where(eq(wmsTables.fulfillmentCommandRequests.resourceId, f.planId));
      await tx.delete(wmsTables.auditLogs).where(eq(wmsTables.auditLogs.userId, f.actorId));
      await tx.delete(wmsTables.outboundBatchWorkItems).where(eq(wmsTables.outboundBatchWorkItems.batchId, f.batchId));
      await tx.delete(wmsTables.outboundBatches).where(eq(wmsTables.outboundBatches.id, f.batchId));
      await tx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, f.shipmentLineId));
      await tx.delete(wmsTables.waybills).where(eq(wmsTables.waybills.shipmentId, f.shipmentId));
      await tx.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.id, f.shipmentLineId));
      await tx.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, f.shipmentId));
      await tx.delete(wmsTables.fulfillmentOrderItems).where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
      await tx.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, item.fulfillmentOrderId));
      await tx.delete(wmsTables.salesOrderLines).where(eq(wmsTables.salesOrderLines.id, item.salesOrderLineId));
      await tx.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, item.salesOrderId));
      await tx.delete(wmsTables.inboundWorkLogs).where(eq(wmsTables.inboundWorkLogs.warehouseId, f.warehouseId));
      await tx.execute(
        sqlQuery`DELETE FROM inbound_receipt_lines WHERE receipt_id IN (SELECT id FROM inbound_receipts WHERE warehouse_id = ${f.warehouseId})`,
      );
      await tx.delete(wmsTables.inboundReceipts).where(eq(wmsTables.inboundReceipts.warehouseId, f.warehouseId));
      const events = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
      await tx.delete(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.skuId));
      for (const journalId of new Set(events.map((event) => event.journalId).filter(Boolean)))
        await tx.delete(wmsTables.stockJournals).where(eq(wmsTables.stockJournals.id, journalId!));
      await tx.delete(wmsTables.stockLedgers).where(eq(wmsTables.stockLedgers.skuId, f.skuId));
      await tx.delete(wmsTables.skuBarcodes).where(eq(wmsTables.skuBarcodes.skuId, f.skuId));
      await tx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, f.skuId));
      await tx.delete(wmsTables.holders).where(eq(wmsTables.holders.id, f.holderId));
      await tx.delete(wmsTables.locations).where(eq(wmsTables.locations.warehouseId, f.warehouseId));
      await tx.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, f.warehouseId));
      await tx.delete(wmsTables.deliveryProfiles).where(eq(wmsTables.deliveryProfiles.id, sku.deliveryProfileId!));
    });
  }
});
