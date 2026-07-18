import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { wmsSchema } from '../../inventory/schema/inventory.schema';
import {
  makeDb,
  makeDbService,
  wireLogistics,
  inRollbackTx,
  Wired,
  seedWarehouseWithZone,
  seedHolder,
  seedSku,
  seedMatching,
  receiveStock,
  onHand,
  netFromEvents,
  assertStockConsistent,
  assertConservation,
} from './__support__';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('logistics integration support (DB integration, rollback-only)', () => {
  jest.setTimeout(120_000);
  let sql: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;
  let w: Wired;

  beforeAll(() => {
    ({ sql, db } = makeDb(DATABASE_URL as string));
    w = wireLogistics(makeDbService(db));
  });
  afterAll(async () => {
    await sql.end();
  });

  it('전체 서비스 그래프가 조립되고 receive 가 ON_HAND + RECEIVE 이벤트를 남긴다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);

      await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });

      expect(await onHand(tx, skuId, warehouseId)).toBe(10);
      expect(await netFromEvents(tx, skuId)).toBe(10);
      await assertStockConsistent(tx, { skuId, warehouseId, onHand: 10, reserved: 0 });
      await assertConservation(tx, { skuId, warehouseId, received: 10, shipped: 0 });
    });
  });

  it('매핑된 SKU(variant catalog 행 없음)에도 receive/recalc 가 예외 없이 no-op 로 통과한다', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      const variantId = randomUUID(); // catalog product_variants 에 없는 임의 variant

      await seedMatching(tx, { variantId, skuId, quantity: 1 });
      await expect(
        receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 7 }),
      ).resolves.toBeUndefined();

      expect(await onHand(tx, skuId, warehouseId)).toBe(7);
    });
  });

  it('assertStockConsistent 는 골든값이 틀리면 실제로 실패한다 (negative check)', async () => {
    await inRollbackTx(db, async (tx) => {
      const { warehouseId, locationId } = await seedWarehouseWithZone(tx);
      const { holderId } = await seedHolder(tx);
      const { skuId } = await seedSku(tx, holderId);
      await receiveStock(w.command, tx, { skuId, warehouseId, locationId, quantity: 10 });

      // onHand 는 10 인데 9 로 주장 → throw 해야 정상.
      await expect(assertStockConsistent(tx, { skuId, warehouseId, onHand: 9, reserved: 0 })).rejects.toThrow();
    });
  });
});
