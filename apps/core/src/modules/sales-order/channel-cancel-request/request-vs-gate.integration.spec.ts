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
  afterAll(async () => {
    await main.sql.end({ timeout: 5 });
    await contender.sql.end({ timeout: 5 });
  });

  it('요청 트랜잭션이 열려 있는 동안 박스 행 FOR UPDATE 는 lock_timeout 에 걸린다', async () => {
    const seeded = await main.db.transaction(async (raw) => {
      const tx = raw as unknown as DbTx;
      const w = await f.seedWorld(tx);
      const o = await f.seedOrder(tx);
      await tx
        .update(wmsTables.salesOrderLines)
        .set({ channelOrderItemId: 'item-1' })
        .where(eq(wmsTables.salesOrderLines.id, o.lineId));
      const fo = await f.seedFo(tx, w, o);
      const box = await f.seedBox(tx, w, [fo.foItemId], { status: 'planned' });
      return { ...o, ...fo, ...box, world: w };
    });
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
      // 커밋된 시드라 FK 순서대로 직접 지운다(주문 줄은 먼저).
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
  });
});
