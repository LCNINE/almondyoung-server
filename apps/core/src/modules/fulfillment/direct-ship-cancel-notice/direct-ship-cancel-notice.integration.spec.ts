import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { eq, inArray } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema, wmsTables, DbTx } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDbService } from '../services/__support__';
import * as f from '../order-progress/__support__/order-progress.fixtures';
import { UnboxedDemandCancellation } from '../unboxed-demand/unboxed-demand-cancellation';
import { DirectShipCancelNoticeReader } from './direct-ship-cancel-notice.reader';
import { DirectShipCancelNoticeManager } from './direct-ship-cancel-notice.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('직배 알릴 취소 대기함 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let cmd: UnboxedDemandCancellation;
  let reader: DirectShipCancelNoticeReader;
  let manager: DirectShipCancelNoticeManager;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
    const dbService = makeDbService(db);
    cmd = new UnboxedDemandCancellation(dbService);
    reader = new DirectShipCancelNoticeReader(dbService);
    manager = new DirectShipCancelNoticeManager(dbService);
  });
  afterAll(async () => {
    await client.end();
  });

  /** 넘긴 직배 주문 하나를 만들고 부분 취소 1개로 대기 행 하나를 남긴다. 취소 행은 서비스가 쓰는 자리라 여기서 맞춘다. */
  async function seedNotice(tx: DbTx, w: f.World, qty = 3) {
    const order = await f.seedOrder(tx, { quantity: qty });
    const { foItemId } = await f.seedFo(tx, w, order, { qty, dropShip: 'forwarded', status: 'created' });
    const notice = async (reduceQty = 1) => {
      const oc = randomUUID();
      await tx.insert(wmsTables.salesOrderCancellations).values({
        id: oc,
        salesOrderId: order.salesOrderId,
        cancellationScope: 'partial',
        occurredAt: new Date('2026-10-24T03:05:00Z'),
      });
      await cmd.lockForCancellation(order.salesOrderId, tx);
      await cmd.reduce(order.salesOrderId, oc, [{ fulfillmentOrderItemId: foItemId, qty: reduceQty }], tx);
      const [row] = await tx
        .select()
        .from(wmsTables.directShipCancelNotices)
        .where(eq(wmsTables.directShipCancelNotices.orderCancellationId, oc));
      return row;
    };
    return { order, foItemId, notice };
  }

  async function seedOtherHolder(tx: DbTx, w: f.World): Promise<f.World> {
    const other = await f.seedWorld(tx);
    return { ...w, holderId: other.holderId, skuId: other.skuId };
  }

  const holderName = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.holders).where(eq(wmsTables.holders.id, id)))[0].name;

  it('listOpen 은 미통지만, 오래된 것부터, 업체로 거른다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const wB = await seedOtherHolder(tx, w);
      const a1 = await (await seedNotice(tx, w)).notice();
      const a2 = await (await seedNotice(tx, w)).notice();
      const aDone = await (await seedNotice(tx, w)).notice();
      await (await seedNotice(tx, wB)).notice();
      // 한 tx 안이라 created_at 이 모두 같다 — 순서를 구분하려고 벌린다
      for (const [row, at] of [
        [a1, '2026-10-24T01:00:00Z'],
        [a2, '2026-10-24T00:00:00Z'],
        [aDone, '2026-10-23T00:00:00Z'],
      ] as const) {
        await tx
          .update(wmsTables.directShipCancelNotices)
          .set({ createdAt: new Date(at) })
          .where(eq(wmsTables.directShipCancelNotices.id, row.id));
      }
      await manager.markNotified(await holderName(tx, w.holderId), [aDone.id], 'tester', tx);

      const rows = await reader.listOpen({ companyName: await holderName(tx, w.holderId) }, tx);

      expect(rows.map((r) => r.id)).toEqual([a2.id, a1.id]);
      expect(rows[0]).toMatchObject({
        companyName: await holderName(tx, w.holderId),
        salesOrderId: a2.salesOrderId,
        skuName: 'op-sku',
        canceledQty: 1,
        cancellationScope: 'partial',
        notifiedAt: null,
      });
      expect(rows[0].cancelledAt).toEqual(new Date('2026-10-24T03:05:00Z'));
      expect(rows[0].channelOrderId).toEqual(expect.stringMatching(/^OP-/));
    });
  });

  it('markNotified 는 미통지만 바꾸고 다시 불러도 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const name = await holderName(tx, w.holderId);
      const n1 = await (await seedNotice(tx, w)).notice();
      const n2 = await (await seedNotice(tx, w)).notice();

      expect(await manager.markNotified(name, [n1.id, n2.id], 'user-1', tx)).toEqual({ notified: 2 });
      expect(await manager.markNotified(name, [n1.id, n2.id], 'user-2', tx)).toEqual({ notified: 0 });

      const rows = await tx
        .select()
        .from(wmsTables.directShipCancelNotices)
        .where(inArray(wmsTables.directShipCancelNotices.id, [n1.id, n2.id]));
      expect(rows.every((r) => r.notifiedBy === 'user-1' && r.notifiedAt instanceof Date)).toBe(true);
    });
  });

  it('다른 업체 행이나 없는 id 가 섞이면 400 이고 아무 행도 안 바뀐다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const wB = await seedOtherHolder(tx, w);
      const name = await holderName(tx, w.holderId);
      const mine = await (await seedNotice(tx, w)).notice();
      const theirs = await (await seedNotice(tx, wB)).notice();

      for (const ids of [
        [mine.id, theirs.id],
        [mine.id, randomUUID()],
      ]) {
        await expect(manager.markNotified(name, ids, 'user-1', tx)).rejects.toMatchObject({
          message: '알림 대상이 이 업체의 알릴 취소가 아닙니다.',
        });
      }
      const rows = await tx
        .select()
        .from(wmsTables.directShipCancelNotices)
        .where(inArray(wmsTables.directShipCancelNotices.id, [mine.id, theirs.id]));
      expect(rows.every((r) => r.notifiedAt === null)).toBe(true);
    });
  });

  it('알림 완료 뒤 같은 FOI 의 새 부분 취소는 새 미통지 행', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const name = await holderName(tx, w.holderId);
      const s = await seedNotice(tx, w);
      const first = await s.notice();
      await manager.markNotified(name, [first.id], 'user-1', tx);
      expect(await reader.listOpen({ companyName: name }, tx)).toEqual([]);

      const second = await s.notice();

      const open = await reader.listOpen({ companyName: name }, tx);
      expect(open.map((r) => r.id)).toEqual([second.id]);
      expect(second.id).not.toBe(first.id);
    });
  });

  it('내보내기: 고른 행만 싣고, 다른 업체·없는 id·이미 알린 id 가 섞이면 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = await f.seedWorld(tx);
      const wB = await seedOtherHolder(tx, w);
      const name = await holderName(tx, w.holderId);
      const a = await (await seedNotice(tx, w)).notice();
      const b = await (await seedNotice(tx, w)).notice();
      const done = await (await seedNotice(tx, w)).notice();
      const theirs = await (await seedNotice(tx, wB)).notice();
      await manager.markNotified(name, [done.id], 'user-1', tx);

      const rows = await reader.listOpenSelected(name, [a.id], tx);
      expect(rows.map((r) => r.id)).toEqual([a.id]);
      expect(rows[0].orderCancellationId).toBe(a.orderCancellationId);
      expect((await reader.listOpenSelected(name, [a.id, b.id, a.id], tx)).map((r) => r.id).sort()).toEqual(
        [a.id, b.id].sort(),
      );

      for (const ids of [
        [a.id, theirs.id],
        [a.id, randomUUID()],
        [a.id, done.id],
      ]) {
        await expect(reader.listOpenSelected(name, ids, tx)).rejects.toMatchObject({
          message: '알림 대상이 이 업체의 알릴 취소가 아닙니다.',
        });
      }
    });
  });
});
