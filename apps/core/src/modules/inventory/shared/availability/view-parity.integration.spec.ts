import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { wmsSchema, wmsTables, DbTx } from '../../schema/inventory.schema';
import { seedPickableShipment } from '../../../fulfillment/services/__support__/logistics-fixtures';
import { readWarehouseAvailability } from './warehouse-availability';

/**
 * stock_summary_view.available_qty 가 가용재고 정본 정의와 일치하는지 고정한다.
 *
 * 이 스펙이 존재하는 이유: 뷰는 오래 `on_hand − reserved − transit_out` 이었고,
 * transit_out 은 (a) 출발 창고에서만 빼고 도착 창고에 더하지 않아 사내 이동만으로
 * 전사 판매가능수량을 줄였으며 (b) inbound_plan_items 를 읽는데 실제 창고간이동은
 * stock_journals 를 써서 이동이 끝나도 줄지 않았다. 그 항을 제거한 뒤,
 * 아무도 다시 넣지 못하게 이 테스트가 막는다.
 *
 * 실행: COMPOSE_PROJECT_NAME=almondyoung-server npm run test:core:integration:local -- <이 파일의 패턴>
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
class Rollback extends Error {}

describeIfDb('stock_summary_view ↔ availability 모듈 등가 (DB integration)', () => {
  jest.setTimeout(120_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client.end();
  });

  const inRollback = async (fn: (trx: DbTx) => Promise<void>) => {
    await db
      .transaction(async (t) => {
        await fn(t as unknown as DbTx);
        throw new Rollback();
      })
      .catch((e) => {
        if (!(e instanceof Rollback)) throw e;
      });
  };

  const readView = async (trx: DbTx, skuId: string, warehouseId: string): Promise<number> => {
    const rows = (await trx.execute(sql`
      SELECT available_qty FROM stock_summary_view
       WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId}
    `)) as unknown as { available_qty: number | string }[];
    return Number(rows[0]?.available_qty ?? 0);
  };

  it('이전 예정(pending 창고간 inbound plan)이 있어도 뷰와 모듈이 일치한다', async () => {
    await inRollback(async (trx) => {
      // 기반: ON_HAND 10 + confirmed 예약 10 → 예약을 지워 ON_HAND 10 / 예약 0 으로 만든다.
      const fx = await seedPickableShipment(trx, 10);
      await trx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fx.shipmentLineId));

      // 도착 창고 + 발주(=inbound_plans.linkedPurchaseOrderId 가 NOT NULL FK 라 필요)
      const [destWarehouse] = await trx
        .insert(wmsTables.warehouses)
        .values({ name: `it-dest-${randomUUID().slice(0, 8)}` })
        .returning();
      const [po] = await trx
        .insert(wmsTables.purchaseOrders)
        .values({
          type: 'domestic',
          sourceWarehouseId: fx.warehouseId,
          destinationWarehouseId: destWarehouse.id,
          requiresTransfer: true,
        })
        .returning();

      // 출발 창고 → 도착 창고 이전 예정 4개. 이 행이 옛 transit_out 항을 만들던 데이터다.
      const [plan] = await trx
        .insert(wmsTables.inboundPlans)
        .values({
          warehouseId: fx.warehouseId,
          destinationWarehouseId: destWarehouse.id,
          linkedPurchaseOrderId: po.id,
          requiresTransfer: true,
          status: 'pending',
        })
        .returning();
      await trx.insert(wmsTables.inboundPlanItems).values({
        planId: plan.id,
        skuId: fx.skuId,
        expectedQty: 4,
        receivedQty: 0,
        status: 'pending',
      });

      const fromModule = await readWarehouseAvailability(trx, fx.skuId, fx.warehouseId);
      const fromView = await readView(trx, fx.skuId, fx.warehouseId);

      expect(fromModule.available).toBe(10);
      expect(fromView).toBe(10); // 이전 예정은 가용에서 빼지 않는다
    });
  });

  it('예약이 있으면 뷰와 모듈이 같은 값을 낸다', async () => {
    await inRollback(async (trx) => {
      // 기반: ON_HAND 10 + confirmed 예약 10 → 예약을 3 으로 낮춘다.
      const fx = await seedPickableShipment(trx, 10);
      await trx
        .update(wmsTables.stockReservations)
        .set({ quantity: 3 })
        .where(eq(wmsTables.stockReservations.shipmentLineId, fx.shipmentLineId));

      const fromModule = await readWarehouseAvailability(trx, fx.skuId, fx.warehouseId);
      const fromView = await readView(trx, fx.skuId, fx.warehouseId);

      expect(fromView).toBe(fromModule.available);
      expect(fromView).toBe(7);
    });
  });
});
