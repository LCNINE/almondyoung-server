import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { DbService } from '@app/db';
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
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { WarehouseTransferManager } from '../../warehouse-transfer/services/warehouse-transfer.manager';
import { WarehouseTransferReader } from '../../warehouse-transfer/services/warehouse-transfer.reader';
import { InboundPipelineReader } from '../../stock-projection/services/inbound-pipeline.reader';
import { StockProjectionService } from '../../stock-projection/services/stock-projection.service';
import { StockProjectionReader } from '../../stock-projection/services/stock-projection.reader';
import { StockProjectionManager } from '../../stock-projection/services/stock-projection.manager';
import { ReplenishmentSettingsReader, SETTINGS_KEY } from '../demand/replenishment-settings.reader';
import { DemandProfileReader } from '../demand/demand-profile.reader';
import { ReplenishmentRulesReader } from '../rules/replenishment-rules.reader';
import { ReplenishmentStockReader } from './replenishment-stock.reader';
import { ReplenishmentSuggestionReader } from './replenishment-suggestion.reader';
import { ReplenishmentSuggestionService } from './replenishment-suggestion.service';

/**
 * 스펙 §10 의 end-to-end 3장면. 롤백 트랜잭션 안에서 판매 창고를 하나로 만든다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-suggestion.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentSuggestionService (DB integration, end-to-end)', () => {
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

  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function build(trx: DbTx) {
    const dbService = boundDbService(trx);
    const transferReader = new WarehouseTransferReader(dbService);
    const pipeline = new InboundPipelineReader(dbService, transferReader);
    const projection = new StockProjectionService(
      new StockProjectionReader(dbService, w.eventStore),
      new StockProjectionManager(dbService as never),
      pipeline,
      dbService,
    );
    const manager = new WarehouseTransferManager(
      dbService,
      w.command,
      w.location,
      new InventoryIdempotencyService(dbService),
    );
    const reader = new ReplenishmentSuggestionReader(
      new ReplenishmentStockReader(dbService),
      projection,
      transferReader,
      new ReplenishmentSettingsReader(dbService),
      new DemandProfileReader(dbService),
      new ReplenishmentRulesReader(dbService),
    );
    const service = new ReplenishmentSuggestionService(dbService, reader);
    return { service, manager };
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

  /**
   * 롤백 트랜잭션 안에서 판매 창고를 부천 하나로 만든다 — 라이브 판매 창고 행이 있어도 스펙이 성립한다.
   * safetyStock 은 SKU 예외 오버라이드 — 수요 0 이면 SS = ROP = S.
   */
  async function seedWorld(trx: DbTx, safetyStock: number) {
    await seedRules(trx);
    await trx.update(wmsTables.warehouses).set({ isSellable: false });
    const china = await seedWarehouseWithZone(trx);
    await trx
      .update(wmsTables.warehouses)
      .set({ isSellable: false })
      .where(eq(wmsTables.warehouses.id, china.warehouseId));
    const bucheon = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);
    await trx.insert(wmsTables.replenishmentSkuOverrides).values({ skuId, mode: 'auto', safetyStock });
    return { china, bucheon, skuId, holderId };
  }

  async function seedPendingPlan(
    trx: DbTx,
    input: { skuId: string; warehouseId: string; destinationWarehouseId: string; qty: number },
  ) {
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${randomUUID().slice(0, 8)}`, defaultWarehouseId: input.warehouseId })
      .returning({ id: wmsTables.suppliers.id });
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'confirmed',
        sourceWarehouseId: input.warehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        requiresTransfer: input.warehouseId !== input.destinationWarehouseId,
      })
      .returning({ id: wmsTables.purchaseOrders.id });
    await trx.insert(wmsTables.purchaseOrderLines).values({ poId: po.id, skuId: input.skuId, quantity: input.qty });
    const [plan] = await trx
      .insert(wmsTables.inboundPlans)
      .values({
        planType: 'source',
        status: 'pending',
        warehouseId: input.warehouseId,
        destinationWarehouseId: input.destinationWarehouseId,
        linkedPurchaseOrderId: po.id,
        requiresTransfer: input.warehouseId !== input.destinationWarehouseId,
      })
      .returning({ id: wmsTables.inboundPlans.id });
    await trx
      .insert(wmsTables.inboundPlanItems)
      .values({ planId: plan.id, skuId: input.skuId, expectedQty: input.qty, receivedQty: 0, status: 'pending' });
  }

  it('장면 1: 중국 有 · 부천 부족 → 이동만', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: bucheon.warehouseId,
        locationId: bucheon.locationId,
        quantity: 20,
      });
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: china.warehouseId,
        locationId: china.locationId,
        quantity: 300,
      });

      const { service } = build(trx);
      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      const row = items.find((r) => r.skuId === skuId);
      expect(row?.actions).toEqual([
        {
          type: 'transfer',
          qty: 80,
          fromWarehouseId: china.warehouseId,
          toWarehouseId: bucheon.warehouseId,
          lines: [{ fromLocationId: china.locationId, quantity: 80 }],
        },
      ]);
      expect(row?.sellable.warehouseId).toBe(bucheon.warehouseId);
      expect(row?.flags).toEqual(expect.arrayContaining(['default_lead_time', 'low_confidence', 'supplier_unknown']));
    });
  });

  it('장면 2: 둘 다 부족 → 이동(있는 만큼) + 발주 — draft 지시서분은 이동에서 빠진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: bucheon.warehouseId,
        locationId: bucheon.locationId,
        quantity: 10,
      });
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: china.warehouseId,
        locationId: china.locationId,
        quantity: 50,
      });
      const { service, manager } = build(trx);
      // 어제 제안으로 만든 draft 20
      await manager.createOrder(
        {
          fromWarehouseId: china.warehouseId,
          toWarehouseId: bucheon.warehouseId,
          lines: [{ skuId, fromLocationId: china.locationId, quantity: 20 }],
        },
        trx,
      );

      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      const row = items.find((r) => r.skuId === skuId);
      expect(row?.company.position).toBe(60);
      expect(row?.actions).toEqual([
        { type: 'purchase', qty: 40, supplierId: null, sourceWarehouseId: null },
        {
          type: 'transfer',
          qty: 30,
          fromWarehouseId: china.warehouseId,
          toWarehouseId: bucheon.warehouseId,
          lines: [{ fromLocationId: china.locationId, quantity: 30 }],
        },
      ]);
      expect(row?.flags).toEqual(expect.arrayContaining(['default_lead_time', 'low_confidence', 'supplier_unknown']));

      // action 필터
      const purchaseOnly = await service.listSuggestions({ action: 'purchase' }, trx);
      expect(purchaseOnly.items.find((r) => r.skuId === skuId)?.actions.map((a) => a.type)).toEqual(['purchase']);
    });
  });

  it('장면 3: 발주잔량이 덮고 이동중이 덮음 → 제안 없음, getSku 는 행을 준다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: china.warehouseId,
        locationId: china.locationId,
        quantity: 150,
      });
      const { service, manager } = build(trx);
      // 중국 150 전량 선적 → 부천행 이동중 150
      const { transferOrderId } = await manager.createOrder(
        {
          fromWarehouseId: china.warehouseId,
          toWarehouseId: bucheon.warehouseId,
          lines: [{ skuId, fromLocationId: china.locationId, quantity: 150 }],
        },
        trx,
      );
      await manager.ship({ transferOrderId, idempotencyKey: `ship-${randomUUID()}` }, trx);
      // 전사 축엔 발주잔량 100 이 추가로 옴
      await seedPendingPlan(trx, {
        skuId,
        warehouseId: china.warehouseId,
        destinationWarehouseId: bucheon.warehouseId,
        qty: 100,
      });

      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      expect(items.find((r) => r.skuId === skuId)).toBeUndefined();

      const row = await service.getSku(skuId, trx);
      expect(row.actions).toEqual([]);
      expect(row.company).toMatchObject({ onHand: 0, inTransfer: 150, onOrder: 100, position: 250 });
      expect(row.sellable).toMatchObject({ onHand: 0, inTransit: 150, onOrderDirect: 0, position: 150 });
    });
  });

  it('장면 4: 프로필 · 규칙으로 계산한 수준 — smooth · 공급사/경로 규칙 · 통합 버퍼 · 발주 출발 창고', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 0);
      await trx.delete(wmsTables.replenishmentSkuOverrides).where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId));
      // 매일 10개 파는 smooth SKU, 등급 A
      await trx.insert(wmsTables.skuDemandProfiles).values({
        skuId,
        pattern: 'smooth',
        grade: 'A',
        adi: 1,
        cv2: 0,
        dailyMean: 10,
        dailyStd: 0,
        dailyMean90: 10,
        sizeMean: 10,
        sizeStd: 0,
        intervalMean: 1,
        historyDays: 365,
        demandEvents: 365,
        classificationFrom: '2025-09-08',
        classificationTo: '2026-09-07',
        paramFrom: '2026-06-10',
        paramTo: '2026-09-07',
        computedAt: new Date(),
      });
      // 공급사(출발 창고 = 중국) + L1 규칙 20일 σ0 커버 30, 경로 규칙 중국→부천 5일 σ0 커버 14
      const [supplier] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: 'it-sup', defaultWarehouseId: china.warehouseId })
        .returning({ id: wmsTables.suppliers.id });
      await trx.insert(wmsTables.skuSuppliers).values({ skuId, supplierId: supplier.id });
      await trx
        .insert(wmsTables.replenishmentSupplierRules)
        .values({ supplierId: supplier.id, leadTimeDays: 20, leadTimeStdDays: 0, coverDays: 30 });
      await trx.insert(wmsTables.replenishmentRouteRules).values({
        fromWarehouseId: china.warehouseId,
        toWarehouseId: bucheon.warehouseId,
        leadTimeDays: 5,
        leadTimeStdDays: 0,
        coverDays: 14,
      });
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: bucheon.warehouseId,
        locationId: bucheon.locationId,
        quantity: 40,
      });
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: china.warehouseId,
        locationId: china.locationId,
        quantity: 100,
      });

      const { service } = build(trx);
      const row = await service.getSku(skuId, trx);
      // 전사: μ_L = 20 + 5 + 버퍼 7 = 32, σ 0 → ROP = 320, S = 10·(32+30) = 620. IP 140 ≤ 320 → 발주 480, 출발 창고 = 중국
      expect(row.company).toMatchObject({
        position: 140,
        safetyStock: 0,
        reorderPoint: 320,
        targetLevel: 620,
        leadTimeDays: 32,
      });
      // 판매: μ_L = 5 → ROP 50, S = 10·(5+14) = 190. IP 40 ≤ 50 → 필요 150, 이동가능 100 → 이동 100
      expect(row.sellable).toMatchObject({
        position: 40,
        reorderPoint: 50,
        targetLevel: 190,
        leadTimeDays: 5,
        daysOfCover: 4,
      });
      expect(row.actions).toEqual([
        { type: 'purchase', qty: 480, supplierId: supplier.id, sourceWarehouseId: china.warehouseId },
        {
          type: 'transfer',
          qty: 100,
          fromWarehouseId: china.warehouseId,
          toWarehouseId: bucheon.warehouseId,
          lines: [{ fromLocationId: china.locationId, quantity: 100 }],
        },
      ]);
      expect(row.flags).toEqual([]);
      expect(row).toMatchObject({
        pattern: 'smooth',
        grade: 'A',
        confidence: 'normal',
        legacyReorderPoint: 320,
        demand: { dailyMean: 10, dailyStd: 0 },
      });
      expect(row.profile).toMatchObject({ pattern: 'smooth', grade: 'A', dailyMean: 10, historyDays: 365 });
      expect(row.parameters).toMatchObject({
        excluded: false,
        alpha: { value: 0.02, source: 'grade' },
        l1: { meanDays: 20, stdDays: 0, source: 'supplier_rule' },
        l2: { meanDays: 5, stdDays: 0, source: 'route_rule' },
        coverDays: { value: 30, source: 'supplier_rule' },
        transferCoverDays: { value: 14, source: 'route_rule' },
        usesDefaultLeadTime: false,
      });
    });
  });

  it('장면 5: excluded SKU 는 목록에서 빠지지만 getSku 는 행을 준다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx, 100);
      await trx
        .update(wmsTables.replenishmentSkuOverrides)
        .set({ mode: 'excluded', excludedUntil: null })
        .where(eq(wmsTables.replenishmentSkuOverrides.skuId, skuId));
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: china.warehouseId,
        locationId: china.locationId,
        quantity: 300,
      });
      const { service } = build(trx);
      const { items } = await service.listSuggestions({ action: 'all' }, trx);
      expect(items.find((r) => r.skuId === skuId)).toBeUndefined();
      const row = await service.getSku(skuId, trx);
      expect(row.parameters.excluded).toBe(true);
      expect(row.sellable.warehouseId).toBe(bucheon.warehouseId);
    });
  });

  it('장면 6: 프로필이 없으면 insufficient · low_confidence 로 흐른다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { skuId } = await seedWorld(trx, 10);
      const { service } = build(trx);
      const row = await service.getSku(skuId, trx);
      expect(row.profile).toBeNull();
      expect(row).toMatchObject({ pattern: 'insufficient', grade: 'C', confidence: 'low' });
      expect(row.flags).toEqual(expect.arrayContaining(['low_confidence']));
    });
  });

  it('limit: 결과를 자르되 total 은 자르기 전(actionable) 개수를 낸다', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedRules(trx);
      await trx.update(wmsTables.warehouses).set({ isSellable: false });
      await seedWarehouseWithZone(trx); // 판매 창고 하나 (부천 역할, isSellable 기본 true)
      const { holderId } = await seedHolder(trx);
      const skuA = await seedSku(trx, holderId);
      const skuB = await seedSku(trx, holderId);
      await trx.insert(wmsTables.replenishmentSkuOverrides).values([
        { skuId: skuA.skuId, mode: 'auto', safetyStock: 50 },
        { skuId: skuB.skuId, mode: 'auto', safetyStock: 50 },
      ]);

      const { service } = build(trx);
      const full = await service.listSuggestions({ action: 'all' }, trx);
      const limited = await service.listSuggestions({ action: 'all', limit: 1 }, trx);

      const fullIds = full.items.map((r) => r.skuId);
      expect(fullIds).toEqual(expect.arrayContaining([skuA.skuId, skuB.skuId]));
      expect(full.items).toHaveLength(full.total);
      expect(limited.items).toHaveLength(1);
      expect(limited.total).toBe(full.total);
      expect(limited.total).toBeGreaterThanOrEqual(2);
    });
  });

  it('getSku: 없는 SKU 는 NotFoundError', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedWorld(trx, 1);
      const { service } = build(trx);
      await expect(service.getSku(randomUUID(), trx)).rejects.toThrow(/SKU/);
    });
  });
});
