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
 * `projected_available_qty` 도 함께 고정한다 — 뷰가 정본 산식을 한 줄 아래에서
 * 다시 유도하는 자리라, available 만 지키면 같은 실패가 projected 로 재발한다.
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

  interface ViewRow {
    available: number;
    projected: number;
    inboundPending: number;
  }

  const readViewRow = async (trx: DbTx, skuId: string, warehouseId: string): Promise<ViewRow> => {
    const rows = (await trx.execute(sql`
      SELECT available_qty, projected_available_qty, inbound_pending_qty
        FROM stock_summary_view
       WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId}
    `)) as unknown as {
      available_qty: number | string;
      projected_available_qty: number | string;
      inbound_pending_qty: number | string;
    }[];
    return {
      available: Number(rows[0]?.available_qty ?? 0),
      projected: Number(rows[0]?.projected_available_qty ?? 0),
      inboundPending: Number(rows[0]?.inbound_pending_qty ?? 0),
    };
  };

  /**
   * `projected_available_qty` 는 뷰 안에서 정본 산식을 다시 유도한다
   * (`on_hand − reserved + inbound_pending`). 그 재유도가 `available_qty` 와
   * 갈라지지 않게 고정한다 — 예컨대 projected 에만 transit_out 을 다시 빼는 변경을 잡는다.
   */
  const expectProjectedDerivesFromAvailable = (row: ViewRow) => {
    expect(row.projected).toBe(row.available + row.inboundPending);
  };

  it('이전 예정(pending 창고간 inbound plan)이 있어도 출발·도착 창고 모두 뷰와 모듈이 일치한다', async () => {
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

      // 출발 창고: ON_HAND 10 / 예약 0 / 이전 예정 4(transit_out) / 입고 예정 0
      const fromModule = await readWarehouseAvailability(trx, fx.skuId, fx.warehouseId);
      const source = await readViewRow(trx, fx.skuId, fx.warehouseId);

      expect(fromModule.available).toBe(10);
      expect(source.available).toBe(10); // 이전 예정은 가용에서 빼지 않는다
      expect(source.inboundPending).toBe(0);
      expect(source.projected).toBe(10); // projected 로도 transit_out 이 새지 않는다
      expectProjectedDerivesFromAvailable(source);

      // 도착 창고: 재고 0 / 입고 예정 4. `+ inbound_pending` 항은 여기서만 검증된다 —
      // 출발 창고 쪽은 inbound_pending 이 0 이라 그 항이 있으나 없으나 통과한다.
      const destModule = await readWarehouseAvailability(trx, fx.skuId, destWarehouse.id);
      const dest = await readViewRow(trx, fx.skuId, destWarehouse.id);

      expect(destModule.available).toBe(0);
      expect(dest.available).toBe(0);
      expect(dest.inboundPending).toBe(4);
      expect(dest.projected).toBe(4);
      expectProjectedDerivesFromAvailable(dest);
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
      const fromView = await readViewRow(trx, fx.skuId, fx.warehouseId);

      expect(fromView.available).toBe(fromModule.available);
      expect(fromView.available).toBe(7);
      expect(fromView.projected).toBe(7);
      expectProjectedDerivesFromAvailable(fromView);
    });
  });
});
