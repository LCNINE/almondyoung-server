import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql, and, eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
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

/**
 * transferShip 이 만든 IN_TRANSFER 잔량이 출발 선반이 아니라 운송중존에 놓이는지 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- transfer-ship-location.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('transferShip 의 IN_TRANSFER 배치 (DB integration)', () => {
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

  it('출발 선반은 비고 운송중존에 IN_TRANSFER 가 쌓인다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const from = await seedWarehouseWithZone(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: from.warehouseId,
        locationId: from.locationId,
        quantity: 10,
      });

      // transit_out 시스템 로케이션 보장 (프로덕션 경로는 InventoryCommandService 가 부른다)
      await w.location.ensureSystemLocations(from.warehouseId, trx);
      const [transit] = await trx
        .select({ id: wmsTables.locations.id })
        .from(wmsTables.locations)
        .where(
          and(eq(wmsTables.locations.warehouseId, from.warehouseId), eq(wmsTables.locations.systemRole, 'transit_out')),
        )
        .limit(1);

      const readQty = async (locationId: string, state: 'ON_HAND' | 'IN_TRANSFER') => {
        const rows = (await trx.execute(sql`
          SELECT COALESCE(qty, 0)::int AS qty FROM stock_ledgers
           WHERE sku_id = ${skuId} AND warehouse_id = ${from.warehouseId}
             AND location_id = ${locationId} AND stock_state = ${state}
        `)) as unknown as { qty: number | string }[];
        return Number(rows[0]?.qty ?? 0);
      };

      await w.command.transferShip(
        {
          skuId,
          fromWarehouseId: from.warehouseId,
          fromLocationId: from.locationId,
          quantity: 4,
        },
        trx,
      );

      expect(await readQty(from.locationId, 'ON_HAND')).toBe(6);
      expect(await readQty(from.locationId, 'IN_TRANSFER')).toBe(0);
      expect(await readQty(transit.id, 'IN_TRANSFER')).toBe(4);
    });
  });
});
