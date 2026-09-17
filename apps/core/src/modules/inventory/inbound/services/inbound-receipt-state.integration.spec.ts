import { Test } from '@nestjs/testing';
import { ScopeGuard, AuthorizationService } from '@app/authorization';
import * as request from 'supertest';
import { Server } from 'http';
import { Request } from 'express';
import { InboundController } from '../controllers/inbound.controllers';
import { InboundService } from './inbound.service';
import { InboundPutawayReader } from './inbound-putaway.reader';
import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptStateReader } from './inbound-receipt-state.reader';
import {
  Database,
  dbServiceFor,
  inRollbackTx,
  makeInboundService,
  makeInboundReceiptKernel,
  makeInboundPutawayReader,
} from './__fixtures__/inbound-harness';

const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;
describeIfDb('InboundReceiptStateReader (PostgreSQL)', () => {
  let client: postgres.Sql;
  let db: Database;
  let reader: InboundReceiptStateReader;
  const queries: string[] = [];
  beforeAll(() => {
    client = postgres(process.env.DATABASE_URL!, { max: 3 });
    db = drizzle(client, { schema: wmsSchema, logger: { logQuery: (query) => queries.push(query) } });
    reader = new InboundReceiptStateReader(dbServiceFor(db));
  });
  afterAll(async () => {
    await client.end();
  });
  async function seed(tx: DbTx, quantity = 3) {
    const [warehouse] = await tx.insert(wmsTables.warehouses).values({ name: randomUUID() }).returning();
    const [holder] = await tx.insert(wmsTables.holders).values({ name: randomUUID() }).returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: '상품', code: randomUUID(), holderId: holder.id })
      .returning();
    const receipt = await makeInboundReceiptKernel(db).recordArrival(
      {
        source: 'direct',
        method: 'simple',
        reason: 'state test',
        warehouseId: warehouse.id,
        lines: [{ skuId: sku.id, quantity, eventKey: randomUUID() }],
      },
      tx,
    );
    return { warehouse, sku, ...receipt, line: receipt.lines[0] };
  }
  it('looks up a canceled PO line without receiptId and retains original counters', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ source: 'purchase_order', canceledQty: 3 })
        .where(eq(wmsTables.inboundReceiptLines.id, f.line.id));
      expect(await reader.getLineState({ lineId: f.line.id, warehouseId: f.warehouse.id }, tx)).toMatchObject({
        lineId: f.line.id,
        receiptId: f.receipt.id,
        source: 'purchase_order',
        quantity: 3,
        canceledQty: 3,
        pendingQty: 0,
        canCancel: false,
        canPutaway: false,
        putawayBlockReason: 'CANCELED',
      });
    });
  });
  it('compares actual warehouse and distinguishes absent lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      await expect(reader.getLineState({ lineId: f.line.id, warehouseId: randomUUID() }, tx)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(reader.getLineState({ lineId: randomUUID(), warehouseId: f.warehouse.id }, tx)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
  it('keeps multiple receipt claims unclamped when the shared ledger is missing', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      await makeInboundService(db).simpleInbound(
        { warehouseId: f.warehouse.id, items: [{ skuId: f.sku.id, quantity: 5 }], idempotencyKey: randomUUID() },
        tx,
      );
      await tx.execute(sql`DELETE FROM stock_ledgers WHERE sku_id = ${f.sku.id}`);
      expect(await reader.getLineState({ lineId: f.line.id, warehouseId: f.warehouse.id }, tx)).toMatchObject({
        pendingQty: 3,
        canPutaway: false,
        canCancel: false,
        putawayBlockReason: 'ORIGIN_STOCK_INCONSISTENT',
      });
    });
  });
  it('reads caller uncommitted counters and ledger together without owning the transaction', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx, 10);
      await tx.execute(sql`UPDATE inbound_receipt_lines SET putaway_from_origin_qty = 6 WHERE id = ${f.line.id}`);
      await tx.execute(sql`UPDATE stock_ledgers SET qty = 4 WHERE sku_id = ${f.sku.id}`);
      expect(await reader.getLineState({ lineId: f.line.id, warehouseId: f.warehouse.id }, tx)).toMatchObject({
        pendingQty: 4,
        putawayFromOriginQty: 6,
        canPutaway: true,
        cancelBlockReason: 'ALREADY_PUTAWAY',
      });
      await tx.execute(sql`UPDATE inbound_receipt_lines SET canceled_qty = 4 WHERE id = ${f.line.id}`);
      await tx.execute(sql`UPDATE stock_ledgers SET qty = 0 WHERE sku_id = ${f.sku.id}`);
      expect(await reader.getLineState({ lineId: f.line.id, warehouseId: f.warehouse.id }, tx)).toMatchObject({
        pendingQty: 0,
        putawayBlockReason: 'CANCELED',
      });
    });
  });
  it('HTTP enforces OPERATE, UUIDs and the actual warehouse, and returns canceled PO lines', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      await tx
        .update(wmsTables.inboundReceiptLines)
        .set({ source: 'purchase_order', canceledQty: 3 })
        .where(eq(wmsTables.inboundReceiptLines.id, f.line.id));
      const module = await Test.createTestingModule({
        controllers: [InboundController],
        providers: [
          ScopeGuard,
          {
            provide: AuthorizationService,
            useValue: {
              getScopesByRoles: (roles: string[]) =>
                Promise.resolve(new Set(roles.includes('operator') ? ['inventory.operate'] : [])),
            },
          },
          { provide: InboundService, useValue: makeInboundService(db) },
          { provide: InboundPutawayReader, useValue: makeInboundPutawayReader(db) },
          {
            provide: InboundReceiptStateReader,
            useValue: {
              getLineState: (params: { lineId: string; warehouseId: string }) => reader.getLineState(params, tx),
            },
          },
        ],
      }).compile();
      const app = module.createNestApplication();
      app.use((req: Request & { user?: { roles: string[] } }, _res: unknown, next: () => void) => {
        const role = req.headers['x-test-role'];
        if (typeof role === 'string') req.user = { roles: [role] };
        next();
      });
      await app.init();
      try {
        const http = app.getHttpServer() as Server;
        const path = `/inbound/lines/${f.line.id}/state`;
        await request(http).get(path).query({ warehouseId: f.warehouse.id }).expect(403);
        await request(http).get(path).set('x-test-role', 'viewer').query({ warehouseId: f.warehouse.id }).expect(403);
        await request(http).get(path).set('x-test-role', 'operator').query({ warehouseId: randomUUID() }).expect(403);
        await request(http).get(path).set('x-test-role', 'operator').expect(400);
        await request(http)
          .get(path)
          .set('x-test-role', 'operator')
          .query({ warehouseId: ['bad', f.warehouse.id] })
          .expect(400);
        await request(http)
          .get('/inbound/lines/bad/state')
          .set('x-test-role', 'operator')
          .query({ warehouseId: f.warehouse.id })
          .expect(400);
        await request(http)
          .get(`/inbound/lines/${randomUUID()}/state`)
          .set('x-test-role', 'operator')
          .query({ warehouseId: f.warehouse.id })
          .expect(404);
        const response = await request(http)
          .get(path)
          .set('x-test-role', 'operator')
          .query({ warehouseId: f.warehouse.id })
          .expect(200);
        expect(response.body).toMatchObject({
          lineId: f.line.id,
          source: 'purchase_order',
          canceledQty: 3,
          pendingQty: 0,
          canCancel: false,
          putawayBlockReason: 'CANCELED',
        });
        expect(Object.keys(response.body as Record<string, unknown>).sort()).toEqual(
          [
            'lineId',
            'receiptId',
            'warehouseId',
            'source',
            'receiptStatus',
            'skuId',
            'skuCode',
            'skuName',
            'originLocationId',
            'originLocationCode',
            'quantity',
            'putawayFromOriginQty',
            'canceledQty',
            'returnedQty',
            'pendingQty',
            'canPutaway',
            'putawayBlockReason',
            'canCancel',
            'cancelBlockReason',
          ].sort(),
        );
        await request(http)
          .get('/inbound/putaway/pending')
          .set('x-test-role', 'operator')
          .query({ warehouseId: f.warehouse.id, originLocationId: 'bad' })
          .expect(400);
      } finally {
        await app.close();
      }
    });
  });

  it.each([
    ['quantity = 0', 'ORIGIN_STOCK_INCONSISTENT'],
    ['quantity = -1', 'ORIGIN_STOCK_INCONSISTENT'],
    ['putaway_from_origin_qty = -1', 'ORIGIN_STOCK_INCONSISTENT'],
    ['returned_qty = -1', 'ORIGIN_STOCK_INCONSISTENT'],
    ['canceled_qty = -1', 'ORIGIN_STOCK_INCONSISTENT'],
    ['putaway_from_origin_qty = 4', 'ORIGIN_STOCK_INCONSISTENT'],
    ['origin_location_id = NULL', 'MISSING_ORIGIN_OR_EVENT'],
    ['event_id = NULL', 'MISSING_ORIGIN_OR_EVENT'],
  ])('retains invalid legacy facts: %s', async (patch, reason) => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      await tx.execute(sql`UPDATE inbound_receipt_lines SET ${sql.raw(patch)} WHERE id = ${f.line.id}`);
      const state = await reader.getLineState({ lineId: f.line.id, warehouseId: f.warehouse.id }, tx);
      expect(state).toMatchObject({ canPutaway: false, canCancel: false, putawayBlockReason: reason });
      expect(state.pendingQty).toBe(
        state.quantity - state.putawayFromOriginQty - state.returnedQty - state.canceledQty,
      );
      const pending = await makeInboundPutawayReader(db).listPending({ warehouseId: f.warehouse.id }, tx);
      expect(pending.items[0]).toMatchObject({
        lineId: f.line.id,
        pendingQty: state.pendingQty,
        putawayBlockReason: reason,
      });
    });
  });
  it('blocks a cross-warehouse origin while retaining the line in pending and history', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx),
        other = await seed(tx);
      await tx.execute(
        sql`UPDATE inbound_receipt_lines SET origin_location_id = ${other.line.originLocationId} WHERE id = ${f.line.id}`,
      );
      expect(await reader.getLineState({ lineId: f.line.id, warehouseId: f.warehouse.id }, tx)).toMatchObject({
        putawayBlockReason: 'MISSING_ORIGIN_OR_EVENT',
      });
      expect(
        (await makeInboundPutawayReader(db).listPending({ warehouseId: f.warehouse.id }, tx)).items[0],
      ).toMatchObject({ lineId: f.line.id, putawayBlockReason: 'MISSING_ORIGIN_OR_EVENT' });
      expect(
        (await makeInboundService(db).listInboundReceipts({ warehouseId: f.warehouse.id }, tx)).items[0].lines[0],
      ).toMatchObject({ cancelBlockReason: 'MISSING_ORIGIN_OR_EVENT' });
    });
  });
  it('preserves direct shelf cancellation and excludes shelf receipts from pending', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      const [shelf] = await tx
        .insert(wmsTables.locations)
        .values({ warehouseId: f.warehouse.id, code: randomUUID(), locationType: 'zone' })
        .returning();
      const arrival = await makeInboundReceiptKernel(db).recordArrival(
        {
          source: 'direct',
          method: 'individual',
          reason: 'shelf',
          warehouseId: f.warehouse.id,
          locationId: shelf.id,
          lines: [{ skuId: f.sku.id, quantity: 7, eventKey: randomUUID() }],
        },
        tx,
      );
      const lineId = arrival.lines[0].id;
      expect(await reader.getLineState({ lineId, warehouseId: f.warehouse.id }, tx)).toMatchObject({
        canCancel: true,
        canPutaway: false,
        putawayBlockReason: 'NOT_STAGING_ORIGIN',
      });
      expect(
        (await makeInboundPutawayReader(db).listPending({ warehouseId: f.warehouse.id }, tx)).items.map(
          (row) => row.lineId,
        ),
      ).not.toContain(lineId);
      await makeInboundReceiptKernel(db).cancelLine({ receiptLineId: lineId, expected: { source: 'direct' } }, tx);
      expect(await reader.getLineState({ lineId, warehouseId: f.warehouse.id }, tx)).toMatchObject({
        canceledQty: 7,
        cancelBlockReason: 'CANCELED',
      });
    });
  });
  it('aggregates active custody and every competing receipt once for all projections', async () => {
    await inRollbackTx(db, async (tx) => {
      const f = await seed(tx);
      await makeInboundReceiptKernel(db).recordArrival(
        {
          source: 'purchase_order',
          reason: 'other',
          warehouseId: f.warehouse.id,
          lines: [{ skuId: f.sku.id, quantity: 5, eventKey: randomUUID() }],
        },
        tx,
      );
      const [batch] = await tx
        .insert(wmsTables.outboundBatches)
        .values({ warehouseId: f.warehouse.id, batchNumber: randomUUID(), pickingMethod: 'individual' })
        .returning();
      const [session] = await tx.insert(wmsTables.batchInventorySessions).values({ batchId: batch.id }).returning();
      await tx.insert(wmsTables.batchInventorySessionBalances).values({
        sessionId: session.id,
        skuId: f.sku.id,
        sourceLocationId: f.line.originLocationId,
        custodyType: 'AT_SOURCE',
        qty: 1,
      });
      const params = { warehouseId: f.warehouse.id };
      queries.length = 0;
      const state = await reader.getLineState({ ...params, lineId: f.line.id }, tx);
      expect(queries).toHaveLength(1);
      expect(state).toMatchObject({ pendingQty: 3, putawayBlockReason: 'ORIGIN_STOCK_INCONSISTENT' });
      queries.length = 0;
      const pending = await makeInboundPutawayReader(db).listPending(params, tx);
      expect(queries).toHaveLength(1);
      expect(pending.items).toHaveLength(2);
      expect(pending.items.every((row) => row.putawayBlockReason === 'ORIGIN_STOCK_INCONSISTENT')).toBe(true);
      queries.length = 0;
      const history = await makeInboundService(db).listInboundReceipts(params, tx);
      expect(queries).toHaveLength(1);
      expect(
        history.items
          .flatMap((item) => item.lines)
          .every((row) => row.cancelBlockReason === 'INSUFFICIENT_ORIGIN_STOCK'),
      ).toBe(true);
      await tx.execute(sql`UPDATE stock_ledgers SET qty = 9 WHERE sku_id = ${f.sku.id}`);
      expect(await reader.getLineState({ ...params, lineId: f.line.id }, tx)).toMatchObject({
        canPutaway: true,
        canCancel: true,
      });
    });
  });

  it.each(['putaway', 'cancel'] as const)(
    'independent readers see complete snapshots before and after %s commits',
    async (operation) => {
      const f = await db.transaction((tx) => seed(tx, 10));
      const [shelf] = await db
        .insert(wmsTables.locations)
        .values({ warehouseId: f.warehouse.id, code: randomUUID(), locationType: 'zone' })
        .returning();
      let release!: () => void, changed!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        changed = resolve;
      });
      const writerClient = postgres(process.env.DATABASE_URL!, { max: 1 });
      const writerDb = drizzle(writerClient, { schema: wmsSchema });
      const writer = writerDb.transaction(async (tx) => {
        const kernel = makeInboundReceiptKernel(writerDb);
        if (operation === 'putaway')
          await kernel.putaway(
            { receiptLineId: f.line.id, toLocationId: shelf.id, quantity: 6, eventKey: randomUUID() },
            tx,
          );
        else await kernel.cancelLine({ receiptLineId: f.line.id, expected: { source: 'direct' } }, tx);
        changed();
        await held;
      });
      try {
        await Promise.race([
          ready,
          writer.then(() => {
            throw new Error('writer did not reach barrier');
          }),
        ]);
        const params = { warehouseId: f.warehouse.id };
        expect(await reader.getLineState({ ...params, lineId: f.line.id })).toMatchObject({
          pendingQty: 10,
          canPutaway: true,
          canCancel: true,
        });
        expect((await makeInboundPutawayReader(db).listPending(params)).items[0]).toMatchObject({
          pendingQty: 10,
          canPutaway: true,
        });
        expect((await makeInboundService(db).listInboundReceipts(params)).items[0].lines[0]).toMatchObject({
          putawayFromOriginQty: 0,
          canceledQty: 0,
          canCancel: true,
        });
        release();
        await writer;
        expect(await reader.getLineState({ ...params, lineId: f.line.id })).toMatchObject(
          operation === 'putaway'
            ? { pendingQty: 4, putawayFromOriginQty: 6, canPutaway: true, cancelBlockReason: 'ALREADY_PUTAWAY' }
            : { pendingQty: 0, canceledQty: 10, canPutaway: false, cancelBlockReason: 'CANCELED' },
        );
        const pending = await makeInboundPutawayReader(db).listPending(params);
        expect(pending.items).toHaveLength(operation === 'putaway' ? 1 : 0);
        if (operation === 'putaway') expect(pending.items[0]).toMatchObject({ pendingQty: 4, canPutaway: true });
        const history = await makeInboundService(db).listInboundReceipts({ ...params, status: 'all' });
        expect(history.items[0].lines[0]).toMatchObject({
          canCancel: false,
          cancelBlockReason: operation === 'putaway' ? 'PUTAWAY_EXISTS' : 'ALREADY_CANCELED',
        });
      } finally {
        release();
        await writer.catch(() => undefined);
        await writerClient.end();
        await db.transaction(async (tx) => {
          await tx.execute(sql`DELETE FROM inbound_work_logs WHERE warehouse_id = ${f.warehouse.id}`);
          await tx.execute(sql`DELETE FROM inbound_receipt_lines WHERE receipt_id = ${f.receipt.id}`);
          await tx.execute(sql`DELETE FROM inbound_receipts WHERE id = ${f.receipt.id}`);
          const events = await tx.select().from(wmsTables.stockEvents).where(eq(wmsTables.stockEvents.skuId, f.sku.id));
          await tx.execute(sql`DELETE FROM stock_events WHERE sku_id = ${f.sku.id}`);
          for (const journalId of new Set(events.map((event) => event.journalId).filter(Boolean)))
            await tx.execute(sql`DELETE FROM stock_journals WHERE id = ${journalId}`);
          await tx.execute(sql`DELETE FROM stock_ledgers WHERE sku_id = ${f.sku.id}`);
          await tx.execute(sql`DELETE FROM skus WHERE id = ${f.sku.id}`);
          await tx.execute(sql`DELETE FROM holders WHERE id = ${f.sku.holderId}`);
          await tx.execute(sql`DELETE FROM locations WHERE warehouse_id = ${f.warehouse.id}`);
          await tx.execute(sql`DELETE FROM warehouses WHERE id = ${f.warehouse.id}`);
        });
      }
    },
  );
});
