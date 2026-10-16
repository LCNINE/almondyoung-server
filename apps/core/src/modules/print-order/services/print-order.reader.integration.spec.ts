import { randomUUID } from 'crypto';
import { wmsTables, type DbTx } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../../fulfillment/services/__support__';
import { type PrintOrderRow } from '../schema/print-order.schema';
import { CANCEL_CLAIM_STALE_MS } from './print-order-cancellation.manager';
import { phoneDigits, PrintOrderReader, storedPhoneDigits } from './print-order.reader';
import { eq, sql } from 'drizzle-orm';
import { PrintOrderRepository } from './print-order.repository';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('PrintOrderReader board (tabs, summary)', () => {
  type Db = ReturnType<typeof makeDb>;
  let conn: Db;

  beforeAll(() => {
    conn = makeDb(DATABASE_URL ?? '');
  });

  afterAll(async () => {
    await conn.sql.end();
  });

  async function seedOrder(
    tx: DbTx,
    customerName: string,
    customerPhone = '010-0000-0000',
    {
      quantity = 1,
      orderStatus = 'confirmed' as const,
    }: { quantity?: number; orderStatus?: 'confirmed' | 'cancelled' } = {},
  ): Promise<{ salesOrderId: string; lineId: string }> {
    const salesOrderId = randomUUID();
    const lineId = randomUUID();
    await tx.insert(wmsTables.salesOrders).values({
      id: salesOrderId,
      channelOrderId: `order_${salesOrderId}`,
      displayOrderNo: `D${salesOrderId.slice(0, 6)}`,
      salesChannel: 'medusa',
      status: orderStatus,
      customerName,
      customerPhone,
      shippingAddress: {},
      orderDate: new Date(),
    });
    await tx.insert(wmsTables.salesOrderLines).values({
      id: lineId,
      salesOrderId,
      variantId: randomUUID(),
      productName: '명함',
      quantity,
      almondDesignId: randomUUID(),
    });
    return { salesOrderId, lineId };
  }

  async function seedPrint(tx: DbTx, customerName: string, over: Partial<PrintOrderRow>): Promise<string> {
    const { salesOrderId, lineId } = await seedOrder(tx, customerName);
    const [row] = await tx
      .insert(wmsTables.printOrders)
      .values({ salesOrderId, salesOrderLineId: lineId, almondDesignId: randomUUID(), ...over })
      .returning({ id: wmsTables.printOrders.id });
    return row?.id ?? '';
  }

  it('normalizes stored phones exactly like the search term (landline and mobile, +82 or not)', async () => {
    const samples: Array<[string, string]> = [
      ['010-1234-5678', '01012345678'],
      ['+82 10-1234-5678', '01012345678'],
      ['821012345678', '01012345678'],
      ['+82-2-123-4567', '021234567'],
      ['02-123-4567', '021234567'],
      ['8212', '8212'],
      ['홍길동', ''],
    ];
    for (const [input, expected] of samples) {
      const [row] = await conn.db.execute<{ d: string }>(sql`select ${storedPhoneDigits(sql`${input}::text`)} as d`);
      expect(row?.d).toBe(expected);
      expect(phoneDigits(input)).toBe(expected);
    }
  });

  it('puts each row in its tab, counts stale cancelling as cancel refused, and drops handled rows from the summary', async () => {
    await inRollbackTx(conn.db, async (tx) => {
      const service = makeDbService(conn.db);
      const reader = new PrintOrderReader(service);
      const repo = new PrintOrderRepository(service);
      const tag = randomUUID();
      const now = Date.now();
      const staleBefore = new Date(now - CANCEL_CLAIM_STALE_MS);
      const before = await reader.summary(staleBefore, tx);

      const refused = await seedPrint(tx, `${tag}-a`, { status: 'cancel_refused', updatedAt: new Date(now) });
      const stale = await seedPrint(tx, `${tag}-b`, {
        status: 'cancelling',
        vendorOrderNumber: 'WP-9',
        updatedAt: new Date(now - CANCEL_CLAIM_STALE_MS - 60_000),
      });
      await seedPrint(tx, `${tag}-c`, { status: 'cancelling', vendorOrderNumber: 'WP-8', updatedAt: new Date(now) });
      const test = await seedPrint(tx, `${tag}-d`, { status: 'submitted', testMemo: true });
      const cancelledTest = await seedPrint(tx, `${tag}-e`, { status: 'cancelled', testMemo: true });
      const notRefunded = await seedPrint(tx, `${tag}-i`, { status: 'cancelled' });
      const failed = await seedPrint(tx, `${tag}-f`, { status: 'failed' });
      const unsupported = await seedPrint(tx, `${tag}-g`, { status: 'unsupported' });

      const ids = async (tab: 'cancel_refused' | 'test_pending' | 'failed' | 'unsupported' | 'all') =>
        (await reader.list({ tab, q: tag, page: 1, pageSize: 50 }, staleBefore, tx)).items.map((i) => i.id).sort();

      expect(await ids('cancel_refused')).toEqual([refused, stale, cancelledTest, notRefunded].sort());
      expect(await ids('test_pending')).toEqual([test]);
      expect(await ids('failed')).toEqual([failed]);
      expect(await ids('unsupported')).toEqual([unsupported]);
      expect(await ids('all')).toHaveLength(8);

      const listed = await reader.list({ tab: 'failed', q: tag, page: 1, pageSize: 50 }, staleBefore, tx);
      expect(listed.total).toBe(1);
      expect(listed.items[0]).toMatchObject({ customerName: `${tag}-f`, productName: '명함' });

      const after = await reader.summary(staleBefore, tx);
      expect(after).toEqual({
        cancelRefused: before.cancelRefused + 4,
        testPending: before.testPending + 1,
        failed: before.failed + 1,
        unsupported: before.unsupported + 1,
        total: before.total + 8,
      });

      await repo.confirmTest(test, randomUUID(), '출력 가능', tx);
      expect((await reader.summary(staleBefore, tx)).testPending).toBe(before.testPending);

      const unique = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
      const { salesOrderId, lineId } = await seedOrder(
        tx,
        `${tag}-h`,
        `+82 10-${unique.slice(0, 4)}-${unique.slice(4)}`,
      );
      const [phoneRow] = await tx
        .insert(wmsTables.printOrders)
        .values({ salesOrderId, salesOrderLineId: lineId, almondDesignId: randomUUID() })
        .returning({ id: wmsTables.printOrders.id });
      for (const q of [`010${unique}`, `010-${unique.slice(0, 4)}-${unique.slice(4)}`, `+8210${unique}`]) {
        const found = await reader.list({ tab: 'all', q, page: 1, pageSize: 50 }, staleBefore, tx);
        expect(found.items.map((i) => i.id)).toContain(phoneRow?.id);
      }

      const line = await reader.byLine((await repo.findById(failed, tx))?.salesOrderLineId ?? '', tx);
      expect(line?.id).toBe(failed);
    });
  });

  it('derives refund-not-opened from the quantity left on the sales line, not from the failure stamp', async () => {
    await inRollbackTx(conn.db, async (tx) => {
      const service = makeDbService(conn.db);
      const reader = new PrintOrderReader(service);
      const tag = randomUUID();
      const staleBefore = new Date(Date.now() - CANCEL_CLAIM_STALE_MS);
      const before = await reader.summary(staleBefore, tx);

      const { salesOrderId, lineId } = await seedOrder(tx, `${tag}-a`, undefined, { quantity: 3 });
      const [print] = await tx
        .insert(wmsTables.printOrders)
        .values({ salesOrderId, salesOrderLineId: lineId, almondDesignId: randomUUID(), status: 'cancelled' })
        .returning({ id: wmsTables.printOrders.id });
      const printId = print?.id ?? '';
      const stamped = await seedOrder(tx, `${tag}-b`, undefined, { orderStatus: 'cancelled' });
      const [stampedPrint] = await tx
        .insert(wmsTables.printOrders)
        .values({
          salesOrderId: stamped.salesOrderId,
          salesOrderLineId: stamped.lineId,
          almondDesignId: randomUUID(),
          status: 'cancelled',
          salesCancelFailedAt: new Date(),
        })
        .returning({ id: wmsTables.printOrders.id });

      const tab = async () =>
        (await reader.list({ tab: 'cancel_refused', q: tag, page: 1, pageSize: 50 }, staleBefore, tx)).items.map(
          (i) => i.id,
        );
      const partial = (quantity: number) =>
        tx.insert(wmsTables.salesOrderCancellations).values({
          salesOrderId,
          cancellationScope: 'partial',
          metadata: { cancelledLines: [{ salesOrderLineId: lineId, quantity }] },
        });

      expect(await tab()).toEqual([printId]);
      expect(await reader.refundNotOpened(printId, tx)).toBe(true);
      expect(await reader.refundNotOpened(stampedPrint?.id ?? '', tx)).toBe(false);
      expect((await reader.byLine(lineId, tx))?.salesCancelFailed).toBe(true);
      expect((await reader.summary(staleBefore, tx)).cancelRefused).toBe(before.cancelRefused + 1);

      await partial(1);
      expect(await reader.refundNotOpened(printId, tx)).toBe(true);
      expect(await tab()).toEqual([printId]);

      await partial(2);
      expect(await reader.refundNotOpened(printId, tx)).toBe(false);
      expect((await reader.byLine(lineId, tx))?.salesCancelFailed).toBe(false);
      expect(await tab()).toEqual([]);
      expect((await reader.summary(staleBefore, tx)).cancelRefused).toBe(before.cancelRefused);
    });
  });

  it('a fully cancelled sales order closes the refund-not-opened flag', async () => {
    await inRollbackTx(conn.db, async (tx) => {
      const service = makeDbService(conn.db);
      const reader = new PrintOrderReader(service);
      const { salesOrderId, lineId } = await seedOrder(tx, randomUUID(), undefined, { quantity: 3 });
      const [print] = await tx
        .insert(wmsTables.printOrders)
        .values({ salesOrderId, salesOrderLineId: lineId, almondDesignId: randomUUID(), status: 'cancelled' })
        .returning({ id: wmsTables.printOrders.id });
      expect(await reader.refundNotOpened(print?.id ?? '', tx)).toBe(true);
      await tx
        .update(wmsTables.salesOrders)
        .set({ status: 'cancelled' })
        .where(eq(wmsTables.salesOrders.id, salesOrderId));
      expect(await reader.refundNotOpened(print?.id ?? '', tx)).toBe(false);
    });
  });
});
