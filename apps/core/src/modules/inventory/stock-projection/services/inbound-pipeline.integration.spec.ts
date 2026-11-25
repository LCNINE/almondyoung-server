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
import { InboundShipmentSkuMatcherReader } from '../../inbound-shipment/services/inbound-shipment-sku-matcher.reader';
import { InboundShipmentDraftManager } from '../../inbound-shipment/services/inbound-shipment-draft.manager';
import { PurchaseOrderExpectedArrivalReader } from '../../procurement/services/purchase-order-expected-arrival.reader';

/**
 * 부천(판매 창고) 관점의 공급 파이프라인 3단계를 고정한다.
 *
 *   ① 발주 잔량  — 비판매 창고로 입고 예정인 남은 실발주 라인
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
    return new InboundPipelineReader(
      dbService,
      new WarehouseTransferReader(dbService),
      new PurchaseOrderExpectedArrivalReader(dbService),
    );
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
   * 미도착 발주 한 건. destination 은 입고 창고와 다른 판매 창고로 둔다 — 판독이
   * sourceWarehouseId 대신 destinationWarehouseId 로 집계하면 이 픽스처에서 0 이 난다.
   */
  async function seedPendingSourcePlan(
    trx: DbTx,
    input: { skuId: string; warehouseId: string; qty: number; expectedDate?: Date },
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
      })
      .returning({ id: wmsTables.purchaseOrders.id });
    await trx.insert(wmsTables.purchaseOrderLines).values({
      poId: po.id,
      skuId: input.skuId,
      quantity: input.qty,
      unitPrice: 1000,
      status: 'ordered',
      orderedQty: input.qty,
      receivedQty: 0,
      expectedArrival: input.expectedDate?.toISOString().slice(0, 10),
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
   * ①의 ETA 검증용 — 비판매 출발 창고와 SKU를 만든다.
   */
  async function seedNonSellablePurchaseOrderWorld(
    trx: DbTx,
  ): Promise<{ sourceWarehouseId: string; skuIds: string[]; sellableWarehouseId: string }> {
    // seedWarehouseWithZone 은 기본이 판매 창고다 — 출발 창고만 비판매로 뒤집는다(중국 역할).
    const source = await seedWarehouseWithZone(trx);
    await trx
      .update(wmsTables.warehouses)
      .set({ isSellable: false })
      .where(eq(wmsTables.warehouses.id, source.warehouseId));
    const dest = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);

    return { sourceWarehouseId: source.warehouseId, skuIds: [skuId], sellableWarehouseId: dest.warehouseId };
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
      // 전 창고 발주잔량 = 중국행 300 + 부천 직행 77. 기존 ①(onOrderQty)은 300 그대로.
      expect(row.onOrderTotalQty).toBe(377);
      expect(row.onOrderQty).toBe(300);
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

  it('①의 ETA 는 남은 발주 라인 예정일 중 최소다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedNonSellablePurchaseOrderWorld(trx);
      await seedPendingSourcePlan(trx, {
        skuId: fx.skuIds[0],
        warehouseId: fx.sourceWarehouseId,
        qty: 5,
        expectedDate: new Date('2026-09-20'),
      });
      await seedPendingSourcePlan(trx, {
        skuId: fx.skuIds[0],
        warehouseId: fx.sourceWarehouseId,
        qty: 3,
        expectedDate: new Date('2026-09-17'),
      });

      const rows = await buildReader(trx).read(trx, { skuIds: [fx.skuIds[0]], toWarehouseId: fx.sellableWarehouseId });
      expect(rows[0].onOrderQty).toBe(8);
      expect(rows[0].onOrderEta?.toISOString().slice(0, 10)).toBe('2026-09-17');
    });
  });

  it('판매 창고행 발주의 예정일은 판매 창고로 들어오는 발주끼리만 따져 가장 이른 날을 낸다', async () => {
    await inRollback(async (trx) => {
      const { source, dest, skuId } = await seedTwoWarehouses(trx);
      const read = async () =>
        (await buildReader(trx).read(trx, { skuIds: [skuId], toWarehouseId: dest.warehouseId }))[0];

      // 더 이른 해외 발주만 있으면 판매 창고행 예정일은 없다
      await seedPendingSourcePlan(trx, {
        skuId,
        warehouseId: source.warehouseId,
        qty: 300,
        expectedDate: new Date('2026-08-01'),
      });
      expect((await read()).onOrderToSellableEta).toBeNull();

      await seedPendingSourcePlan(trx, {
        skuId,
        warehouseId: dest.warehouseId,
        qty: 4,
        expectedDate: new Date('2026-08-20'),
      });
      await seedPendingSourcePlan(trx, {
        skuId,
        warehouseId: dest.warehouseId,
        qty: 2,
        expectedDate: new Date('2026-08-15'),
      });
      await seedPendingSourcePlan(trx, { skuId, warehouseId: dest.warehouseId, qty: 1 });

      const row = await read();
      expect(row.onOrderToSellableEta).toBe('2026-08-15');
      expect(row.onOrderTotalQty - row.onOrderQty).toBe(7);
      // 비판매 창고행 예정일은 그대로다
      expect(row.onOrderEta).toEqual(new Date('2026-08-01'));
    });
  });

  it('라인 예정일이 없으면 ETA 도 없다', async () => {
    await inRollback(async (trx) => {
      const fx = await seedNonSellablePurchaseOrderWorld(trx);
      await seedPendingSourcePlan(trx, {
        skuId: fx.skuIds[0],
        warehouseId: fx.sourceWarehouseId,
        qty: 4,
      });

      const rows = await buildReader(trx).read(trx, { skuIds: [fx.skuIds[0]], toWarehouseId: fx.sellableWarehouseId });
      expect(rows[0].onOrderQty).toBe(4);
      expect(rows[0].onOrderEta).toBeNull();
    });
  });
  describe('선적 오는 중 (#1240)', () => {
    const ACTOR = randomUUID();
    const HEADER = ['박스번호', 'NO', '제품명', '수량', '옵션', '바코드', '총수량', '비고'];
    const cell = (text: string, value: string | number | null = text) => ({ text, value });

    async function seedShipmentSku(trx: DbTx) {
      const { holderId } = await seedHolder(trx);
      const { skuId } = await seedSku(trx, holderId);
      const barcode = `8${Math.floor(Math.random() * 1e11)
        .toString()
        .padStart(11, '0')}`;
      await trx.insert(wmsTables.skuBarcodes).values({ skuId, barcode });
      return { skuId, barcode };
    }

    async function confirmedShipment(
      trx: DbTx,
      warehouseId: string,
      barcode: string,
      qty: number,
      expectedArrival: string | null,
    ): Promise<string> {
      const dbService = boundDbService(trx);
      const drafts = new InboundShipmentDraftManager(dbService, new InboundShipmentSkuMatcherReader(dbService), {
        recalculateAndPublishForSkus: jest.fn().mockResolvedValue([]),
      } as never);
      const { shipmentId } = await drafts.createDraft(
        {
          warehouseId,
          name: `pipe-${randomUUID().slice(0, 6)}`,
          expectedArrival,
          sourceFileId: null,
          sourceFileName: 'a.xlsx',
          list: {
            header: HEADER,
            rows: [
              {
                rowNumber: 1,
                cells: [
                  cell('L1'),
                  cell('1'),
                  cell('prod'),
                  cell(String(qty), qty),
                  cell('opt'),
                  cell(barcode),
                  cell(String(qty), qty),
                  cell(''),
                ],
              },
            ],
          },
        },
        ACTOR,
        trx,
      );
      await drafts.confirm(shipmentId, [], ACTOR, trx);
      return shipmentId;
    }

    async function setSellable(trx: DbTx, warehouseId: string, isSellable: boolean) {
      await trx.update(wmsTables.warehouses).set({ isSellable }).where(eq(wmsTables.warehouses.id, warehouseId));
    }

    it('pipeline counts late shipments', async () => {
      await inRollback(async (trx) => {
        const sellable = await seedWarehouseWithZone(trx);
        await setSellable(trx, sellable.warehouseId, true);
        const other = await seedWarehouseWithZone(trx);
        await setSellable(trx, other.warehouseId, false);
        const a = await seedShipmentSku(trx);
        const b = await seedShipmentSku(trx);

        await confirmedShipment(trx, sellable.warehouseId, a.barcode, 7, '2020-01-01');
        await confirmedShipment(trx, other.warehouseId, a.barcode, 5, '2019-01-01');
        await confirmedShipment(trx, other.warehouseId, b.barcode, 4, null);

        const rows = await buildReader(trx).read(trx, {
          skuIds: [a.skuId, b.skuId],
          toWarehouseId: sellable.warehouseId,
        });
        const rowA = rows.find((r) => r.skuId === a.skuId);
        const rowB = rows.find((r) => r.skuId === b.skuId);
        expect(rowA).toMatchObject({
          inboundShipmentQty: 12,
          inboundShipmentToSellableQty: 7,
          inboundShipmentEta: '2020-01-01',
        });
        expect(rowB).toMatchObject({
          inboundShipmentQty: 4,
          inboundShipmentToSellableQty: 0,
          inboundShipmentEta: null,
        });
      });
    });

    it('pipeline ignores manually closed shipments', async () => {
      await inRollback(async (trx) => {
        const sellable = await seedWarehouseWithZone(trx);
        await setSellable(trx, sellable.warehouseId, true);
        const a = await seedShipmentSku(trx);
        const shipmentId = await confirmedShipment(trx, sellable.warehouseId, a.barcode, 7, '2030-01-01');
        const dbService = boundDbService(trx);
        const drafts = new InboundShipmentDraftManager(dbService, new InboundShipmentSkuMatcherReader(dbService), {
          recalculateAndPublishForSkus: jest.fn().mockResolvedValue([]),
        } as never);
        await drafts.close(shipmentId, 'never arrived', ACTOR, trx);

        const [row] = await buildReader(trx).read(trx, { skuIds: [a.skuId], toWarehouseId: sellable.warehouseId });
        expect(row).toMatchObject({ inboundShipmentQty: 0, inboundShipmentToSellableQty: 0, inboundShipmentEta: null });
      });
    });
  });
});
