import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import {
  makeDb,
  inRollbackTx,
  seedHolder,
  seedSku,
  seedWarehouseWithZone,
  causeChainMessage,
} from '../../../fulfillment/services/__support__';
import { createGlobalValidationPipe } from '../../../../platform/http/validation-pipe';
import { SETTINGS_KEY } from '../demand/replenishment-settings.reader';
import { UpdateGradeRulesDto, UpsertSkuOverrideDto } from '../dto/replenishment-rules.dto';
import { ReplenishmentRulesReader, routeKey } from './replenishment-rules.reader';
import { ReplenishmentRulesManager } from './replenishment-rules.manager';

/**
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- 'rules/replenishment-rules\.integration\.spec\.ts$'
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentRulesReader / Manager (DB integration)', () => {
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

  async function seedRules(trx: DbTx) {
    await trx.delete(wmsTables.replenishmentSettings).where(eq(wmsTables.replenishmentSettings.key, SETTINGS_KEY));
    await trx.insert(wmsTables.replenishmentSettings).values({ key: SETTINGS_KEY });
    await trx.delete(wmsTables.replenishmentGradeRules);
    await trx.insert(wmsTables.replenishmentGradeRules).values([
      { grade: 'A', alpha: 0.02 },
      { grade: 'B', alpha: 0.05 },
      { grade: 'C', alpha: 0.1 },
    ]);
  }

  function build(trx: DbTx) {
    const dbService = boundDbService(trx);
    return { reader: new ReplenishmentRulesReader(dbService), manager: new ReplenishmentRulesManager(dbService) };
  }

  it('등급 α 는 Record 로, 3행이 없으면 시드 미실행 Error', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { reader } = build(trx);
      expect(await reader.readGradeAlphas(trx)).toEqual({ A: 0.02, B: 0.05, C: 0.1 });
      await trx
        .delete(wmsTables.replenishmentGradeRules)
        .where(eq(wmsTables.replenishmentGradeRules.grade, 'B'));
      await expect(reader.readGradeAlphas(trx)).rejects.toThrow(/db:seed:ref/);
    });
  });

  it('공급사 행: 전 공급사를 규칙 · 관측과 left join, 이름순', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { warehouseId } = await seedWarehouseWithZone(trx);
      const tag = randomUUID().slice(0, 6);
      const [a] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: `it-${tag}-a`, defaultWarehouseId: warehouseId })
        .returning({ id: wmsTables.suppliers.id });
      const [b] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: `it-${tag}-b` })
        .returning({ id: wmsTables.suppliers.id });
      const { reader, manager } = build(trx);
      await manager.upsertSupplierRule(a.id, { leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 }, trx);
      await trx.insert(wmsTables.supplierLeadTimeProfiles).values({
        supplierId: b.id,
        observations: 3,
        meanDays: 11.5,
        stdDays: 2,
        windowFrom: '2025-09-08',
        windowTo: '2026-09-08',
        computedAt: new Date(),
      });

      const rows = (await reader.listSupplierRows(trx)).filter((r) => r.supplierName.startsWith(`it-${tag}`));
      expect(rows.map((r) => r.supplierName)).toEqual([`it-${tag}-a`, `it-${tag}-b`]);
      expect(rows[0]).toMatchObject({
        defaultWarehouseId: warehouseId,
        rule: { leadTimeDays: 25, leadTimeStdDays: null, coverDays: 40 },
        observation: null,
      });
      expect(rows[1]).toMatchObject({
        defaultWarehouseId: null,
        rule: null,
        observation: { observations: 3, meanDays: 11.5, stdDays: 2 },
      });

      const rules = await reader.readSupplierRules([a.id, b.id], trx);
      expect(rules.get(a.id)?.coverDays).toBe(40);
      expect(rules.has(b.id)).toBe(false);
    });
  });

  it('공급사 규칙 upsert 는 두 번째가 갱신, delete 는 없으면 404, 없는 공급사는 404', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const [s] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: 'it-sup' })
        .returning({ id: wmsTables.suppliers.id });
      const { manager, reader } = build(trx);
      await manager.upsertSupplierRule(s.id, { leadTimeDays: 25, leadTimeStdDays: 3, coverDays: 40 }, trx);
      const updated = await manager.upsertSupplierRule(
        s.id,
        { leadTimeDays: 20, leadTimeStdDays: null, coverDays: 30 },
        trx,
      );
      expect(updated).toMatchObject({ supplierId: s.id, leadTimeDays: 20, leadTimeStdDays: null, coverDays: 30 });
      expect((await reader.readSupplierRules([s.id], trx)).size).toBe(1);
      await manager.deleteSupplierRule(s.id, trx);
      expect((await reader.readSupplierRules([s.id], trx)).size).toBe(0);
      await expect(manager.deleteSupplierRule(s.id, trx)).rejects.toThrow(/규칙/);
      await expect(
        manager.upsertSupplierRule(randomUUID(), { leadTimeDays: 1, leadTimeStdDays: null, coverDays: 1 }, trx),
      ).rejects.toThrow(/공급사/);
    });
  });

  it('경로 행: 규칙 ∪ 관측을 창고명과 함께, from = to 는 400', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const a = await seedWarehouseWithZone(trx);
      const b = await seedWarehouseWithZone(trx);
      const c = await seedWarehouseWithZone(trx);
      const { reader, manager } = build(trx);
      await manager.upsertRouteRule(
        a.warehouseId,
        b.warehouseId,
        { leadTimeDays: 9, leadTimeStdDays: 1, coverDays: 10 },
        trx,
      );
      await trx.insert(wmsTables.routeLeadTimeProfiles).values({
        fromWarehouseId: a.warehouseId,
        toWarehouseId: c.warehouseId,
        observations: 6,
        meanDays: 7,
        stdDays: 2,
        windowFrom: '2025-09-08',
        windowTo: '2026-09-08',
        computedAt: new Date(),
      });

      const rows = await reader.listRouteRows(trx);
      const ab = rows.find((r) => r.fromWarehouseId === a.warehouseId && r.toWarehouseId === b.warehouseId);
      const ac = rows.find((r) => r.fromWarehouseId === a.warehouseId && r.toWarehouseId === c.warehouseId);
      expect(ab).toMatchObject({ rule: { leadTimeDays: 9, coverDays: 10 }, observation: null });
      expect(ab?.fromWarehouseName).toBeTruthy();
      expect(ac).toMatchObject({ rule: null, observation: { observations: 6, meanDays: 7 } });
      expect((await reader.readRouteRules(trx)).get(routeKey(a.warehouseId, b.warehouseId))?.coverDays).toBe(10);

      await expect(
        manager.upsertRouteRule(
          a.warehouseId,
          a.warehouseId,
          { leadTimeDays: 1, leadTimeStdDays: null, coverDays: 1 },
          trx,
        ),
      ).rejects.toThrow(/같은 창고/);
      await expect(
        manager.upsertRouteRule(
          a.warehouseId,
          randomUUID(),
          { leadTimeDays: 1, leadTimeStdDays: null, coverDays: 1 },
          trx,
        ),
      ).rejects.toThrow(/창고/);
      await manager.deleteRouteRule(a.warehouseId, b.warehouseId, trx);
      expect((await reader.readRouteRules(trx)).has(routeKey(a.warehouseId, b.warehouseId))).toBe(false);
      await expect(manager.deleteRouteRule(a.warehouseId, b.warehouseId, trx)).rejects.toThrow(/경로 규칙/);
    });
  });

  it('SKU 예외: upsert · 코드/이름 검색 · delete · 없는 SKU 404', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId, skuCode } = await seedSku(trx, holderId);
      const { reader, manager } = build(trx);
      const row = await manager.upsertSkuOverride(
        skuId,
        { mode: 'excluded', excludedUntil: '2026-12-31', safetyStock: null, alpha: null, memo: '시즌오프' },
        trx,
      );
      expect(row).toMatchObject({ skuId, mode: 'excluded', excludedUntil: '2026-12-31', memo: '시즌오프' });

      const found = await reader.searchSkuOverrides(skuCode.slice(3, 12).toLowerCase(), 50, trx);
      expect(found.map((r) => r.skuId)).toEqual([skuId]);
      expect(found[0]).toMatchObject({ skuCode, skuName: 'it-sku', mode: 'excluded' });
      expect((await reader.readSkuOverrides([skuId], trx)).get(skuId)?.mode).toBe('excluded');
      expect((await reader.searchSkuOverridesById(skuId, trx))[0]).toMatchObject({ skuId, skuCode });

      await manager.upsertSkuOverride(
        skuId,
        { mode: 'auto', excludedUntil: null, safetyStock: 40, alpha: 0.01, memo: null },
        trx,
      );
      expect((await reader.readSkuOverrides([skuId], trx)).get(skuId)).toMatchObject({
        mode: 'auto',
        safetyStock: 40,
        alpha: 0.01,
        excludedUntil: null,
      });

      await manager.deleteSkuOverride(skuId, trx);
      expect((await reader.readSkuOverrides([skuId], trx)).size).toBe(0);
      await expect(manager.deleteSkuOverride(skuId, trx)).rejects.toThrow(/예외/);
      await expect(manager.upsertSkuOverride(randomUUID(), { mode: 'auto' }, trx)).rejects.toThrow(/SKU/);
    });
  });

  it('전역 설정 PUT: 부분 갱신, A컷 ≥ B컷 은 400', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { manager } = build(trx);
      const updated = await manager.updateSettings({ demandRecomputeDays: 21, defaultLeadTimeStdDays: 4 }, trx);
      expect(updated).toMatchObject({
        demandRecomputeDays: 21,
        defaultLeadTimeStdDays: 4,
        classificationWindowDays: 365,
      });
      await expect(manager.updateSettings({ gradeACut: 0.9, gradeBCut: 0.8 }, trx)).rejects.toThrow(/등급 컷/);
      await expect(manager.updateSettings({ gradeACut: 0.96 }, trx)).rejects.toThrow(/등급 컷/); // 기존 B컷 0.95 와 비교
    });
  });

  it('등급 PUT: A · B · C 셋이 아니면 400, 맞으면 3행 갱신', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { manager, reader } = build(trx);
      await expect(
        manager.replaceGradeRules(
          [
            { grade: 'A', alpha: 0.01 },
            { grade: 'A', alpha: 0.02 },
            { grade: 'B', alpha: 0.05 },
          ],
          trx,
        ),
      ).rejects.toThrow(/A · B · C/);
      const replaced = await manager.replaceGradeRules(
        [
          { grade: 'C', alpha: 0.2 },
          { grade: 'A', alpha: 0.01 },
          { grade: 'B', alpha: 0.05 },
        ],
        trx,
      );
      // 입력이 C · A · B 순이어도 PUT 응답은 GET(listGradeRules) 과 같은 등급 오름차순이어야 한다 —
      // 화면이 PUT 응답으로 표를 다시 그리므로 순서가 갈리면 행이 뒤섞여 보인다.
      expect(replaced.map((r) => r.grade)).toEqual(['A', 'B', 'C']);
      expect((await reader.listGradeRules(trx)).map((r) => r.grade)).toEqual(['A', 'B', 'C']);
      expect(await reader.readGradeAlphas(trx)).toEqual({ A: 0.01, B: 0.05, C: 0.2 });
    });
  });

  // Manager 의 upsert 는 is_deleted = false 만 받는다. 목록이 이 조건을 안 걸면 "목록엔 뜨는데
  // 고치려 하면 404" 인 행이 생긴다 — 두 경로가 같은 SKU 모집단을 봐야 한다.
  it('삭제된 SKU 의 예외는 검색 · 단건 되읽기에서 빠지고, upsert 도 404', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId, skuCode } = await seedSku(trx, holderId);
      const { reader, manager } = build(trx);
      const q = skuCode.slice(3, 12).toLowerCase();
      await manager.upsertSkuOverride(skuId, { mode: 'excluded', memo: '시즌오프' }, trx);
      expect((await reader.searchSkuOverrides(q, 50, trx)).map((r) => r.skuId)).toEqual([skuId]);

      await trx.update(wmsTables.skus).set({ isDeleted: true }).where(eq(wmsTables.skus.id, skuId));

      expect(await reader.searchSkuOverrides(q, 50, trx)).toEqual([]);
      expect(await reader.searchSkuOverridesById(skuId, trx)).toEqual([]);
      await expect(manager.upsertSkuOverride(skuId, { mode: 'auto' }, trx)).rejects.toThrow(/SKU/);
    });
  });

  // α = 0 · α = 1 은 Task 3 의 정규 · 감마 분위수가 정의되지 않는 점이다 — 막지 않으면
  // distributions.ts 의 Error 가 그대로 새어 500 이 된다. 1선 방어는 DTO(400),
  // SKU 예외는 DB 체크(ck_replenishment_sku_overrides_alpha)가 2선이다.
  it('α 배타 범위: 등급 · SKU 예외 PUT 이 0 과 1 을 400 으로 거절한다', async () => {
    const pipe = createGlobalValidationPipe();
    const grades = (alpha: number) => ({
      items: [
        { grade: 'A', alpha },
        { grade: 'B', alpha: 0.05 },
        { grade: 'C', alpha: 0.1 },
      ],
    });

    for (const alpha of [0, 1]) {
      await expect(
        pipe.transform(grades(alpha), { type: 'body', metatype: UpdateGradeRulesDto }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        pipe.transform({ mode: 'auto', alpha }, { type: 'body', metatype: UpsertSkuOverrideDto }),
      ).rejects.toMatchObject({ status: 400 });
    }

    // 경계 안쪽은 통과한다 — 위 거절이 "α 를 전부 막았다" 가 아님을 고정한다.
    await expect(
      pipe.transform(grades(0.001), { type: 'body', metatype: UpdateGradeRulesDto }),
    ).resolves.toBeDefined();
  });

  it('α 2선 방어: SKU 예외 α = 0 은 DB 체크가 막는다', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const { manager } = build(trx);
      const error = await manager.upsertSkuOverride(skuId, { mode: 'auto', alpha: 0 }, trx).catch((e: unknown) => e);
      expect(causeChainMessage(error)).toMatch(/ck_replenishment_sku_overrides_alpha/);
    });
  });
});
