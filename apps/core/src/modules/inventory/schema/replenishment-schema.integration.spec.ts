import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from './inventory.schema';
import { makeDb, inRollbackTx, seedHolder, seedSku, causeChainMessage } from '../../fulfillment/services/__support__';

/**
 * A 단계 표 5개(스펙 §8.1)가 마이그레이션으로 존재하고 제약이 살아 있는지.
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-schema.integration
 *
 * `causeChainMessage` 는 `__support__/cause-chain.ts` 공유 헬퍼 — B 단계
 * (`replenishment-rules-schema.integration.spec.ts`)와 같은 것을 쓴다. (동일 컨벤션:
 * outbound-v2-schema.integration.spec.ts 는 자기 도메인용 `expectViolation` 을 따로 쓴다 — 별도 정리 대상, 이 태스크 밖.)
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('replenishment statistics schema (A)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('표 5개가 존재한다', async () => {
    const names = [
      'replenishment_settings',
      'sku_demand_daily',
      'sku_demand_profiles',
      'supplier_lead_time_profiles',
      'route_lead_time_profiles',
    ];
    for (const name of names) {
      const rows = await db.execute(sql`SELECT to_regclass(${'public.' + name})::text AS name`);
      // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
      const [row] = rows as unknown as Array<{ name: string | null }>;
      expect(row.name).toBe(name);
    }
  });

  it('sku_demand_daily 는 (sku_id, demand_date) 가 PK 이고 qty < 0 을 거부한다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await trx
        .insert(wmsTables.skuDemandDaily)
        .values({ skuId, demandDate: '2026-01-01', qty: 3, amount: 3000, source: 'core' });
      let caught: unknown;
      try {
        await trx
          .insert(wmsTables.skuDemandDaily)
          .values({ skuId, demandDate: '2026-01-01', qty: 1, amount: null, source: 'core' });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/duplicate key/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      let caught: unknown;
      try {
        await trx
          .insert(wmsTables.skuDemandDaily)
          .values({ skuId, demandDate: '2026-01-02', qty: -1, amount: null, source: 'core' });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/chk_sku_demand_daily_qty/);
    });
  });

  it('replenishment_settings 의 기본값은 스펙 §6 의 값이다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const [row] = await trx.insert(wmsTables.replenishmentSettings).values({ key: 'it-default' }).returning();
      expect(row.adiThreshold).toBe(1.32);
      expect(row.cv2Threshold).toBe(0.49);
      expect(row.classificationWindowDays).toBe(365);
      expect(row.paramWindowDaysFrequent).toBe(90);
      expect(row.paramWindowDaysSparse).toBe(365);
      expect(row.minDemandEvents).toBe(3);
      expect(row.minLeadTimeObservations).toBe(5);
      expect(row.leadTimeWindowDays).toBe(365);
      expect(row.gradeACut).toBe(0.8);
      expect(row.gradeBCut).toBe(0.95);
      expect(row.demandCoreSince).toBeNull();
      expect(row.demandRecomputeDays).toBe(14);
      expect(row.consolidationBufferDays).toBe(7);
      expect(row.defaultLeadTimeDays).toBe(30);
      expect(row.defaultLeadTimeStdDays).toBeNull();
      expect(row.defaultTransferLeadTimeDays).toBe(14);
      expect(row.defaultTransferLeadTimeStdDays).toBeNull();
      expect(row.defaultLeadTimeCv).toBe(0.25);
      expect(row.defaultCoverDays).toBe(30);
      expect(row.defaultTransferCoverDays).toBe(14);
    });
  });

  it('프로필 표는 SKU 삭제에 cascade 한다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await trx.insert(wmsTables.skuDemandProfiles).values({
        skuId,
        pattern: 'none',
        grade: 'C',
        classificationFrom: '2025-09-08',
        classificationTo: '2026-09-07',
        paramFrom: '2026-06-10',
        paramTo: '2026-09-07',
        computedAt: new Date(),
      });
      await trx.delete(wmsTables.skus).where(sql`${wmsTables.skus.id} = ${skuId}`);
      const rows = await trx
        .select()
        .from(wmsTables.skuDemandProfiles)
        .where(sql`${wmsTables.skuDemandProfiles.skuId} = ${skuId}`);
      expect(rows).toEqual([]);
    });
  });
});
