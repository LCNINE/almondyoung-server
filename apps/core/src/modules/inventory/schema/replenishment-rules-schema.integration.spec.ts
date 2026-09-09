import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql, eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from './inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedHolder,
  seedSku,
  seedWarehouseWithZone,
  causeChainMessage,
} from '../../fulfillment/services/__support__';

/**
 * B 단계 규칙 표 4개(스펙 §8.1). 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-rules-schema.integration
 *
 * `causeChainMessage` 는 `__support__/cause-chain.ts` 공유 헬퍼 — A 단계
 * (`replenishment-schema.integration.spec.ts`)와 같은 것을 쓴다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('replenishment rule schema (B)', () => {
  jest.setTimeout(60_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  it('표 4개가 존재한다', async () => {
    for (const name of [
      'replenishment_grade_rules',
      'replenishment_supplier_rules',
      'replenishment_route_rules',
      'replenishment_sku_overrides',
    ]) {
      const rows = await db.execute(sql`SELECT to_regclass(${'public.' + name})::text AS name`);
      // execute() 원시 결과 타이핑 — ledger-reconciliation.service.ts:120 과 같은 문서화된 캐스트.
      const [row] = rows as unknown as Array<{ name: string | null }>;
      expect(row.name).toBe(name);
    }
  });

  it('SKU 예외는 mode 기본 auto, alpha 는 (0,1), safety_stock ≥ 0, SKU 삭제에 cascade', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const [row] = await trx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId }).returning();
      expect(row.mode).toBe('auto');
      expect(row.excludedUntil).toBeNull();
      let caught: unknown;
      try {
        await trx
          .update(wmsTables.replenishmentSkuOverrides)
          .set({ alpha: 1 })
          .where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId));
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/ck_replenishment_sku_overrides_alpha/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      let caught: unknown;
      try {
        await trx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId, safetyStock: -1 });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/ck_replenishment_sku_overrides_safety_stock/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      await trx
        .insert(wmsTables.replenishmentSkuOverrides)
        .values({ skuId, mode: 'excluded', excludedUntil: '2026-12-31' });
      await trx.delete(wmsTables.skus).where(eq(wmsTables.skus.id, skuId));
      expect(
        await trx
          .select()
          .from(wmsTables.replenishmentSkuOverrides)
          .where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId)),
      ).toEqual([]);
    });
  });

  it('공급사 규칙은 공급사 삭제를 막는다(restrict), 경로 규칙은 from ≠ to', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const [supplier] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: 'it-sup', defaultWarehouseId: warehouseId })
        .returning({ id: wmsTables.suppliers.id });
      await trx
        .insert(wmsTables.replenishmentSupplierRules)
        .values({ supplierId: supplier.id, leadTimeDays: 30, coverDays: 30 });
      let caught: unknown;
      try {
        await trx.delete(wmsTables.suppliers).where(eq(wmsTables.suppliers.id, supplier.id));
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/foreign key/);
    });
    await inRollbackTx(db, async (trx: DbTx) => {
      const { warehouseId } = await seedWarehouseWithZone(trx);
      let caught: unknown;
      try {
        await trx
          .insert(wmsTables.replenishmentRouteRules)
          .values({ fromWarehouseId: warehouseId, toWarehouseId: warehouseId, leadTimeDays: 14, coverDays: 14 });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/ck_replenishment_route_rules_distinct/);
    });
  });

  it('등급 규칙은 grade 가 PK 다', async () => {
    await inRollbackTx(db, async (trx: DbTx) => {
      await trx.delete(wmsTables.replenishmentGradeRules);
      await trx.insert(wmsTables.replenishmentGradeRules).values({ grade: 'A', alpha: 0.02 });
      let caught: unknown;
      try {
        await trx.insert(wmsTables.replenishmentGradeRules).values({ grade: 'A', alpha: 0.03 });
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(/duplicate key/);
    });
  });
});
