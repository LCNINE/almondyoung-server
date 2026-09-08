import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku } from '../../../fulfillment/services/__support__';
import { ReplenishmentSettingsReader, SETTINGS_KEY } from './replenishment-settings.reader';
import { DemandProfileRefresher } from './demand-profile.refresher';
import { addDays } from './calendar';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- demand-profile.refresher.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('DemandProfileRefresher (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  const TODAY = '2026-09-08';

  async function ensureSettings(trx: DbTx) {
    await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
    await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY });
  }

  async function seedDaily(trx: DbTx, skuId: string, from: string, count: number, qty: number, amount: number | null) {
    await trx.insert(wmsTables.skuDemandDaily).values(
      Array.from({ length: count }, (_, i) => ({
        skuId,
        demandDate: addDays(from, i),
        qty,
        amount,
        source: 'core' as const,
      })),
    );
  }

  function build(trx: DbTx) {
    const dbService = boundDbService(trx);
    return new DemandProfileRefresher(dbService, new ReplenishmentSettingsReader(dbService));
  }

  async function readProfiles(trx: DbTx, skuIds: string[]) {
    return trx.select().from(wmsTables.skuDemandProfiles).where(inArray(wmsTables.skuDemandProfiles.skuId, skuIds));
  }

  it('매일 파는 SKU 는 smooth · 등급 A, 시계열 없는 SKU 는 none · C', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const steady = await seedSku(trx, holderId);
      const silent = await seedSku(trx, holderId);
      await seedDaily(trx, steady.skuId, '2026-06-01', 99, 10, 1_000_000_000); // 로컬 DB 의 다른 SKU 를 압도

      const result = await build(trx).refreshAll({ today: TODAY }, trx);
      expect(result.skus).toBeGreaterThanOrEqual(2);

      const rows = await readProfiles(trx, [steady.skuId, silent.skuId]);
      const s = rows.find((r) => r.skuId === steady.skuId);
      const q = rows.find((r) => r.skuId === silent.skuId);
      expect(s).toMatchObject({
        pattern: 'smooth',
        grade: 'A',
        historyDays: 99,
        demandEvents: 99,
        dailyMean: 10,
        dailyStd: 0,
        dailyMean90: 10,
        classificationFrom: '2025-09-08',
        classificationTo: '2026-09-07',
        paramFrom: '2026-06-10',
        paramTo: '2026-09-07',
      });
      expect(q).toMatchObject({
        pattern: 'none',
        grade: 'C',
        historyDays: 0,
        demandEvents: 0,
        dailyMean: 0,
        adi: null,
        cv2: null,
      });
    });
  });

  it('두 번 돌려도 같다(upsert) 고 computed_at 은 갱신된다', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await seedDaily(trx, skuId, '2026-06-01', 99, 10, 10000);
      const refresher = build(trx);
      await refresher.refreshAll({ today: TODAY }, trx);
      const [first] = await readProfiles(trx, [skuId]);
      await new Promise((r) => setTimeout(r, 5));
      await refresher.refreshAll({ today: TODAY }, trx);
      const [second] = await readProfiles(trx, [skuId]);
      expect(second.pattern).toBe(first.pattern);
      expect(second.dailyMean).toBe(first.dailyMean);
      expect(second.computedAt.getTime()).toBeGreaterThan(first.computedAt.getTime());
      const all = await readProfiles(trx, [skuId]);
      expect(all).toHaveLength(1);
    });
  });

  it('등급은 분류 창 매출 누적으로 — 매출이 없는 SKU 는 C', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const rich = await seedSku(trx, holderId);
      const poor = await seedSku(trx, holderId);
      await seedDaily(trx, rich.skuId, '2026-06-01', 99, 10, 1_000_000_000); // 로컬 DB 의 다른 SKU 를 압도
      await seedDaily(trx, poor.skuId, '2026-06-01', 99, 10, null);
      await build(trx).refreshAll({ today: TODAY }, trx);
      const rows = await readProfiles(trx, [rich.skuId, poor.skuId]);
      expect(rows.find((r) => r.skuId === rich.skuId)?.grade).toBe('A');
      expect(rows.find((r) => r.skuId === poor.skuId)?.grade).toBe('C');
    });
  });

  it('삭제된 SKU 의 프로필은 지우고 다시 만들지 않는다', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const refresher = build(trx);
      await refresher.refreshAll({ today: TODAY }, trx);
      expect(await readProfiles(trx, [skuId])).toHaveLength(1);
      await trx.update(wmsTables.skus).set({ isDeleted: true }).where(eq(wmsTables.skus.id, skuId));
      await refresher.refreshAll({ today: TODAY }, trx);
      expect(await readProfiles(trx, [skuId])).toHaveLength(0);
    });
  });

  it('설정의 창 길이를 따른다 — classification 30일이면 6/1 시작 SKU 의 history 는 30', async () => {
    await inRollbackTx(db, async (trx) => {
      await ensureSettings(trx);
      await trx
        .update(wmsTables.replenishmentSettings)
        .set({ classificationWindowDays: 30 })
        .where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await seedDaily(trx, skuId, '2026-06-01', 99, 10, 100);
      await build(trx).refreshAll({ today: TODAY }, trx);
      const [row] = await readProfiles(trx, [skuId]);
      expect(row).toMatchObject({ classificationFrom: '2026-08-09', historyDays: 30, demandEvents: 30 });
    });
  });
});
