import { randomUUID } from 'crypto';
import { eq, sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { PurchaseOrderReceivingManager } from '../../procurement/services/purchase-order-receiving.manager';
import { PurchaseOrderHeaderDeriver } from '../../procurement/services/purchase-order-header.deriver';
import { PurchaseOrderReader } from '../../procurement/services/purchase-order.reader';
import { StocktakingService } from '../../stocktaking/services/stocktaking.service';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import {
  Database,
  inRollbackTx,
  makeInboundService,
  makeInboundReceiptKernel,
  makeMovementService,
  buildWiring,
} from '../../inbound/services/__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('Inbound origin protection at the stock write boundary', () => {
  let client: postgres.Sql;
  let db: Database;
  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  async function seed(tx: DbTx, quantity = 10) {
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `protection-${randomUUID()}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `protection-${randomUUID()}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'protection', code: randomUUID(), holderId: holder.id })
      .returning();
    const [shelf] = await tx
      .insert(wmsTables.locations)
      .values({ warehouseId: warehouse.id, code: 'SHELF', locationType: 'zone' })
      .returning();
    const result = await makeInboundService(db).simpleInbound(
      { warehouseId: warehouse.id, items: [{ skuId: sku.id, quantity }], idempotencyKey: randomUUID() },
      tx,
    );
    return { warehouse, sku, shelf, line: result.lines[0], origin: result.lines[0].originLocationId! };
  }

  async function snapshot(tx: DbTx) {
    return {
      ledgers: await tx
        .select()
        .from(wmsTables.stockLedgers)
        .orderBy(wmsTables.stockLedgers.skuId, wmsTables.stockLedgers.locationId, wmsTables.stockLedgers.stockState),
      events: await tx.select().from(wmsTables.stockEvents).orderBy(wmsTables.stockEvents.id),
      lines: await tx.select().from(wmsTables.inboundReceiptLines).orderBy(wmsTables.inboundReceiptLines.id),
      logs: await tx.select().from(wmsTables.inboundWorkLogs).orderBy(wmsTables.inboundWorkLogs.id),
      receipts: await tx.select().from(wmsTables.inboundReceipts).orderBy(wmsTables.inboundReceipts.id),
      poLines: await tx
        .select()
        .from(wmsTables.purchaseOrderLines)
        .orderBy(wmsTables.purchaseOrderLines.poId, wmsTables.purchaseOrderLines.skuId),
      poHeaders: await tx.select().from(wmsTables.purchaseOrders).orderBy(wmsTables.purchaseOrders.id),
      movement: await tx.select().from(wmsTables.movementJobs).orderBy(wmsTables.movementJobs.id),
    };
  }

  it('receive 10 → real general movement 6 rejects without changing inventory or work records', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const before = await snapshot(tx);
      const movement = makeMovementService(tx as unknown as Database);
      await expect(
        movement.moveImmediately({
          warehouseId: f.warehouse.id,
          idempotencyKey: randomUUID(),
          lines: [{ skuId: f.sku.id, fromLocationId: f.origin, toLocationId: f.shelf.id, quantity: 6 }],
        }),
      ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' } });
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it.each([
    'adjustDown',
    'physical count adjustment',
    'transferShip',
    'ship',
    'reverseReceive',
    'changeState',
    'directCreate',
  ] as const)('%s cannot consume pending receipts', async (path) => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const { command, eventStore, dbService } = buildWiring(db);
      const before = await snapshot(tx);
      const common = {
        skuId: f.sku.id,
        warehouseId: f.warehouse.id,
        locationId: f.origin,
        quantity: 6,
        idempotencyKey: randomUUID(),
      };
      await expect(
        tx.transaction(async (sp) => {
          if (path === 'adjustDown') return command.adjustDown(common, sp);
          if (path === 'physical count adjustment') {
            const [session] = await sp
              .insert(wmsTables.stocktakingSessions)
              .values({ warehouseId: f.warehouse.id, sessionName: 'pending-count', status: 'in_progress' })
              .returning();
            await sp.insert(wmsTables.stocktakingLines).values({
              sessionId: session.id,
              skuId: f.sku.id,
              locationId: f.origin,
              expectedQuantity: 10,
              countedQuantity: 4,
              variance: -6,
              status: 'counted',
            });
            return new StocktakingService(dbService, command).completeSession(session.id, sp);
          }
          if (path === 'transferShip')
            return command.transferShip({ ...common, fromWarehouseId: f.warehouse.id, fromLocationId: f.origin }, sp);
          if (path === 'ship') return command.ship(common, sp);
          if (path === 'reverseReceive') return eventStore.reverseEvent(f.line.eventId!, 'direct reversal', sp);
          return eventStore.createEvent(
            {
              skuId: f.sku.id,
              fromWarehouseId: f.warehouse.id,
              fromLocationId: f.origin,
              fromState: 'ON_HAND',
              transitionType: path === 'changeState' ? 'MARK_DEFECT' : 'ADJUST_DOWN',
              ...(path === 'changeState'
                ? { toWarehouseId: f.warehouse.id, toLocationId: f.origin, toState: 'DEFECTIVE' as const }
                : {}),
              quantity: 6,
              occurredAt: new Date(),
            },
            sp,
          );
        }),
      ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' } });
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it('putaway releases only the selected line; shelf movement and new receipts preserve pending amounts', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const kernel = makeInboundReceiptKernel(db);
      const other = await kernel.recordArrival(
        {
          source: 'purchase_order',
          warehouseId: f.warehouse.id,
          reason: 'planned',
          lines: [{ skuId: f.sku.id, quantity: 3, eventKey: randomUUID() }],
        },
        tx,
      );
      await kernel.putaway(
        { receiptLineId: f.line.id, toLocationId: f.shelf.id, quantity: 6, eventKey: randomUUID() },
        tx,
      );
      const { guard } = buildWiring(db);
      expect(
        await guard.getAvailability({ skuId: f.sku.id, warehouseId: f.warehouse.id, sourceLocationId: f.origin }, tx),
      ).toMatchObject({ onHandQty: 7, inboundPendingQty: 7, generallyAvailableQty: 0 });
      const [otherLine] = await tx
        .select()
        .from(wmsTables.inboundReceiptLines)
        .where(eq(wmsTables.inboundReceiptLines.id, other.lines[0].id));
      expect(otherLine.putawayFromOriginQty).toBe(0);
      const [shelf2] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: f.warehouse.id, code: 'SHELF2', locationType: 'zone' })
        .returning();
      await makeMovementService(tx as unknown as Database).moveImmediately({
        warehouseId: f.warehouse.id,
        idempotencyKey: randomUUID(),
        lines: [{ skuId: f.sku.id, fromLocationId: f.shelf.id, toLocationId: shelf2.id, quantity: 6 }],
      });
      await kernel.putaway(
        { receiptLineId: f.line.id, toLocationId: f.shelf.id, quantity: 4, eventKey: randomUUID() },
        tx,
      );
      await kernel.recordArrival(
        {
          source: 'direct',
          method: 'simple',
          warehouseId: f.warehouse.id,
          reason: 'new',
          lines: [{ skuId: f.sku.id, quantity: 1, eventKey: randomUUID() }],
        },
        tx,
      );
      expect(
        await guard.getAvailability({ skuId: f.sku.id, warehouseId: f.warehouse.id, sourceLocationId: f.origin }, tx),
      ).toMatchObject({ onHandQty: 4, inboundPendingQty: 4 });
    });
  });

  it.each(['same origin', 'other system'] as const)(
    'putaway rejects %s destination atomically',
    async (destination) => {
      await inRollbackTx(db, async (tx) => {
        const f = await seed(tx);
        const { location } = buildWiring(db);
        const rework = await location.getSystemLocationByRole(f.warehouse.id, 'outbound_rework', tx);
        const before = await snapshot(tx);
        await expect(
          tx.transaction((sp) =>
            makeInboundReceiptKernel(db).putaway(
              {
                receiptLineId: f.line.id,
                toLocationId: destination === 'same origin' ? f.origin : rework!.id,
                quantity: 2,
                eventKey: randomUUID(),
              },
              sp,
            ),
          ),
        ).rejects.toMatchObject({ response: { code: 'INBOUND_PUTAWAY_DESTINATION_INVALID' } });
        expect(await snapshot(tx)).toEqual(before);
      });
    },
  );

  it('free system stock can move and successful event replays remain successful after availability changes', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const { command, eventStore, guard } = buildWiring(db);
      await command.receive(
        { skuId: f.sku.id, toWarehouseId: f.warehouse.id, toLocationId: f.origin, quantity: 2 },
        tx,
      );
      expect(
        await guard.getAvailability({ skuId: f.sku.id, warehouseId: f.warehouse.id, sourceLocationId: f.origin }, tx),
      ).toMatchObject({ onHandQty: 12, inboundPendingQty: 10, generallyAvailableQty: 2 });
      const [original] = await tx
        .select()
        .from(wmsTables.stockEvents)
        .where(eq(wmsTables.stockEvents.id, f.line.eventId!));
      const input = {
        journalId: original.journalId!,
        skuId: f.sku.id,
        fromWarehouseId: f.warehouse.id,
        fromLocationId: f.origin,
        fromState: 'ON_HAND' as const,
        toWarehouseId: f.warehouse.id,
        toLocationId: f.shelf.id,
        toState: 'ON_HAND' as const,
        transitionType: 'MOVE' as const,
        quantity: 2,
        occurredAt: new Date(),
        idempotencyKey: randomUUID(),
      };
      const event = await eventStore.createEvent(input, tx);
      const before = await snapshot(tx);
      expect((await eventStore.createEvent(input, tx))?.id).toBe(event?.id);
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it('the final projection itself rejects a net source decrease without relying on command guards', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const before = await snapshot(tx);
      await expect(
        tx.transaction((sp) =>
          buildWiring(db).eventStore['applyProjection'](sp, {
            skuId: f.sku.id,
            fromWarehouseId: f.warehouse.id,
            fromLocationId: f.origin,
            fromState: 'ON_HAND',
            toWarehouseId: f.warehouse.id,
            toLocationId: f.shelf.id,
            toState: 'ON_HAND',
            quantity: 6,
          }),
        ),
      ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' } });
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it('same-grain ON_HAND projection has no net removal (public events reject this grain in the schema)', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const { eventStore, guard } = buildWiring(db);
      await eventStore['applyProjection'](tx, {
        skuId: f.sku.id,
        fromWarehouseId: f.warehouse.id,
        fromLocationId: f.origin,
        fromState: 'ON_HAND',
        toWarehouseId: f.warehouse.id,
        toLocationId: f.origin,
        toState: 'ON_HAND',
        quantity: 6,
      });
      expect(
        await guard.getAvailability({ skuId: f.sku.id, warehouseId: f.warehouse.id, sourceLocationId: f.origin }, tx),
      ).toMatchObject({ onHandQty: 10, inboundPendingQty: 10 });
    });
  });
  it.each(['putaway', 'return', 'cancel'] as const)(
    '%s rejects pre-existing origin inconsistency before releasing counters',
    async (action) => {
      await inRollbackTx(db, async (tx) => {
        const f = await seed(tx);
        // Historical corruption fixture: general movement is no longer allowed to create it.
        await tx.update(wmsTables.stockLedgers).set({ qty: 4 }).where(eq(wmsTables.stockLedgers.skuId, f.sku.id));
        const before = await snapshot(tx);
        const kernel = makeInboundReceiptKernel(db);
        await expect(
          tx.transaction<unknown>((sp) =>
            action === 'putaway'
              ? kernel.putaway(
                  { receiptLineId: f.line.id, toLocationId: f.shelf.id, quantity: 1, eventKey: randomUUID() },
                  sp,
                )
              : action === 'return'
                ? kernel.returnLine({ receiptLineId: f.line.id, quantity: 1, eventKey: randomUUID() }, sp)
                : kernel.cancelLine({ receiptLineId: f.line.id, expected: { source: 'direct' } }, sp),
          ),
        ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' } });
        expect(await snapshot(tx)).toEqual(before);
      });
    },
  );

  it.each(['putaway', 'return', 'cancel'] as const)(
    '%s rolls back released counters and all writes on ledger or work-log failure',
    async (action) => {
      await inRollbackTx(db, async (tx) => {
        const f = await seed(tx);
        const before = await snapshot(tx);
        for (const table of ['stock_ledgers', 'inbound_work_logs']) {
          await expect(
            tx.transaction(async (sp) => {
              // PostgreSQL failures exercise the actual SQL writes and caller savepoint rollback.
              await sp.execute(
                sql.raw(
                  `CREATE FUNCTION pg_temp.reject_inbound_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected ${table} failure'; END $$`,
                ),
              );
              await sp.execute(
                sql.raw(
                  `CREATE TRIGGER task2_reject BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_inbound_write()`,
                ),
              );
              const kernel = makeInboundReceiptKernel(db);
              if (action === 'putaway')
                await kernel.putaway(
                  { receiptLineId: f.line.id, toLocationId: f.shelf.id, quantity: 2, eventKey: randomUUID() },
                  sp,
                );
              else if (action === 'return')
                await kernel.returnLine({ receiptLineId: f.line.id, quantity: 2, eventKey: randomUUID() }, sp);
              else await kernel.cancelLine({ receiptLineId: f.line.id, expected: { source: 'direct' } }, sp);
            }),
          ).rejects.toMatchObject({ cause: { message: `injected ${table} failure` } });
          expect(await snapshot(tx)).toEqual(before);
        }
      });
    },
  );

  it('ordinary shelf direct arrival can still be canceled', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const kernel = makeInboundReceiptKernel(db);
      const direct = await kernel.recordArrival(
        {
          source: 'direct',
          method: 'individual',
          warehouseId: f.warehouse.id,
          locationId: f.shelf.id,
          reason: 'direct shelf',
          lines: [{ skuId: f.sku.id, quantity: 3, eventKey: randomUUID() }],
        },
        tx,
      );
      await kernel.cancelLine({ receiptLineId: direct.lines[0].id, expected: { source: 'direct' } }, tx);
      expect(
        await buildWiring(db).guard.getAvailability(
          { skuId: f.sku.id, warehouseId: f.warehouse.id, sourceLocationId: f.origin },
          tx,
        ),
      ).toMatchObject({ onHandQty: 10, inboundPendingQty: 10 });
    });
  });

  it('purchase-order settlement SQL failure rolls back cancellation, receipt counters, history and outstanding quantity', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const [supplier] = await tx
        .insert(wmsTables.suppliers)
        .values({ name: `supplier-${randomUUID()}` })
        .returning();
      const [po] = await tx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: 'domestic',
          supplierId: supplier.id,
          status: 'created',
          sourceWarehouseId: f.warehouse.id,
          destinationWarehouseId: f.warehouse.id,
          requiresTransfer: false,
        })
        .returning();
      await tx
        .insert(wmsTables.purchaseOrderLines)
        .values({ poId: po.id, skuId: f.sku.id, quantity: 10, orderedQty: 10, status: 'ordered' });
      const { dbService, idempotency } = buildWiring(db);
      const receiving = new PurchaseOrderReceivingManager(
        dbService,
        makeInboundReceiptKernel(db),
        idempotency,
        new PurchaseOrderHeaderDeriver(),
        new PurchaseOrderReader(dbService),
      );
      const received = await receiving.receive(
        po.id,
        { warehouseId: f.warehouse.id, idempotencyKey: randomUUID(), lines: [{ skuId: f.sku.id, quantity: 3 }] },
        tx,
      );
      const before = await snapshot(tx);
      await expect(
        tx.transaction(async (sp) => {
          await sp.execute(
            sql`CREATE FUNCTION pg_temp.reject_po_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected PO settlement failure'; END $$`,
          );
          await sp.execute(
            sql`CREATE TRIGGER task2_reject_po BEFORE UPDATE ON purchase_order_lines FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_po_settlement()`,
          );
          await receiving.cancelReceiptLine(received.lines[0].receiptLineId, { idempotencyKey: randomUUID() }, sp);
        }),
      ).rejects.toMatchObject({ cause: { message: 'injected PO settlement failure' } });
      expect(await snapshot(tx)).toEqual(before);
    });
  });

  it('pending plus custody share one free balance and overlapping historical protection is inconsistent', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const { command, guard } = buildWiring(db);
      await command.receive(
        { skuId: f.sku.id, toWarehouseId: f.warehouse.id, toLocationId: f.origin, quantity: 5 },
        tx,
      );
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({ batchNumber: randomUUID(), warehouseId: f.warehouse.id, pickingMethod: 'individual' })
        .returning();
      const [session] = await tx
        .insert(wmsTables.batchInventorySessions)
        .values({ batchId: batch.id, status: 'active', handedInQty: 3 })
        .returning();
      await tx.insert(wmsTables.batchInventorySessionBalances).values({
        sessionId: session.id,
        skuId: f.sku.id,
        sourceLocationId: f.origin,
        custodyType: 'AT_SOURCE',
        qty: 3,
      });
      const grain = { skuId: f.sku.id, warehouseId: f.warehouse.id, sourceLocationId: f.origin };
      expect(await guard.getAvailability(grain, tx)).toMatchObject({
        onHandQty: 15,
        inboundPendingQty: 10,
        batchControlledQty: 3,
        generallyAvailableQty: 2,
      });
      await expect(
        tx.transaction((sp) => guard.assertRemovalAllowed({ ...grain, quantity: 3 }, sp)),
      ).rejects.toMatchObject({ response: { code: 'INBOUND_ORIGIN_STOCK_PROTECTED' } });
      await command.moveInternal(
        {
          skuId: f.sku.id,
          warehouseId: f.warehouse.id,
          fromLocationId: f.origin,
          toLocationId: f.shelf.id,
          quantity: 2,
        },
        tx,
      );
      await makeInboundReceiptKernel(db).returnLine(
        { receiptLineId: f.line.id, quantity: 2, eventKey: randomUUID() },
        tx,
      );
      expect(await guard.getAvailability(grain, tx)).toMatchObject({
        onHandQty: 11,
        inboundPendingQty: 8,
        batchControlledQty: 3,
        generallyAvailableQty: 0,
      });
      await tx.update(wmsTables.stockLedgers).set({ qty: 10 }).where(eq(wmsTables.stockLedgers.locationId, f.origin));
      await expect(guard.getAvailability(grain, tx)).rejects.toMatchObject({
        response: { code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' },
      });
    });
  });
});
