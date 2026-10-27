import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomUUID } from 'crypto';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { WarehouseReader } from './warehouse.reader';

/**
 * 창고 요약의 totalAvailable 은 출고가능(ON_HAND) 보유만 센다 — 반품 검수 대기·불량·이동중은 가용이 아니다(K8).
 *
 * 실행: DATABASE_URL=<core DB> npx jest --testPathPattern 'warehouse.reader.integration' --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('WarehouseReader.getStockSummary (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await expect(
      db.transaction(async (trx) => {
        await fn(trx);
        throw new Rollback();
      }),
    ).rejects.toThrow(Rollback);
  };

  it('ON_HAND 5 + RETURNED 3 이면 totalQuantity 8, totalAvailable 5', async () => {
    await inRollback(async (trx) => {
      const [warehouse] = await trx
        .insert(wmsTables.warehouses)
        .values({ name: `it-wh-${randomUUID().slice(0, 8)}` })
        .returning();
      const [location] = await trx
        .insert(wmsTables.locations)
        .values({ warehouseId: warehouse.id, code: 'R', locationType: 'zone' })
        .returning();
      const [holder] = await trx
        .insert(wmsTables.holders)
        .values({ name: `it-holder-${randomUUID().slice(0, 8)}` })
        .returning();
      const [sku] = await trx
        .insert(wmsTables.skus)
        .values({ name: 'it-sku', code: `IT-${randomUUID()}`, holderId: holder.id })
        .returning();
      const grain = { skuId: sku.id, warehouseId: warehouse.id, locationId: location.id };
      await trx.insert(wmsTables.stockLedgers).values([
        { ...grain, stockState: 'ON_HAND', qty: 5 },
        { ...grain, stockState: 'RETURNED', qty: 3 },
      ]);
      const reader = new WarehouseReader({ db: trx, run: (fn: (t: DbTx) => unknown) => fn(trx) } as never);

      const summary = await reader.getStockSummary(warehouse.id);

      expect(summary.totalQuantity).toBe(8);
      expect(summary.totalAvailable).toBe(5);
    });
  });
});
