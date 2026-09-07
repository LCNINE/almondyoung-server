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
import { ReplenishmentStockReader } from './replenishment-stock.reader';
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
    const service = new ReplenishmentSuggestionService(
      dbService,
      new ReplenishmentStockReader(dbService),
      projection,
      transferReader,
    );
    return { service, manager };
  }

  /** 롤백 트랜잭션 안에서 판매 창고를 부천 하나로 만든다 — 라이브 판매 창고 행이 있어도 스펙이 성립한다. */
  async function seedWorld(trx: DbTx, safetyStock: number) {
    await trx.update(wmsTables.warehouses).set({ isSellable: false });
    const china = await seedWarehouseWithZone(trx);
    await trx
      .update(wmsTables.warehouses)
      .set({ isSellable: false })
      .where(eq(wmsTables.warehouses.id, china.warehouseId));
    const bucheon = await seedWarehouseWithZone(trx);
    const { holderId } = await seedHolder(trx);
    const { skuId } = await seedSku(trx, holderId);
    await trx.update(wmsTables.skus).set({ safetyStock }).where(eq(wmsTables.skus.id, skuId));
    return { china, bucheon, skuId };
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
      expect(row?.flags).toContain('legacy_only');
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
      expect(row?.flags).toEqual(expect.arrayContaining(['legacy_only', 'supplier_unknown']));

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

  it('getSku: 없는 SKU 는 NotFoundError', async () => {
    await inRollbackTx(db, async (trx) => {
      await seedWorld(trx, 1);
      const { service } = build(trx);
      await expect(service.getSku(randomUUID(), trx)).rejects.toThrow(/SKU/);
    });
  });
});
