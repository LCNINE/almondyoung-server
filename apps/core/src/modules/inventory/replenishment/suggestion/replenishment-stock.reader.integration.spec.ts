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
  seedShipmentLineFor,
} from '../../../fulfillment/services/__support__';
import { InventoryIdempotencyService } from '../../core/services/inventory-idempotency.service';
import { WarehouseTransferManager } from '../../warehouse-transfer/services/warehouse-transfer.manager';
import { ReplenishmentStockReader } from './replenishment-stock.reader';

/**
 * 보충 제안의 재고 재료. 원장을 SKU × 판매창고여부 × 상태로 집계하고 확정 예약만 뺀다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- replenishment-stock.reader.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('ReplenishmentStockReader (DB integration)', () => {
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

  async function seedWorld(trx: DbTx) {
    const china = await seedWarehouseWithZone(trx);
    await trx
      .update(wmsTables.warehouses)
      .set({ isSellable: false })
      .where(eq(wmsTables.warehouses.id, china.warehouseId));
    const bucheon = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId, skuCode } = await seedSku(trx, holderId);
    return { china, bucheon, skuId, skuCode, holderId };
  }

  it('원장을 판매/비판매 · ON_HAND/IN_TRANSFER 로 나눠 합한다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: bucheon.warehouseId,
        locationId: bucheon.locationId,
        quantity: 100,
      });
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: china.warehouseId,
        locationId: china.locationId,
        quantity: 250,
      });
      // 중국 250 중 50 선적 → 중국 ON_HAND 200, IN_TRANSFER 50
      const dbService = boundDbService(trx);
      const manager = new WarehouseTransferManager(
        dbService,
        w.command,
        w.location,
        new InventoryIdempotencyService(dbService),
      );
      const { transferOrderId } = await manager.createOrder(
        {
          fromWarehouseId: china.warehouseId,
          toWarehouseId: bucheon.warehouseId,
          lines: [{ skuId, fromLocationId: china.locationId, quantity: 50 }],
        },
        trx,
      );
      await manager.ship({ transferOrderId, idempotencyKey: `ship-${randomUUID()}` }, trx);

      const reader = new ReplenishmentStockReader(dbService);
      const agg = (await reader.readLedgerAggregates(trx, [skuId])).get(skuId);
      expect(agg).toEqual({
        onHandTotal: 300,
        inTransferTotal: 50,
        onHandSellable: 100,
        nonSellableOnHand: [{ warehouseId: china.warehouseId, locationId: china.locationId, qty: 200 }],
      });
    });
  });

  it('확정 예약만 센다 — pending 은 제외, 판매창고분을 따로 낸다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { china, bucheon, skuId } = await seedWorld(trx);
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: bucheon.warehouseId,
        locationId: bucheon.locationId,
        quantity: 100,
      });
      await receiveStock(w.command, trx, {
        skuId,
        warehouseId: china.warehouseId,
        locationId: china.locationId,
        quantity: 100,
      });
      const lineSell = await seedShipmentLineFor(trx, { skuId, warehouseId: bucheon.warehouseId, qty: 7 });
      const lineChina = await seedShipmentLineFor(trx, { skuId, warehouseId: china.warehouseId, qty: 3 });
      const linePending = await seedShipmentLineFor(trx, { skuId, warehouseId: bucheon.warehouseId, qty: 9 });
      await trx.insert(wmsTables.stockReservations).values([
        {
          targetType: 'SHIPMENT_LINE',
          targetId: lineSell,
          shipmentLineId: lineSell,
          skuId,
          warehouseId: bucheon.warehouseId,
          quantity: 7,
          status: 'confirmed',
        },
        {
          targetType: 'SHIPMENT_LINE',
          targetId: lineChina,
          shipmentLineId: lineChina,
          skuId,
          warehouseId: china.warehouseId,
          quantity: 3,
          status: 'confirmed',
        },
        {
          targetType: 'SHIPMENT_LINE',
          targetId: linePending,
          shipmentLineId: linePending,
          skuId,
          warehouseId: bucheon.warehouseId,
          quantity: 9,
          status: 'pending',
        },
      ]);

      const reader = new ReplenishmentStockReader(boundDbService(trx));
      const agg = (await reader.readConfirmedReservations(trx, [skuId])).get(skuId);
      expect(agg).toEqual({ reservedTotal: 10, reservedSellable: 7 });
    });
  });

  it('SKU 마스터: 공급사는 최근 ordered 발주 라인 → 유일한 sku_suppliers 순, packing_unit 은 primary 바코드', async () => {
    await inRollbackTx(db, async (trx) => {
      const { bucheon, skuId, skuCode, holderId } = await seedWorld(trx);
      await trx.update(wmsTables.skus).set({ safetyStock: 40, moq: 12 }).where(eq(wmsTables.skus.id, skuId));
      await trx.insert(wmsTables.skuBarcodes).values([
        { skuId, barcode: `B-${randomUUID()}`, isPrimary: false, packingUnit: 99 },
        { skuId, barcode: `B-${randomUUID()}`, isPrimary: true, packingUnit: 6 },
      ]);
      const [supA] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: 'A' })
        .returning({ id: wmsTables.suppliers.id });
      const [supB] = await trx
        .insert(wmsTables.suppliers)
        .values({ name: 'B' })
        .returning({ id: wmsTables.suppliers.id });
      await trx.insert(wmsTables.skuSuppliers).values([
        { skuId, supplierId: supA.id },
        { skuId, supplierId: supB.id },
      ]);
      // 최근 ordered 라인은 B
      const [po] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: 'domestic',
          supplierId: supB.id,
          sourceWarehouseId: bucheon.warehouseId,
          destinationWarehouseId: bucheon.warehouseId,
        })
        .returning({ id: wmsTables.purchaseOrders.id });
      await trx
        .insert(wmsTables.purchaseOrderLines)
        .values({ poId: po.id, skuId, quantity: 5, status: 'ordered', orderedQty: 5, orderedAt: new Date() });

      // 유일한 sku_suppliers 만 있는 두 번째 SKU
      const { skuId: skuOnly } = await seedSku(trx, holderId);
      await trx.insert(wmsTables.skuSuppliers).values({ skuId: skuOnly, supplierId: supA.id });
      // 공급사가 둘이고 발주 이력이 없는 세 번째 SKU → 미정
      const { skuId: skuAmbiguous } = await seedSku(trx, holderId);
      await trx.insert(wmsTables.skuSuppliers).values([
        { skuId: skuAmbiguous, supplierId: supA.id },
        { skuId: skuAmbiguous, supplierId: supB.id },
      ]);

      const reader = new ReplenishmentStockReader(boundDbService(trx));
      const rows = await reader.listSkuMasters(trx, [skuId, skuOnly, skuAmbiguous]);
      const byId = new Map(rows.map((r) => [r.skuId, r]));
      expect(byId.get(skuId)).toEqual({
        skuId,
        skuCode,
        skuName: 'it-sku',
        safetyStock: 40,
        moq: 12,
        packingUnit: 6,
        supplier: { id: supB.id, name: 'B' },
      });
      expect(byId.get(skuOnly)?.supplier).toEqual({ id: supA.id, name: 'A' });
      expect(byId.get(skuAmbiguous)?.supplier).toBeNull();
    });
  });

  it('삭제된 SKU 는 목록에서 빠진다', async () => {
    await inRollbackTx(db, async (trx) => {
      const { skuId } = await seedWorld(trx);
      await trx.update(wmsTables.skus).set({ isDeleted: true }).where(eq(wmsTables.skus.id, skuId));
      const reader = new ReplenishmentStockReader(boundDbService(trx));
      expect(await reader.listSkuMasters(trx, [skuId])).toEqual([]);
    });
  });

  it('판매 창고가 정확히 하나여야 한다', async () => {
    await inRollbackTx(db, async (trx) => {
      // 롤백 트랜잭션 안에서 기존 판매 창고를 전부 끄고 하나만 켠다
      await trx.update(wmsTables.warehouses).set({ isSellable: false });
      const only = await seedWarehouseWithZone(trx);
      const reader = new ReplenishmentStockReader(boundDbService(trx));
      expect(await reader.findSingleSellableWarehouseId(trx)).toBe(only.warehouseId);

      await seedWarehouseWithZone(trx); // 둘째 판매 창고
      await expect(reader.findSingleSellableWarehouseId(trx)).rejects.toThrow(/판매 창고/);
    });
  });
});
