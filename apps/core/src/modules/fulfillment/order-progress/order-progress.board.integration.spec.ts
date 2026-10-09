import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { makeDbService } from '../services/__support__';
import { OrderProgressManager } from './order-progress.manager';
import { OrderProgressReader } from './order-progress.reader';
import * as f from './__support__/order-progress.fixtures';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('정체 보드 요약·목록 (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2 });
    db = drizzle(client, { schema: wmsSchema });
  });
  afterAll(async () => {
    await client.end();
  });

  it('갇힘 수·체류순·커서·필터', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        // 이 트랜잭션 안의 행만 보이도록 다른 행을 지우지는 않는다 — 대신 우리 주문 id 로 걸러 검증한다.
        const now = new Date('2099-01-01T00:00:00.000Z');
        const ids: string[] = [];
        for (const at of ['2098-10-11T00:00:00.000Z', '2098-12-31T12:00:00.000Z', '2098-12-31T23:30:00.000Z']) {
          const o = await f.seedOrder(tx);
          await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', new Date(at));
          ids.push(o.salesOrderId);
        }
        await manager.refreshScope(
          sql`SELECT unnest(ARRAY[${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])`,
          now,
          tx,
        );

        const ours = <T extends { salesOrderId: string }>(items: T[]) =>
          items.filter((i) => ids.includes(i.salesOrderId));

        // 체류순: 가장 오래된 것부터
        const first = await reader.listOrders({ stage: 'fo', sort: 'dwell', limit: 200 }, now, tx);
        expect(ours(first.items).map((i) => i.salesOrderId)).toEqual(ids);
        expect(ours(first.items).map((i) => i.stuck)).toEqual([true, false, false]); // fo 기준 24시간

        // 갇힘만
        const stuck = await reader.listOrders({ stage: 'fo', stuck: true, sort: 'dwell', limit: 200 }, now, tx);
        expect(ours(stuck.items).map((i) => i.salesOrderId)).toEqual([ids[0]]);

        // 커서: 한 장씩 넘겨도 순서가 같다
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const page = await reader.listOrders({ stage: 'fo', sort: 'dwell', limit: 1, cursor }, now, tx);
          seen.push(...page.items.map((i) => i.salesOrderId));
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        expect(seen.filter((id) => ids.includes(id))).toEqual(ids);

        // 요약: 우리 셋이 fo 에 더해져 있다
        const summary = await reader.summary(now, tx);
        const fo = summary.stages.find((s) => s.stage === 'fo')!;
        expect(fo.open).toBeGreaterThanOrEqual(3);
        expect(fo.stuck).toBeGreaterThanOrEqual(1);
        expect(summary.evaluatedAt).toBe('2099-01-01T00:00:00.000Z');
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it('리컨실러가 포기한 주문은 요약·목록에 «자동 멈춤»으로 나온다', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        const now = new Date('2099-01-01T00:00:00.000Z');
        const o = await f.seedOrder(tx);
        await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', new Date('2098-10-11T00:00:00.000Z'));
        await manager.refreshScope(sql`SELECT ${o.salesOrderId}::uuid`, now, tx);
        await tx.insert(wmsTables.orderReconcileState).values({
          rule: 'wake-awaiting-matching',
          salesOrderId: o.salesOrderId,
          trackingRow: 12,
          fingerprint: 'fp',
          mode: 'act',
          attempts: 5,
          lastResult: 'error',
          lastError: 'boom',
          nextCheckAt: now,
          gaveUpAt: new Date('2098-12-31T00:00:00.000Z'),
          firstSeenAt: now,
          updatedAt: now,
        });

        const page = await reader.listOrders({ stage: 'fo', sort: 'dwell', limit: 200 }, now, tx);
        const item = page.items.find((i) => i.salesOrderId === o.salesOrderId)!;
        expect(item.gaveUp).toEqual([
          { rule: 'wake-awaiting-matching', row: 12, since: '2098-12-31T00:00:00.000Z', lastError: 'boom' },
        ]);
        const summary = await reader.summary(now, tx);
        const fo = summary.stages.find((s) => s.stage === 'fo')!;
        expect(fo.gaveUp).toBeGreaterThanOrEqual(1);
        expect(fo.states.find((s) => s.state === 'awaiting_matching')!.gaveUp).toBeGreaterThanOrEqual(1);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  });

  it('요약의 gaveUp 은 포기한 주문만 센다 — 같은 칸의 다른 주문까지 세지 않는다', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        const now = new Date('2099-01-01T00:00:00.000Z');
        const gaveUp = await f.seedOrder(tx);
        const fine = await f.seedOrder(tx);
        for (const o of [gaveUp, fine]) {
          await f.seedBacklog(tx, o.salesOrderId, 'awaiting_matching', new Date('2098-10-11T00:00:00.000Z'));
        }
        await manager.refreshScope(
          sql`SELECT unnest(ARRAY[${gaveUp.salesOrderId}::uuid, ${fine.salesOrderId}::uuid])`,
          now,
          tx,
        );
        const gaveUpOf = (s: Awaited<ReturnType<typeof reader.summary>>) =>
          s.stages.find((st) => st.stage === 'fo')?.states.find((x) => x.state === 'awaiting_matching')?.gaveUp ?? 0;
        const before = gaveUpOf(await reader.summary(now, tx));
        await tx.insert(wmsTables.orderReconcileState).values({
          rule: 'it-order-rule',
          salesOrderId: gaveUp.salesOrderId,
          trackingRow: 12,
          fingerprint: 'fp',
          mode: 'act',
          attempts: 5,
          lastResult: 'error',
          lastError: 'boom',
          nextCheckAt: now,
          gaveUpAt: new Date('2098-12-31T00:00:00.000Z'),
          firstSeenAt: now,
          updatedAt: now,
        });

        expect(gaveUpOf(await reader.summary(now, tx)) - before).toBe(1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });

  it('상자 규칙이 포기한 상자는 그 상자에 라인이 있는 주문마다 배지가 뜨고, 요약의 gaveUp 에도 센다(D18)', async () => {
    await expect(
      db.transaction(async (rawTx) => {
        const tx = rawTx as unknown as DbTx;
        const dbs = makeDbService(db);
        const manager = new OrderProgressManager(dbs);
        const reader = new OrderProgressReader(dbs);
        const now = new Date('2099-01-01T00:00:00.000Z');
        const w = await f.seedWorld(tx);
        const a = await f.seedOrder(tx);
        const b = await f.seedOrder(tx);
        const foA = await f.seedFo(tx, w, a);
        const foB = await f.seedFo(tx, w, b);
        const shared = await f.seedBox(tx, w, [foA.foItemId, foB.foItemId], { status: 'draft' });
        const ids = [a.salesOrderId, b.salesOrderId];
        await manager.refreshScope(
          sql`SELECT unnest(ARRAY[${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )}])`,
          now,
          tx,
        );
        const before = await reader.summary(now, tx);
        await tx.insert(wmsTables.shipmentReconcileState).values({
          rule: 'it-box-rule',
          shipmentId: shared.shipmentId,
          trackingRow: 25,
          fingerprint: 'fp',
          mode: 'act',
          attempts: 5,
          lastResult: 'error',
          lastError: 'boom',
          nextCheckAt: now,
          gaveUpAt: new Date('2098-12-31T00:00:00.000Z'),
          firstSeenAt: now,
          updatedAt: now,
        });

        const page = await reader.listOrders({ stage: 'plan', sort: 'dwell', limit: 500 }, now, tx);
        const ours = page.items.filter((i) => ids.includes(i.salesOrderId));
        expect(ours).toHaveLength(2);
        for (const item of ours) {
          expect(item.gaveUp).toEqual([
            { rule: 'it-box-rule', row: 25, since: '2098-12-31T00:00:00.000Z', lastError: 'boom' },
          ]);
        }
        const after = await reader.summary(now, tx);
        const gaveUpOf = (s: typeof before) =>
          s.stages.find((st) => st.stage === 'plan')?.states.find((x) => x.state === 'awaiting_plan')?.gaveUp ?? 0;
        expect(gaveUpOf(after) - gaveUpOf(before)).toBe(2);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
