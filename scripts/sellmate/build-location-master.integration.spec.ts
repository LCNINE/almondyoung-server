import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { makeDb, inRollbackTx, seedWarehouseWithZone } from '../../apps/core/src/modules/fulfillment/services/__support__';
import { applyLocationMaster } from './build-location-master';
import { planLocationMaster } from './location-master-plan';

/**
 * 셀메이트 선반 위치 → 로케이션 마스터 적용(#1235). 늘리기만 하고 아무것도 지우지 않는다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'build-location-master\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const plan = (...codes: string[]) => planLocationMaster(codes.map((positionCode) => ({ positionCode, skuCount: 1 })));

async function warehouseCodes(trx: DbTx, warehouseId: string): Promise<string[]> {
  const rows = await trx
    .select({ code: wmsTables.locations.code, rackId: wmsTables.locations.rackId })
    .from(wmsTables.locations)
    .where(eq(wmsTables.locations.warehouseId, warehouseId));
  return rows
    .filter((r) => r.rackId !== null)
    .map((r) => r.code)
    .sort();
}

describeIfDb('applyLocationMaster (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('빈 창고에 계획대로 만든다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);

      const report = await applyLocationMaster(trx, warehouseId, plan('A-01-01', 'A-01-03', 'M-07-꼭대기', 'M-07-02'));

      expect(await warehouseCodes(trx, warehouseId)).toEqual(
        ['A-01-01', 'A-01-02', 'A-01-03', 'M-07-01', 'M-07-02', 'M-07-꼭대기'].sort(),
      );
      expect(report.columnsCreated).toEqual(['A', 'M']);
      expect(report.racksCreated).toEqual(['A-01', 'M-07']);
      expect(report.binsCreated).toBe(6);
      expect(report.conflicts).toEqual([]);
    });
  });

  it('두 번 돌리면 변화가 없다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const p = plan('A-01-01', 'A-01-03', 'M-07-꼭대기');
      await applyLocationMaster(trx, warehouseId, p);

      const again = await applyLocationMaster(trx, warehouseId, p);

      expect(again).toEqual({ columnsCreated: [], racksCreated: [], racksExtended: [], binsCreated: 0, conflicts: [] });
    });
  });

  it('위치가 늘면 그 랙만 늘린다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      await applyLocationMaster(trx, warehouseId, plan('A-01-03', 'B-01-02'));

      const report = await applyLocationMaster(trx, warehouseId, plan('A-01-03', 'A-01-06', 'B-01-02'));

      expect(report.racksExtended).toEqual([{ rack: 'A-01', from: 3, to: 6 }]);
      expect(report.binsCreated).toBe(3);
      expect(await warehouseCodes(trx, warehouseId)).toContain('A-01-06');
    });
  });

  it('위치가 줄어도 줄이지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      await applyLocationMaster(trx, warehouseId, plan('A-01-06'));

      const report = await applyLocationMaster(trx, warehouseId, plan('A-01-02'));

      expect(report.racksExtended).toEqual([]);
      expect(report.binsCreated).toBe(0);
      expect((await warehouseCodes(trx, warehouseId)).length).toBe(6);
    });
  });

  it('같은 코드의 zone 이 있으면 그 랙을 충돌로 보고하고 나머지는 계속한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      await trx.insert(wmsTables.locations).values({ warehouseId, code: 'B-01-01', locationType: 'zone' });

      const report = await applyLocationMaster(trx, warehouseId, plan('B-01-01', 'A-01-01'));

      expect(report.conflicts).toEqual([{ code: 'B-01-01', reason: expect.stringContaining('zone') }]);
      expect(await warehouseCodes(trx, warehouseId)).toEqual(['A-01-01']);
      expect(report.racksCreated).toEqual(['A-01']);
    });
  });

  it('사람이 만든 수동 랙은 자동 생성을 켜지 않고 충돌로 보고한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const [column] = await trx.insert(wmsTables.locationColumns).values({ warehouseId, columnName: 'C' }).returning();
      await trx
        .insert(wmsTables.locationRacks)
        .values({ columnId: column.id, rackNumber: 1, defaultBinStart: 1, defaultBinEnd: 1, autoGenerateBins: false });

      const report = await applyLocationMaster(trx, warehouseId, plan('C-01-03'));

      expect(report.conflicts).toEqual([{ code: 'C-01', reason: expect.stringContaining('수동 랙') }]);
      expect(await warehouseCodes(trx, warehouseId)).toEqual([]);
    });
  });
});
