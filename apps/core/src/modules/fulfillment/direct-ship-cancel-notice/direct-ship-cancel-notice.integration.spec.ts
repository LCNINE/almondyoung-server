import { randomUUID } from 'crypto';
import { eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inRollbackTx, makeDb, makeDbService } from '../services/__support__';
import { wireCancellation } from '../../sales-order/cancellation-record/__support__/cancellation-scenarios';
import {
  draftSupplierBoxOf,
  markHandedOff,
  seedSupplierCancellableOrder,
} from '../../sales-order/cancellation-record/__support__/supplier-cancellation-scenarios';
import { DirectShipCancelNoticeReader } from './direct-ship-cancel-notice.reader';
import { DirectShipCancelNoticeManager } from './direct-ship-cancel-notice.manager';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** 입점사 알릴 취소 대기함 — 입점사 id 로 찾고 거른다(K3 PR6 N6). 행은 실제 판매주문 취소가 만든다. */
describeIfDb('입점사 알릴 취소 대기함 (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);
  const { sql: client, db } = makeDb(DATABASE_URL as string);
  const dbService = makeDbService(db);
  const reader = new DirectShipCancelNoticeReader(dbService);
  const manager = new DirectShipCancelNoticeManager(dbService);
  afterAll(async () => {
    await client.end();
  });

  /** 넘긴 입점사 상자 하나(수량 qty)의 주문. `notice()` 를 부를 때마다 1개 부분 취소 → 대기 행 하나. */
  async function seedNoticeSource(
    tx: DbTx,
    w: ReturnType<typeof wireCancellation>,
    supplierIds?: Record<string, string>,
    qty = 3,
  ) {
    const o = await seedSupplierCancellableOrder(tx, w, {
      supplierLines: [{ supplierKey: 'A', quantity: qty }],
      supplierIds,
    });
    const box = await draftSupplierBoxOf(tx, o.salesOrderId, o.supplierIds.A);
    await markHandedOff(tx, box.shipment.id, o.supplierIds.A);
    const rowsOf = () =>
      tx
        .select()
        .from(wmsTables.directShipCancelNotices)
        .where(eq(wmsTables.directShipCancelNotices.salesOrderId, o.salesOrderId));
    const notice = async () => {
      const before = new Set((await rowsOf()).map((row) => row.id));
      await w.salesOrders.cancel(
        o.salesOrderId,
        {
          lines: [{ salesOrderLineId: o.lineIds[0], quantity: 1 }],
          cancelledBy: 'admin',
          // 같은 요청을 키 없이 두 번 보내면 출고 명령의 멱등 키가 겹쳐 409 다 — 관리자 화면처럼 호출마다 키를 준다
          fulfillmentCommandContext: { actorId: randomUUID(), actorRoles: ['admin'], idempotencyKey: randomUUID() },
        },
        tx,
      );
      // 한 tx 안이라 created_at 이 같다 — 이번 취소가 더한 행을 집합 차이로 찾는다
      const added = (await rowsOf()).filter((row) => !before.has(row.id));
      if (added.length !== 1) throw new Error(`expected one new notice, got ${added.length}`);
      return added[0];
    };
    return { o, box, notice, supplierId: o.supplierIds.A };
  }

  const supplierName = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.suppliers).where(eq(wmsTables.suppliers.id, id)))[0].name;

  async function spreadCreatedAt(tx: DbTx, rows: Array<[{ id: string }, string]>) {
    // 한 tx 안이라 created_at 이 모두 같다 — 순서를 구분하려고 벌린다
    for (const [row, at] of rows) {
      await tx
        .update(wmsTables.directShipCancelNotices)
        .set({ createdAt: new Date(at) })
        .where(eq(wmsTables.directShipCancelNotices.id, row.id));
    }
  }

  it('listOpen 은 미통지만, 오래된 것부터, 입점사 id 로 거른다 — 행에 입점사·주문번호·행 키', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const a = await seedNoticeSource(tx, w);
      const a2 = await seedNoticeSource(tx, w, { A: a.supplierId });
      const b = await seedNoticeSource(tx, w);
      const n1 = await a.notice();
      const n2 = await a2.notice();
      const done = await a.notice();
      const nb = await b.notice();
      await spreadCreatedAt(tx, [
        [n1, '2026-10-24T01:00:00Z'],
        [n2, '2026-10-24T00:00:00Z'],
        [done, '2026-10-23T00:00:00Z'],
        [nb, '2026-10-22T00:00:00Z'],
      ]);
      await manager.markNotified(a.supplierId, [done.id], 'tester', tx);

      const rows = await reader.listOpen({ supplierId: a.supplierId }, tx);

      expect(rows.map((r) => r.id)).toEqual([n2.id, n1.id]);
      const [sales] = await tx
        .select()
        .from(wmsTables.salesOrders)
        .where(eq(wmsTables.salesOrders.id, a2.o.salesOrderId));
      expect(rows[0]).toMatchObject({
        supplierId: a.supplierId,
        companyName: await supplierName(tx, a.supplierId),
        salesOrderId: a2.o.salesOrderId,
        orderNo: sales.displayOrderNo ?? sales.channelOrderId,
        fulfillmentOrderItemId: a2.box.lines[0].fulfillmentOrderItemId,
        canceledQty: 1,
        cancellationScope: 'partial',
        notifiedAt: null,
      });
      expect((await reader.listOpen({}, tx)).map((r) => r.id)).toEqual([nb.id, n2.id, n1.id]);
    });
  });

  it('공급사 상품코드는 그 입점사의 연결에서 읽는다 — 같은 SKU 의 다른 공급사 연결이 먼저 있어도', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const a = await seedNoticeSource(tx, w);
      const [other] = await tx
        .insert(wmsTables.suppliers)
        .values({ name: `it-other-${randomUUID().slice(0, 8)}`, isDirectDelivery: false })
        .returning();
      await tx.insert(wmsTables.skuSuppliers).values({
        skuId: a.box.lines[0].skuId,
        supplierId: other.id,
        supplierSku: 'OTHER-CODE',
        createdAt: new Date('2000-01-01T00:00:00Z'),
      });
      const notice = await a.notice();
      const [link] = await tx
        .select()
        .from(wmsTables.skuSuppliers)
        .where(eq(wmsTables.skuSuppliers.supplierId, a.supplierId));

      const [row] = await reader.listOpen({ supplierId: a.supplierId }, tx);

      expect(row.id).toBe(notice.id);
      expect(row.supplierSku).toBe(link.supplierSku);
    });
  });

  it('markNotified 는 미통지만 바꾸고 다시 불러도 0', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const a = await seedNoticeSource(tx, w);
      const n1 = await a.notice();
      const n2 = await a.notice();

      expect(await manager.markNotified(a.supplierId, [n1.id, n2.id], 'user-1', tx)).toEqual({ notified: 2 });
      expect(await manager.markNotified(a.supplierId, [n1.id, n2.id], 'user-2', tx)).toEqual({ notified: 0 });

      const rows = await tx
        .select()
        .from(wmsTables.directShipCancelNotices)
        .where(inArray(wmsTables.directShipCancelNotices.id, [n1.id, n2.id]));
      expect(rows.every((r) => r.notifiedBy === 'user-1' && r.notifiedAt instanceof Date)).toBe(true);
    });
  });

  it('다른 입점사 행이나 없는 id 가 섞이면 400 이고 아무 행도 안 바뀐다', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const a = await seedNoticeSource(tx, w);
      const b = await seedNoticeSource(tx, w);
      const mine = await a.notice();
      const theirs = await b.notice();

      for (const ids of [
        [mine.id, theirs.id],
        [mine.id, randomUUID()],
      ]) {
        await expect(manager.markNotified(a.supplierId, ids, 'user-1', tx)).rejects.toMatchObject({
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
      const w = wireCancellation(tx);
      const a = await seedNoticeSource(tx, w);
      const first = await a.notice();
      await manager.markNotified(a.supplierId, [first.id], 'user-1', tx);
      expect(await reader.listOpen({ supplierId: a.supplierId }, tx)).toEqual([]);

      const second = await a.notice();

      const open = await reader.listOpen({ supplierId: a.supplierId }, tx);
      expect(open.map((r) => r.id)).toEqual([second.id]);
      expect(second.id).not.toBe(first.id);
    });
  });

  it('내보내기: 고른 행만 싣고, 다른 입점사·없는 id·이미 알린 id 가 섞이면 400', async () => {
    await inRollbackTx(db, async (tx) => {
      const w = wireCancellation(tx);
      const a = await seedNoticeSource(tx, w);
      const b = await seedNoticeSource(tx, w);
      const x = await a.notice();
      const y = await a.notice();
      const done = await a.notice();
      const theirs = await b.notice();
      await manager.markNotified(a.supplierId, [done.id], 'user-1', tx);

      const rows = await reader.listOpenSelected(a.supplierId, [x.id], tx);
      expect(rows.map((r) => r.id)).toEqual([x.id]);
      expect(rows[0].orderCancellationId).toBe(x.orderCancellationId);
      expect((await reader.listOpenSelected(a.supplierId, [x.id, y.id, x.id], tx)).map((r) => r.id).sort()).toEqual(
        [x.id, y.id].sort(),
      );

      for (const ids of [
        [x.id, theirs.id],
        [x.id, randomUUID()],
        [x.id, done.id],
      ]) {
        await expect(reader.listOpenSelected(a.supplierId, ids, tx)).rejects.toMatchObject({
          message: '알림 대상이 이 업체의 알릴 취소가 아닙니다.',
        });
      }
    });
  });
});
