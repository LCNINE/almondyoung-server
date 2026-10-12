import { eq, sql as drizzleSql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDb } from '../../fulfillment/services/__support__';
import * as f from '../../fulfillment/order-progress/__support__/order-progress.fixtures';
import { wireCancelRequest } from './__support__/cancel-request.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

/** drizzle 0.44 는 쿼리 에러를 감싸 Postgres 코드가 `.cause` 에만 남는다. */
function pgErrorCode(error: unknown, depth = 5): string | undefined {
  let current: unknown = error;
  for (let i = 0; i < depth && current !== null && typeof current === 'object'; i += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code;
    current = 'cause' in current ? current.cause : undefined;
  }
  return undefined;
}

describeIfDb('요청 vs 관문 — 같은 박스 행 잠금으로 직렬화 (DB integration)', () => {
  jest.setTimeout(60_000);
  const main = makeDb(DATABASE_URL as string);
  const contender = makeDb(DATABASE_URL as string);
  const holder = makeDb(DATABASE_URL as string);
  afterAll(async () => {
    await main.sql.end({ timeout: 5 });
    await contender.sql.end({ timeout: 5 });
    await holder.sql.end({ timeout: 5 });
  });

  /** pid 가 쥔 잠금을 다른 백엔드가 기다리기 시작할 때까지 — 시간 추측(sleep) 대신 pg_blocking_pids 로 본다 */
  async function waitUntilSomeoneBlockedBy(pid: number): Promise<void> {
    for (let i = 0; i < 250; i += 1) {
      const [row] = await contender.db.execute<{ n: number }>(
        drizzleSql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))`,
      );
      if (row.n > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`no backend became blocked by pid ${pid}`);
  }

  type Seeded = Awaited<ReturnType<typeof seed>>;

  async function seed() {
    return main.db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: 'item-1' })
        .where(eq(wmsTables.salesOrderLines.id, o.lineId));
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
      // planned 박스는 줄마다 확정 예약을 가진다 — 요청이 물리 취소까지 하면(PR 5) 출고 불변식 검사를 지나야 한다.
      await f.seedConfirmedReservation(tx, w, { foId: fo.foId, foItemId: fo.foItemId, shipmentLineId: box.lineIds[0] });
      return { ...o, ...fo, ...box, world: w };
    });
  }

  async function cleanup(seeded: Seeded) {
    // 커밋된 시드라 FK 순서대로 직접 지운다(주문 줄은 먼저).
    await main.db
      .delete(wmsTables.stockReservations)
      .where(eq(wmsTables.stockReservations.fulfillmentOrderItemId, seeded.foItemId));
    await main.db.delete(wmsTables.shipmentLines).where(eq(wmsTables.shipmentLines.shipmentId, seeded.shipmentId));
    await main.db.delete(wmsTables.shipments).where(eq(wmsTables.shipments.id, seeded.shipmentId));
    await main.db
      .delete(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, seeded.foItemId));
    await main.db.delete(wmsTables.fulfillmentOrders).where(eq(wmsTables.fulfillmentOrders.id, seeded.foId));
    await main.db
      .delete(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, seeded.salesOrderId));
    await main.db.delete(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, seeded.salesOrderId));
    await main.db.delete(wmsTables.skus).where(eq(wmsTables.skus.id, seeded.world.skuId));
    await main.db.delete(wmsTables.holders).where(eq(wmsTables.holders.id, seeded.world.holderId));
    await main.db.delete(wmsTables.warehouses).where(eq(wmsTables.warehouses.id, seeded.world.warehouseId));
  }

  it('요청 트랜잭션이 열려 있는 동안 박스 행 FOR UPDATE 는 lock_timeout 에 걸린다', async () => {
    const seeded = await seed();
    try {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let entered!: () => void;
      const enteredSignal = new Promise<void>((resolve) => (entered = resolve));
      const held = main.db
        .transaction(async (raw) => {
          const tx = raw as unknown as DbTx;
          await wireCancelRequest(tx).manager.request(
            { salesOrderId: seeded.salesOrderId, requester: { kind: 'operator', actorId: 'a' }, sourceKey: 'k' },
            tx,
          );
          entered();
          await gate;
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
      await Promise.race([enteredSignal, held]);
      try {
        const outcome = await contender.db
          .transaction(async (tx) => {
            await tx.execute(drizzleSql`SET LOCAL lock_timeout = '300ms'`);
            await tx.execute(drizzleSql`SELECT id FROM shipments WHERE id = ${seeded.shipmentId} FOR UPDATE`);
          })
          .then(
            () => 'locked',
            (error: unknown) => error,
          );
        expect(pgErrorCode(outcome) ?? outcome).toBe('55P03');
      } finally {
        release();
        await held;
      }
    } finally {
      await cleanup(seeded);
    }
  });

  it('요청은 FOI 를 박스보다 먼저 잠근다 — FOI 에서 기다리는 동안 박스 행은 비어 있다(배치 시작과 같은 FOI → 박스 순서, 40P01 방지)', async () => {
    const seeded = await seed();
    try {
      let releaseHolder!: () => void;
      const holderGate = new Promise<void>((resolve) => (releaseHolder = resolve));
      let holding!: (pid: number) => void;
      const holdingSignal = new Promise<number>((resolve) => (holding = resolve));
      // FOI → 박스 순서로 잠그는 경로(배치 시작)의 대역 — FOI 를 먼저 쥐고 있는다.
      const held = holder.db.transaction(async (tx) => {
        const [me] = await tx.execute<{ pid: number }>(drizzleSql`SELECT pg_backend_pid() AS pid`);
        await tx.execute(drizzleSql`SELECT id FROM fulfillment_order_items WHERE id = ${seeded.foItemId} FOR UPDATE`);
        holding(me.pid);
        await holderGate;
      });
      const holderPid = await Promise.race([holdingSignal, held.then(() => -1)]);
      const request = main.db
        .transaction(async (raw) => {
          const tx = raw as unknown as DbTx;
          await wireCancelRequest(tx).manager.request(
            { salesOrderId: seeded.salesOrderId, requester: { kind: 'operator', actorId: 'a' }, sourceKey: 'k' },
            tx,
          );
          throw new Rollback();
        })
        .catch((error: unknown) => {
          if (!(error instanceof Rollback)) throw error;
        });
      try {
        await waitUntilSomeoneBlockedBy(holderPid);
        // 요청이 박스를 먼저 잡았다면(옛 순서) 여기서 55P03 — FOI 를 기다리며 박스를 쥐고 있는 셈이라 배치 시작과 교착한다.
        const outcome = await contender.db
          .transaction(async (tx) => {
            await tx.execute(drizzleSql`SET LOCAL lock_timeout = '300ms'`);
            await tx.execute(drizzleSql`SELECT id FROM shipments WHERE id = ${seeded.shipmentId} FOR UPDATE`);
          })
          .then(
            () => 'locked',
            (error: unknown) => pgErrorCode(error) ?? error,
          );
        expect(outcome).toBe('locked');
      } finally {
        releaseHolder();
        await held;
        await request;
      }
    } finally {
      await cleanup(seeded);
    }
  });
});
