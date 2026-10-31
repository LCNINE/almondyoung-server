import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
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

/** 넘겨받은 트랜잭션 안에서만 도는 WarehouseManager. 두 블록이 함께 쓴다. */
function buildManager(db: PostgresJsDatabase<typeof wmsSchema>, trx: DbTx): WarehouseManager {
  const dbService = {
    db,
    run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
  } as unknown as DbService<typeof wmsSchema>;
  return new WarehouseManager(dbService, new WarehouseReader(dbService), new LocationService(dbService));
}

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

      const error = await buildManager(db, trx)
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

      await expect(buildManager(db, trx).remove(to.warehouseId, trx)).rejects.toBeInstanceOf(ConflictError);
      expect(await countWarehouses(trx, to.warehouseId)).toBe(1);
    });
  });

  it('규칙 행이 없으면 그대로 삭제되고, 규칙을 먼저 지우면 다시 삭제된다', async () => {
    await inRollbackTx(db, async (trx) => {
      const plain = await seedWarehouseWithZone(trx);
      const manager = buildManager(db, trx);
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

/**
 * 창고 «만들기» 화면이 부르는 생성 경로는 시스템 로케이션까지 함께 만든다. 부팅이 기본 창고를 더는
 * 만들지 않으므로(새 테넌트 DB 의 창고 0행이 출발점), 새 창고가 입고·반품 존 없이 태어나면
 * 그 창고로는 입고도 반품도 받을 수 없다 — 이 경로 하나가 그걸 막는다.
 */
describeIfDb('WarehouseManager 시스템 로케이션 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  // 코드의 SYSTEM_LOCATION_DEFAULTS 를 다시 읽지 않고 적어 둔다 — 상수에서 뽑으면 역할이 빠져도 같이 빠져 통과한다.
  const SYSTEM_ROLES = ['inbound_default', 'outbound_rework', 'return_default', 'transit_out'];

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  async function activeSystemRoles(trx: DbTx, warehouseId: string): Promise<string[]> {
    const t = wmsTables.locations;
    const rows = await trx
      .select({ role: t.systemRole })
      .from(t)
      .where(and(eq(t.warehouseId, warehouseId), eq(t.isSystem, true), eq(t.isActive, true)));
    return rows.map((r) => r.role ?? '').sort();
  }

  it('create 로 만든 창고는 시스템 로케이션을 함께 갖는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const created = await buildManager(db, trx).create({ name: `sysloc-${Date.now()}`, type: 'domestic' }, trx);

      expect(await activeSystemRoles(trx, created.id)).toEqual(SYSTEM_ROLES);
    });
  });

  it('convergeSystemLocations 는 넘겨받은 트랜잭션 안의 모든 창고에 시스템 로케이션을 채운다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 생성 경로를 거치지 않은 창고 — 시스템 로케이션이 하나도 없다.
      const [bare] = await trx
        .insert(wmsTables.warehouses)
        .values({ name: `sysloc-bare-${Date.now()}`, type: 'domestic' })
        .returning();
      expect(await activeSystemRoles(trx, bare.id)).toEqual([]);

      await buildManager(db, trx).convergeSystemLocations(trx);

      expect(await activeSystemRoles(trx, bare.id)).toEqual(SYSTEM_ROLES);
    });
  });
});
