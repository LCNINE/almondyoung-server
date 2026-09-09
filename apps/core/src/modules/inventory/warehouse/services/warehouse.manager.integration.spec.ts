import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { ConflictError } from '@app/shared';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedWarehouseWithZone } from '../../../fulfillment/services/__support__';
import { LocationService } from '../../core/services/location.service';
import { WarehouseReader } from './warehouse.reader';
import { WarehouseManager } from './warehouse.manager';

/**
 * 창고 하드 삭제 × 보충 경로 규칙(#743 B). `replenishment_route_rules` 의 두 FK 는 **restrict** 라
 * (스펙 §8.1), 세지 않고 지우면 postgres 23503 이 그대로 500 이 된다. `isInUse` 는 재고 원장만 보므로
 * 그 판정만으로는 못 잡는다 — 출발지 · 도착지 양쪽을 다 세는지 여기서 고정한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'warehouse/services/warehouse\.manager\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('WarehouseManager.remove × 보충 경로 규칙 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function build(trx: DbTx): WarehouseManager {
    const dbService = {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
    return new WarehouseManager(dbService, new WarehouseReader(dbService), new LocationService(dbService));
  }

  async function seedRouteRule(trx: DbTx, fromWarehouseId: string, toWarehouseId: string): Promise<void> {
    await trx
      .insert(wmsTables.replenishmentRouteRules)
      .values({ fromWarehouseId, toWarehouseId, leadTimeDays: 9, leadTimeStdDays: null, coverDays: 10 });
  }

  async function countWarehouses(trx: DbTx, id: string): Promise<number> {
    const rows = await trx
      .select({ id: wmsTables.warehouses.id })
      .from(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.id, id));
    return rows.length;
  }

  it('출발 창고로 쓰이는 경로 규칙이 있으면 409', async () => {
    await inRollbackTx(db, async (trx) => {
      const from = await seedWarehouseWithZone(trx);
      const to = await seedWarehouseWithZone(trx);
      await seedRouteRule(trx, from.warehouseId, to.warehouseId);

      const error = await build(trx)
        .remove(from.warehouseId, trx)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictError);
      expect(error).toMatchObject({ message: expect.stringContaining('재고 보충 규칙 화면') });
      expect(await countWarehouses(trx, from.warehouseId)).toBe(1);
    });
  });

  it('도착 창고로 쓰이는 경로 규칙이 있어도 409 — 두 FK 를 다 센다', async () => {
    await inRollbackTx(db, async (trx) => {
      const from = await seedWarehouseWithZone(trx);
      const to = await seedWarehouseWithZone(trx);
      await seedRouteRule(trx, from.warehouseId, to.warehouseId);

      await expect(build(trx).remove(to.warehouseId, trx)).rejects.toBeInstanceOf(ConflictError);
      expect(await countWarehouses(trx, to.warehouseId)).toBe(1);
    });
  });

  it('규칙 행이 없으면 그대로 삭제되고, 규칙을 먼저 지우면 다시 삭제된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const plain = await seedWarehouseWithZone(trx);
      const manager = build(trx);
      const deleted = await manager.remove(plain.warehouseId, trx);
      expect(deleted.id).toBe(plain.warehouseId);
      expect(await countWarehouses(trx, plain.warehouseId)).toBe(0);

      const from = await seedWarehouseWithZone(trx);
      const to = await seedWarehouseWithZone(trx);
      await seedRouteRule(trx, from.warehouseId, to.warehouseId);
      await expect(manager.remove(from.warehouseId, trx)).rejects.toBeInstanceOf(ConflictError);

      const t = wmsTables.replenishmentRouteRules;
      await trx.delete(t).where(eq(t.fromWarehouseId, from.warehouseId));
      await expect(manager.remove(from.warehouseId, trx)).resolves.toMatchObject({ id: from.warehouseId });
    });
  });
});
