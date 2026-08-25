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
import { InboundPipelineReader } from './inbound-pipeline.reader';

/**
 * 부천(판매 창고) 관점의 공급 파이프라인 3단계를 고정한다.
 *
 *   ① 발주 잔량  — 비판매 창고로 입고 예정인 pending 계획
 *   ② 이동 대기  — 비판매 창고 ON_HAND (아직 선적 안 됨)  ← 사각지대
 *   ③ 이동 중    — 선적됐으나 도착·분실 정산이 안 끝난 잔량
 *
 * ②가 빠지면 MD 화면에 "재고 0 · 입고예정 0" 으로 보여 중복 발주가 난다. 라이브의
 * 중국 창고 ON_HAND 가 0 이라 ②·③은 실데이터로 확인할 수 없다 — 이 스펙이 유일한
 * 방어선이다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- inbound-pipeline.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('공급 파이프라인 판독 (DB integration)', () => {
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

  async function inRollback(fn: (trx: DbTx) => Promise<void>): Promise<void> {
    await inRollbackTx(db, fn);
  }

  /** 롤백 트랜잭션에 묶인 DbService 대역 — tx 미지정 호출도 trx 로 흡수한다. */
  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildReader(trx: DbTx): InboundPipelineReader {
    const dbService = boundDbService(trx);
    return new InboundPipelineReader(dbService, new WarehouseTransferReader(dbService));
  }

  function buildTransferManager(trx: DbTx): WarehouseTransferManager {
    const dbService = boundDbService(trx);
    return new WarehouseTransferManager(dbService, w.command, w.location, new InventoryIdempotencyService(dbService));
  }

  interface WarehouseFixture {
    warehouseId: string;
    locationId: string;
  }

  /** 출발 창고는 비판매(중국), 도착 창고는 판매(부천) 다. */
  async function seedTwoWarehouses(
    trx: DbTx,
  ): Promise<{ source: WarehouseFixture; dest: WarehouseFixture; skuId: string }> {
    const source = await seedWarehouseWithZone(trx);
    await trx
      .update(wmsTables.warehouses)
      .set({ isSellable: false })
      .where(eq(wmsTables.warehouses.id, source.warehouseId));
    const dest = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);
    return { source, dest, skuId };
  }

  /**
   * 미도착 발주(source plan) 한 건. `inbound_plans.linked_purchase_order_id` 가
   * NOT NULL + FK 라 공급사·발주를 먼저 넣어야 한다.
   *
   * 계획의 `destination_warehouse_id` 는 입고 창고와 다른 별도의 판매 창고로 둔다 —
   * 판독이 `warehouse_id`(실제 입고 창고)가 아니라 `destination_warehouse_id` 로
   * 집계하면 이 픽스처에서 0 이 나와 스펙이 그 회귀를 잡는다(Task 7).
   */
  async function seedPendingSourcePlan(
    trx: DbTx,
    input: { skuId: string; warehouseId: string; qty: number; expectedDate: Date },
  ): Promise<void> {
    const suffix = randomUUID().slice(0, 8);
    const [finalDestination] = await trx
      .insert(wmsTables.warehouses)
      // 최종 도착지는 판매 창고(부천 역할)다 — 컬럼 DEFAULT 가 false 라 명시해야 한다.
      .values({ name: `it-po-dest-${suffix}`, isSellable: true })
      .returning({ id: wmsTables.warehouses.id });
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${suffix}`, defaultWarehouseId: input.warehouseId })
      .returning({ id: wmsTables.suppliers.id });
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'confirmed',
        sourceWarehouseId: input.warehouseId,
        destinationWarehouseId: finalDestination.id,
        requiresTransfer: true,
        expectedArrival: input.expectedDate,
      })
      .returning({ id: wmsTables.purchaseOrders.id });
    await trx
      .insert(wmsTables.purchaseOrderLines)
      .values({ poId: po.id, skuId: input.skuId, quantity: input.qty, unitPrice: 1000 });

    const [plan] = await trx
      .insert(wmsTables.inboundPlans)
      .values({
        planType: 'source',
        status: 'pending',
        warehouseId: input.warehouseId,
        destinationWarehouseId: finalDestination.id,
        linkedPurchaseOrderId: po.id,
        requiresTransfer: true,
        expectedDate: input.expectedDate,
      })
      .returning({ id: wmsTables.inboundPlans.id });
    await trx.insert(wmsTables.inboundPlanItems).values({
      planId: plan.id,
      skuId: input.skuId,
      expectedQty: input.qty,
      receivedQty: 0,
      status: 'pending',
    });
  }

  /** 지시서를 만들고 곧바로 선적한다 — 선적분은 ON_HAND 에서 IN_TRANSFER 로 빠진다. */
  async function shipTransfer(
    trx: DbTx,
    input: { skuId: string; from: WarehouseFixture; to: WarehouseFixture; qty: number; eta: Date },
  ): Promise<void> {
    const manager = buildTransferManager(trx);
    const { transferOrderId } = await manager.createOrder(
      {
        fromWarehouseId: input.from.warehouseId,
        toWarehouseId: input.to.warehouseId,
        eta: input.eta,
        lines: [{ skuId: input.skuId, fromLocationId: input.from.locationId, quantity: input.qty }],
      },
      trx,
    );
    await manager.ship({ transferOrderId, idempotencyKey: `ship-${randomUUID()}` }, trx);
  }

  /**
   * ①의 ETA 우선순위(아이템 vs 계획) 검증용 — 계획만 만들고 아이템은 비워둔다.
   * 아이템은 각 테스트가 직접 심어 어떤 값이 이기는지를 스스로 통제한다.
   */
  async function seedNonSellableInboundPlan(
    trx: DbTx,
    input: { expectedDate: string },
  ): Promise<{ planId: string; skuIds: string[]; sellableWarehouseId: string }> {
    const suffix = randomUUID().slice(0, 8);
    // seedWarehouseWithZone 은 기본이 판매 창고다 — 출발 창고만 비판매로 뒤집는다(중국 역할).
    const source = await seedWarehouseWithZone(trx);
    await trx
      .update(wmsTables.warehouses)
      .set({ isSellable: false })
      .where(eq(wmsTables.warehouses.id, source.warehouseId));
    const dest = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);

    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${suffix}`, defaultWarehouseId: source.warehouseId })
      .returning({ id: wmsTables.suppliers.id });
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'confirmed',
        sourceWarehouseId: source.warehouseId,
        destinationWarehouseId: dest.warehouseId,
        requiresTransfer: true,
        expectedArrival: new Date(`${input.expectedDate}T00:00:00.000Z`),
      })
      .returning({ id: wmsTables.purchaseOrders.id });

    const [plan] = await trx
      .insert(wmsTables.inboundPlans)
      .values({
        planType: 'source',
        status: 'pending',
        warehouseId: source.warehouseId,
        destinationWarehouseId: dest.warehouseId,
        linkedPurchaseOrderId: po.id,
        requiresTransfer: true,
        expectedDate: new Date(`${input.expectedDate}T00:00:00.000Z`),
      })
      .returning({ id: wmsTables.inboundPlans.id });

    return { planId: plan.id, skuIds: [skuId], sellableWarehouseId: dest.warehouseId };
  }

  it('세 단계를 각각 수량과 예정일로 낸다', async () => {
    await inRollback(async (trx) => {
      const { source, dest, skuId } = await seedTwoWarehouses(trx);
      // ① 발주 잔량 300 (중국 창고 입고 예정, 예정일 9/1)
      await seedPendingSourcePlan(trx, {
        skuId,
        warehouseId: source.warehouseId,
        qty: 300,
        expectedDate: new Date('2026-09-01'),
      });
      // 중국 창고에 250 도착
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: source.warehouseId,
        locationId: source.locationId,
        quantity: 250,
      });
      // ③ 이동 중 50 (ETA 8/20) — 250 중 50 을 선적
      await shipTransfer(trx, {
        skuId,
        from: source,
        to: dest,
        qty: 50,
        eta: new Date('2026-08-20'),
      });

      // 여기부터가 "비판매 창고만 센다" 는 술어의 하중이다. 이 두 줄이 없으면 ①②에서
      // is_sellable 조건을 통째로 지워도 스펙이 초록으로 통과한다.
      //
      // (a) 부천 자신의 진열 재고 111. ②에 섞이면 이미 선반에 있는 물량이 "들어올 물량"
      //     으로 재계상돼 MD 가 정반대 방향으로 잘못 판단한다.
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: dest.warehouseId,
        locationId: dest.locationId,
        quantity: 111,
      });
      // (b) 부천으로 바로 들어오는 국내 발주 77 (예정일 8/15 — ①에 섞이면 수량과
      //     예정일이 함께 틀어진다). 이건 "아직 중국에도 안 들어온 발주" 가 아니다.
      await seedPendingSourcePlan(trx, {
        skuId,
        warehouseId: dest.warehouseId,
        qty: 77,
        expectedDate: new Date('2026-08-15'),
      });

      const [row] = await buildReader(trx).read(trx, { skuIds: [skuId], toWarehouseId: dest.warehouseId });

      expect(row.skuId).toBe(skuId);
      expect(row.onOrderQty).toBe(300); // 판매 창고로 들어오는 77 은 ①이 아니다
      expect(row.onOrderEta).toEqual(new Date('2026-09-01')); // 8/15 가 아니다
      // ②와 ③은 겹치지 않는다 — 선적분은 이미 ON_HAND 에서 빠졌다.
      expect(row.awaitingTransferQty).toBe(200); // 부천 진열 111 은 ②가 아니다
      expect(row.inTransitQty).toBe(50);
      expect(row.inTransitEta).toEqual(new Date('2026-08-20'));
    });
  });

  it('예정일이 없는 단계는 null 로 낸다 (숨기지 않는다)', async () => {
    await inRollback(async (trx) => {
      const { source, dest, skuId } = await seedTwoWarehouses(trx);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: source.warehouseId,
        locationId: source.locationId,
        quantity: 40,
      });

      const [row] = await buildReader(trx).read(trx, { skuIds: [skuId], toWarehouseId: dest.warehouseId });

      expect(row.onOrderQty).toBe(0);
      expect(row.onOrderEta).toBeNull();
      expect(row.awaitingTransferQty).toBe(40);
      expect(row.inTransitQty).toBe(0);
      expect(row.inTransitEta).toBeNull();
    });
  });

  it('다른 창고로 가는 이동은 이 창고의 파이프라인에 들어오지 않는다', async () => {
    await inRollback(async (trx) => {
      const { source, dest, skuId } = await seedTwoWarehouses(trx);
      const other = await seedWarehouseWithZone(trx);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: source.warehouseId,
        locationId: source.locationId,
        quantity: 100,
      });
      await shipTransfer(trx, { skuId, from: source, to: other, qty: 30, eta: new Date('2026-08-25') });

      const [row] = await buildReader(trx).read(trx, { skuIds: [skuId], toWarehouseId: dest.warehouseId });

      // 남은 70 은 여전히 중국 대기다. 30 은 다른 창고로 떠나 이 파이프라인 밖이다.
      expect(row.awaitingTransferQty).toBe(70);
      expect(row.inTransitQty).toBe(0);
      expect(row.inTransitEta).toBeNull();
    });
  });

  it('①의 ETA 는 계획 날짜가 아니라 아이템 예정일 중 최소다', async () => {
    await inRollback(async (trx) => {
      // 비판매 창고(중국)로 들어오는 계획 하나에, 예정일이 다른 아이템 둘.
      const fx = await seedNonSellableInboundPlan(trx, { expectedDate: '2026-12-31' });
      await trx.insert(wmsTables.inboundPlanItems).values([
        { planId: fx.planId, skuId: fx.skuIds[0], expectedQty: 5, receivedQty: 0, status: 'pending', expectedDate: '2026-09-20' },
        { planId: fx.planId, skuId: fx.skuIds[0], expectedQty: 3, receivedQty: 0, status: 'pending', expectedDate: '2026-09-17' },
      ]);

      const rows = await buildReader(trx).read(trx, { skuIds: [fx.skuIds[0]], toWarehouseId: fx.sellableWarehouseId });
      expect(rows[0].onOrderQty).toBe(8);
      expect(rows[0].onOrderEta?.toISOString().slice(0, 10)).toBe('2026-09-17');
    });
  });

  it('아이템 예정일이 없으면 계획 예정일로 떨어진다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedNonSellableInboundPlan(trx, { expectedDate: '2026-12-31' });
      await trx.insert(wmsTables.inboundPlanItems).values([
        { planId: fx.planId, skuId: fx.skuIds[0], expectedQty: 4, receivedQty: 0, status: 'pending' },
      ]);

      const rows = await buildReader(trx).read(trx, { skuIds: [fx.skuIds[0]], toWarehouseId: fx.sellableWarehouseId });
      expect(rows[0].onOrderEta?.toISOString().slice(0, 10)).toBe('2026-12-31');
    });
  });
});
