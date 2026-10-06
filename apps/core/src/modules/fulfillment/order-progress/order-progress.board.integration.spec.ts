import * as postgres from 'postgres';
import { sql } from 'drizzle-orm';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
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
});
