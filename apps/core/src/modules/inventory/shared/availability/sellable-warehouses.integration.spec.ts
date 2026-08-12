import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
// stockSummary 는 wmsViews 에 있고 wmsTables 에는 없다 — 직접 import 한다.
import { wmsSchema, wmsTables, stockSummary, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  receiveStock,
} from '../../../fulfillment/services/__support__';
import { inSellableWarehouse } from './sellable-warehouses';

/**
 * 비판매 창고 재고가 판매가능수량 집계에서 빠지는지 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- sellable-warehouses.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('판매성 창고 필터 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await client.end();
  });

  it('비판매 창고의 ON_HAND 는 stock_summary_view 합산에서 제외된다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const sellable = await seedWarehouseWithZone(trx);
      const nonSellable = await seedWarehouseWithZone(trx);
      await trx
        .update(wmsTables.warehouses)
        .set({ isSellable: false })
        .where(sql`${wmsTables.warehouses.id} = ${nonSellable.warehouseId}`);

      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await receiveStock(w.command, trx, { skuId, warehouseId: sellable.warehouseId, locationId: sellable.locationId, quantity: 10 });
      await receiveStock(w.command, trx, { skuId, warehouseId: nonSellable.warehouseId, locationId: nonSellable.locationId, quantity: 7 });

      const rows = (await trx.execute(sql`
        SELECT COALESCE(SUM(GREATEST(available_qty, 0)), 0)::int AS qty
          FROM stock_summary_view
         WHERE sku_id = ${skuId}
           AND ${inSellableWarehouse(stockSummary.warehouseId)}
      `)) as unknown as { qty: number | string }[];

      // 판매 창고 10 만 잡히고 비판매 창고 7 은 빠진다
      expect(Number(rows[0]?.qty ?? 0)).toBe(10);
    });
  });
});
