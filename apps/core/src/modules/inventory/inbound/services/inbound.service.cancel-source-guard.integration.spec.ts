import { randomUUID } from 'crypto';
import { ConflictException } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../schema/inventory.schema';
import { InboundReceiptKernel } from '../kernel/inbound-receipt.kernel';
import { InboundService } from './inbound.service';
import { Database, inRollbackTx, makeInboundReceiptKernel, makeInboundService } from './__fixtures__/inbound-harness';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('POST /inbound/cancel 은 발주 입고 라인을 거절한다', () => {
  jest.setTimeout(120_000);

  let client: postgres.Sql;
  let db: Database;
  let svc: InboundService;
  let kernel: InboundReceiptKernel;

  beforeAll(() => {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is required');
    client = postgres(DATABASE_URL, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    svc = makeInboundService(db);
    kernel = makeInboundReceiptKernel(db);
  });

  afterAll(async () => {
    await client.end();
  });

  async function seed(tx: DbTx) {
    const suffix = randomUUID();
    const [warehouse] = await tx
      .insert(wmsTables.warehouses)
      .values({ name: `cancel-source-wh-${suffix.slice(0, 8)}` })
      .returning();
    const [holder] = await tx
      .insert(wmsTables.holders)
      .values({ name: `cancel-source-holder-${suffix.slice(0, 8)}` })
      .returning();
    const [sku] = await tx
      .insert(wmsTables.skus)
      .values({ name: 'cancel source sku', code: `CANCEL-SOURCE-${suffix}`, holderId: holder.id })
      .returning();

    return { warehouseId: warehouse.id, skuId: sku.id };
  }

  async function readState(tx: DbTx, receiptId: string, lineId: string, skuId: string) {
    const receipts = await tx
      .select()
      .from(wmsTables.inboundReceipts)
      .where(eq(wmsTables.inboundReceipts.id, receiptId));
    const lines = await tx
      .select()
      .from(wmsTables.inboundReceiptLines)
      .where(eq(wmsTables.inboundReceiptLines.id, lineId));
    const workLogs = await tx
      .select()
      .from(wmsTables.inboundWorkLogs)
      .where(eq(wmsTables.inboundWorkLogs.receiptId, receiptId))
      .orderBy(asc(wmsTables.inboundWorkLogs.id));
    const stockEvents = await tx
      .select()
      .from(wmsTables.stockEvents)
      .where(eq(wmsTables.stockEvents.skuId, skuId))
      .orderBy(asc(wmsTables.stockEvents.id));
    const stockLedgers = await tx
      .select()
      .from(wmsTables.stockLedgers)
      .where(eq(wmsTables.stockLedgers.skuId, skuId))
      .orderBy(asc(wmsTables.stockLedgers.locationId), asc(wmsTables.stockLedgers.stockState));

    return { receipts, lines, workLogs, stockEvents, stockLedgers };
  }

  it('source=purchase_order 라인 → 409 「발주 입고는 발주에서 취소하세요」, 원장·카운터 불변', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, skuId } = await seed(tx);
      const arrival = await kernel.recordArrival(
        {
          source: 'purchase_order',
          warehouseId,
          reason: 'planned_inbound',
          lines: [{ skuId, quantity: 2, eventKey: `k-${randomUUID()}` }],
        },
        tx,
      );
      const line = arrival.lines[0];
      if (!line) throw new Error('arrival line was not created');

      const before = await readState(tx, arrival.receipt.id, line.id, skuId);
      expect(before.receipts).toHaveLength(1);
      expect(before.receipts[0]).toMatchObject({ status: 'posted', totalQuantity: 2 });
      expect(before.lines).toHaveLength(1);
      expect(before.lines[0]).toMatchObject({
        source: 'purchase_order',
        quantity: 2,
        returnedQty: 0,
        canceledQty: 0,
        putawayFromOriginQty: 0,
      });
      expect(before.workLogs).toHaveLength(1);
      expect(before.stockEvents).toHaveLength(1);
      expect(before.stockLedgers).toHaveLength(1);
      expect(before.stockLedgers[0]?.qty).toBe(2);

      let rejection: unknown;
      try {
        await svc.cancelInbound({ lineId: line.id, quantity: 2, idempotencyKey: randomUUID() }, tx);
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(ConflictException);
      if (!(rejection instanceof ConflictException)) throw rejection;
      expect(rejection.getStatus()).toBe(409);
      expect(rejection.message).toBe('발주 입고는 발주에서 취소하세요');

      const after = await readState(tx, arrival.receipt.id, line.id, skuId);
      expect(after.receipts).toEqual(before.receipts);
      expect(after.lines).toEqual(before.lines);
      expect(after.workLogs).toEqual(before.workLogs);
      expect(after.stockEvents).toEqual(before.stockEvents);
      expect(after.stockLedgers).toEqual(before.stockLedgers);
    });
  });
});
