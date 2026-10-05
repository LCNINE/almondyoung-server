import * as postgres from 'postgres';
import { sql, eq } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressManager } from './order-progress.manager';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('order-progress 갱신 upsert (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let manager: OrderProgressManager;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
    manager = new OrderProgressManager(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  async function inTx(body: (tx: DbTx, w: f.World) => Promise<void>) {
    await expect(
      db.transaction(async (tx) => {
        await body(tx as unknown as DbTx, await f.seedWorld(tx as unknown as DbTx));
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  }
  const only = (id: string) => sql`SELECT ${id}::uuid`;
  const read = async (tx: DbTx, id: string) =>
    (await tx.select().from(wmsTables.orderProgress).where(eq(wmsTables.orderProgress.salesOrderId, id)))[0];

  it('처음 넣을 때는 추정 시각, 단계가 같으면 세부 상태가 바뀌어도 진입 시각 유지', async () => {
    await inTx(async (tx) => {
      const orderedAt = new Date('2026-07-15T12:34:56.789Z');
      const o = await f.seedOrder(tx, { createdAt: orderedAt });
      await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', new Date('2026-07-16T00:00:00.000Z'));
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:00:00.000Z'), tx);
      const first = await read(tx, o.salesOrderId);
      expect(first).toMatchObject({ stage: 'fo', state: 'awaiting_matching', outcome: null });
      expect(first.stageEnteredAt.toISOString()).toBe('2026-07-16T00:00:00.000Z');
      // R6: 커서가 밀리초라 투영 시각도 밀리초 이하 자릿수가 없어야 한다
      expect(first.orderedAt.toISOString()).toBe(orderedAt.toISOString());

      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'failed' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, o.salesOrderId));
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:01:00.000Z'), tx);
      const second = await read(tx, o.salesOrderId);
      expect(second.state).toBe('failed');
      expect(second.stageEnteredAt.toISOString()).toBe('2026-07-16T00:00:00.000Z');
      expect(second.evaluatedAt.toISOString()).toBe('2026-10-06T00:01:00.000Z');
    });
  });

  it('단계가 바뀌면 진입 시각 = 그 주기의 now', async () => {
    await inTx(async (tx, w) => {
      const o = await f.seedOrder(tx);
      await f.seedBacklog(tx, o.salesOrderId, 'pending');
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:00:00.000Z'), tx);
      await tx
        .update(wmsTables.fulfillmentOrderCreationBacklogs)
        .set({ status: 'completed' })
        .where(eq(wmsTables.fulfillmentOrderCreationBacklogs.salesOrderId, o.salesOrderId));
      const fo = await f.seedFo(tx, w, o, { status: 'ready' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'draft' });
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:05:00.000Z'), tx);
      const row = await read(tx, o.salesOrderId);
      expect(row.stage).toBe('plan');
      expect(row.stageEnteredAt.toISOString()).toBe('2026-10-06T00:05:00.000Z');
    });
  });

  it('종료되면 outcome·closed_at, 다시 열리면 비우고 진입 = now', async () => {
    await inTx(async (tx, w) => {
      const o = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, o, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-06T00:00:00.000Z'), tx);
      const closed = await read(tx, o.salesOrderId);
      expect(closed).toMatchObject({ stage: null, outcome: 'delivered' });
      expect(closed.closedAt?.toISOString()).toBe('2026-10-06T00:00:00.000Z');

      await f.seedReturn(tx, o.salesOrderId, 'requested');
      await manager.refreshScope(only(o.salesOrderId), new Date('2026-10-07T00:00:00.000Z'), tx);
      const reopened = await read(tx, o.salesOrderId);
      expect(reopened).toMatchObject({ stage: 'return_exchange', outcome: null, closedAt: null });
      expect(reopened.stageEnteredAt.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    });
  });

  it('refresh(후보 경로): 새 주문은 행이 생기고, 닫힌 주문은 반품이 생기면 다시 열린다', async () => {
    await inTx(async (tx, w) => {
      const fresh = await f.seedOrder(tx);
      await f.seedBacklog(tx, fresh.salesOrderId, 'pending');
      const closing = await f.seedOrder(tx);
      const fo = await f.seedFo(tx, w, closing, { status: 'completed' });
      await f.seedBox(tx, w, [fo.foItemId], { status: 'delivered' });

      await manager.refresh(new Date(), tx);
      expect(await read(tx, fresh.salesOrderId)).toMatchObject({ stage: 'fo' });
      expect(await read(tx, closing.salesOrderId)).toMatchObject({ stage: null, outcome: 'delivered' });

      await f.seedReturn(tx, closing.salesOrderId, 'requested');
      await manager.refresh(new Date(Date.now() + 60_000), tx);
      expect(await read(tx, closing.salesOrderId)).toMatchObject({
        stage: 'return_exchange',
        outcome: null,
        closedAt: null,
      });
    });
  });
});
