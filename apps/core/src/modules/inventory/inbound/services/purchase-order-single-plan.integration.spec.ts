import { randomUUID } from 'crypto';
import * as postgres from 'postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { makeDb, inRollbackTx } from '../../../fulfillment/services/__support__';
import { PurchaseOrderService } from './purchase-order.service';
import { PurchaseOrderStatus } from '../dto/purchase-order.dto';
import { TransactionService } from '../../shared/services/transaction.service';

/**
 * 해외 발주(출발 창고 ≠ 최종 목적지)가 입고 계획을 하나만 만드는지 고정한다.
 *
 * 이 스펙이 존재하는 이유: 발주 확정이 source/destination 두 계획을 만들었고, 둘 다
 * `destination_warehouse_id` 에 최종 목적지를 채웠다. 뷰가 그 컬럼으로 집계하는 바람에
 * 목적지 창고의 입고예정이 늘 실제의 2배로 잡혔고, destination plan 수령이 무조건
 * `RECEIVE` 라 목적지에 재고를 창조하면서 출발 창고를 깎지 않아 이중 계상까지 났다.
 * 출발 → 목적지 구간은 이제 `transfer_orders` 가 소유한다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- purchase-order-single-plan.integration
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('해외 발주는 입고 계획을 하나만 만든다 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    ({ sql: client, db } = makeDb(DATABASE_URL as string));
  });
  afterAll(async () => {
    await client.end();
  });

  async function inRollback(fn: (trx: DbTx) => Promise<void>): Promise<void> {
    await inRollbackTx(db, fn);
  }

  /**
   * 롤백 트랜잭션에 묶인 DbService 대역. tx 미지정 호출도 trx 로 흡수해 스펙 밖으로
   * 새는 커밋을 막는다.
   */
  function boundDbService(trx: DbTx): DbService<typeof wmsSchema> {
    return {
      db,
      run: <T>(fn: (t: DbTx) => Promise<T>, tx?: DbTx): Promise<T> => fn(tx ?? trx),
    } as unknown as DbService<typeof wmsSchema>;
  }

  function buildPurchaseOrderService(trx: DbTx): PurchaseOrderService {
    const dbService = boundDbService(trx);
    return new PurchaseOrderService(dbService, new TransactionService(dbService));
  }

  interface CrossWarehousePoFixture {
    poId: string;
    sourceWarehouseId: string;
    destinationWarehouseId: string;
    skuId: string;
    quantity: number;
  }

  const PO_QUANTITY = 10;

  /** 공급사·창고 2개(출발 ≠ 목적지)·SKU·발주 헤더·발주 라인을 넣는다. */
  async function seedCrossWarehousePurchaseOrder(trx: DbTx): Promise<CrossWarehousePoFixture> {
    const suffix = randomUUID().slice(0, 8);
    const [sourceWarehouse] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `it-source-${suffix}` })
      .returning();
    const [destinationWarehouse] = await trx
      .insert(wmsTables.warehouses)
      .values({ name: `it-dest-${suffix}` })
      .returning();
    const [supplier] = await trx
      .insert(wmsTables.suppliers)
      .values({ name: `it-supplier-${suffix}`, defaultWarehouseId: sourceWarehouse.id })
      .returning();
    const [holder] = await trx
      .insert(wmsTables.holders)
      .values({ name: `it-holder-${suffix}` })
      .returning();
    const [sku] = await trx
      .insert(wmsTables.skus)
      .values({ name: 'it-sku', code: `IT-${randomUUID().toUpperCase()}`, holderId: holder.id })
      .returning();

    // auditStatus 는 approved 여야 confirmed 로 전이할 수 있다(감사 워크플로).
    const [po] = await trx
      .insert(wmsTables.purchaseOrders)
      .values({
        type: 'foreign',
        supplierId: supplier.id,
        status: 'created',
        auditStatus: 'approved',
        sourceWarehouseId: sourceWarehouse.id,
        destinationWarehouseId: destinationWarehouse.id,
        requiresTransfer: true,
        expectedArrival: new Date(),
      })
      .returning();
    await trx
      .insert(wmsTables.purchaseOrderLines)
      .values({ poId: po.id, skuId: sku.id, quantity: PO_QUANTITY, unitPrice: 1000 });

    return {
      poId: po.id,
      sourceWarehouseId: sourceWarehouse.id,
      destinationWarehouseId: destinationWarehouse.id,
      skuId: sku.id,
      quantity: PO_QUANTITY,
    };
  }

  /** 발주 확정 — 입고 계획 생성 경로(`createInboundPlanFromPO`)를 지나는 유일한 공개 진입점. */
  async function confirmPurchaseOrder(trx: DbTx, poId: string): Promise<void> {
    await buildPurchaseOrderService(trx).updatePurchaseOrderStatus(
      poId,
      { status: PurchaseOrderStatus.CONFIRMED },
      trx,
    );
  }

  it('창고간 이동이 필요한 발주도 입고 계획을 하나만 만든다', async () => {
    await inRollback(async (trx) => {
      const { poId, sourceWarehouseId, destinationWarehouseId } = await seedCrossWarehousePurchaseOrder(trx);
      await confirmPurchaseOrder(trx, poId);

      const plans = await trx
        .select({
          id: wmsTables.inboundPlans.id,
          warehouseId: wmsTables.inboundPlans.warehouseId,
          planType: wmsTables.inboundPlans.planType,
        })
        .from(wmsTables.inboundPlans)
        .where(eq(wmsTables.inboundPlans.linkedPurchaseOrderId, poId));

      expect(plans).toHaveLength(1);
      expect(plans[0].planType).toBe('source');
      expect(plans[0].warehouseId).toBe(sourceWarehouseId);
      expect(destinationWarehouseId).not.toBe(sourceWarehouseId);
    });
  });

  it('입고예정 수량이 발주 수량과 같다 (이중 계상 없음)', async () => {
    await inRollback(async (trx) => {
      const { poId, sourceWarehouseId, destinationWarehouseId, skuId, quantity } =
        await seedCrossWarehousePurchaseOrder(trx);
      await confirmPurchaseOrder(trx, poId);

      const readInboundPending = async (warehouseId: string): Promise<number> => {
        const rows = (await trx.execute(sql`
          SELECT COALESCE(SUM(inbound_pending_qty), 0)::int AS qty FROM stock_summary_view
           WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId}
        `)) as unknown as { qty: number | string }[];
        return Number(rows[0]?.qty ?? 0);
      };

      // 실제로 물건이 들어오는 창고는 출발 창고다 — 목적지행은 이동 지시서가 소유한다.
      expect(await readInboundPending(sourceWarehouseId)).toBe(quantity);
      // 옛 집계 키(destination_warehouse_id)에서는 여기가 20 이었다 — source/destination
      // 두 계획이 같은 창고에 잡혀 발주 수량의 2배가 됐다.
      expect(await readInboundPending(destinationWarehouseId)).toBe(0);
    });
  });
});
