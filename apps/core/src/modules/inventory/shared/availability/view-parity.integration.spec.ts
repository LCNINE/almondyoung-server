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
 * transit_out 은 이제 `transfer_order_lines` 의 미도착 잔량을 도착 창고 기준으로 읽는다.
 * 픽스처가 그 행을 심는 이유는 변별력이다 — 0 을 다시 빼는 회귀는 no-op 이라 통과한다.
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
    transferPending: number;
    defective: number;
    inTransfer: number;
  }

  const readViewRow = async (trx: DbTx, skuId: string, warehouseId: string): Promise<ViewRow> => {
    const rows = (await trx.execute(sql`
      SELECT available_qty, projected_available_qty, inbound_pending_qty, transfer_pending_qty,
             defective_qty, in_transfer_qty
        FROM stock_summary_view
       WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId}
    `)) as unknown as {
      available_qty: number | string;
      projected_available_qty: number | string;
      inbound_pending_qty: number | string;
      transfer_pending_qty: number | string;
      defective_qty: number | string;
      in_transfer_qty: number | string;
    }[];
    return {
      available: Number(rows[0]?.available_qty ?? 0),
      projected: Number(rows[0]?.projected_available_qty ?? 0),
      inboundPending: Number(rows[0]?.inbound_pending_qty ?? 0),
      transferPending: Number(rows[0]?.transfer_pending_qty ?? 0),
      defective: Number(rows[0]?.defective_qty ?? 0),
      inTransfer: Number(rows[0]?.in_transfer_qty ?? 0),
    };
  };

  const DEFECTIVE_QTY = 5;
  const IN_TRANSFER_QTY = 3;
  /** 떠났지만 아직 도착하지 않은 이동 수량 — transit_out 항을 0 이 아니게 만드는 값. */
  const TRANSIT_QTY = 3;

  /**
   * ON_HAND 가 아닌 원장 상태를 같은 (sku, warehouse, location) 에 심는다.
   *
   * 이 행들이 없으면 가용 산식에 DEFECTIVE/IN_TRANSFER 를 섞는 변경이 이 스펙을
   * 초록으로 통과한다 — 두 상태의 합이 0 이라 오염된 산식과 정본 산식이 같은 값을 낸다.
   * 원장 PK 가 (sku, warehouse, location, stock_state) 라 같은 로케이션에 공존한다.
   */
  const seedNonOnHandLedgers = async (trx: DbTx, fx: { skuId: string; warehouseId: string; locationId: string }) => {
    await trx.insert(wmsTables.stockLedgers).values([
      {
        skuId: fx.skuId,
        warehouseId: fx.warehouseId,
        locationId: fx.locationId,
        stockState: 'DEFECTIVE',
        qty: DEFECTIVE_QTY,
      },
      {
        skuId: fx.skuId,
        warehouseId: fx.warehouseId,
        locationId: fx.locationId,
        stockState: 'IN_TRANSFER',
        qty: IN_TRANSFER_QTY,
      },
    ]);
  };

  /** 심은 행이 실제로 뷰에 보이는지 — 시딩이 조용히 no-op 이면 변별력이 되돌아간다. */
  const expectNonOnHandSeeded = (row: ViewRow) => {
    expect(row.defective).toBe(DEFECTIVE_QTY);
    expect(row.inTransfer).toBe(IN_TRANSFER_QTY);
  };

  /**
   * `projected_available_qty` 는 뷰 안에서 정본 산식을 다시 유도한다
   * (`on_hand − reserved + inbound_pending`). 그 재유도가 `available_qty` 와
   * 갈라지지 않게 고정한다 — 예컨대 projected 에만 transit_out 을 다시 빼는 변경을 잡는다.
   */
  const expectProjectedDerivesFromAvailable = (row: ViewRow) => {
    expect(row.projected).toBe(row.available + row.inboundPending);
  };

  it('미도착 이동(shipped 이동 지시서)이 있어도 출발·도착 창고 모두 뷰와 모듈이 일치한다', async () => {
    await inRollback(async (trx) => {
      // 기반: ON_HAND 10 + confirmed 예약 10 → 예약을 지워 ON_HAND 10 / 예약 0 으로 만든다.
      const fx = await seedPickableShipment(trx, 10);
      await trx
        .delete(wmsTables.stockReservations)
        .where(eq(wmsTables.stockReservations.shipmentLineId, fx.shipmentLineId));
      await seedNonOnHandLedgers(trx, fx);

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

      // 출발 창고 입고 예정 4개. inbound_pending 은 "그 창고에 실제로 입고될 예정"이라
      // 계획의 warehouse_id(=출발 창고) 에 붙는다.
      const [plan] = await trx
        .insert(wmsTables.inboundPlans)
        .values({
          warehouseId: fx.warehouseId,
          planType: 'source',
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

      // 떠났지만 아직 도착하지 않은 이동 3개. 이 행이 transit_out 항을 만드는 데이터다 —
      // 이게 없으면 "transit 을 다시 빼는" 회귀가 0 을 빼는 no-op 이 돼 초록으로 통과한다.
      const [transferOrder] = await trx
        .insert(wmsTables.transferOrders)
        .values({
          fromWarehouseId: fx.warehouseId,
          toWarehouseId: destWarehouse.id,
          status: 'shipped',
          shippedAt: new Date(),
        })
        .returning();
      await trx.insert(wmsTables.transferOrderLines).values({
        transferOrderId: transferOrder.id,
        skuId: fx.skuId,
        fromLocationId: fx.locationId,
        plannedQty: TRANSIT_QTY,
        shippedQty: TRANSIT_QTY,
      });

      // 출발 창고: ON_HAND 10 / 예약 0 / 입고 예정 4 / 미도착 이동 0(도착 창고 기준이므로)
      const fromModule = await readWarehouseAvailability(trx, fx.skuId, fx.warehouseId);
      const source = await readViewRow(trx, fx.skuId, fx.warehouseId);

      expect(fromModule.available).toBe(10);
      expect(source.available).toBe(10);
      expect(source.inboundPending).toBe(4);
      // `+ inbound_pending` 항은 여기서만 검증된다 — 도착 창고 쪽은 0 이라 그 항이 있으나 없으나 통과한다.
      expect(source.projected).toBe(14);
      expect(source.transferPending).toBe(0);
      expectProjectedDerivesFromAvailable(source);
      expectNonOnHandSeeded(source); // DEFECTIVE/IN_TRANSFER 가 있어도 위 값들은 그대로다

      // 도착 창고: 재고 0 / 미도착 이동 3. 미도착 이동은 가용에서도 전망에서도 빼지 않는다.
      const destModule = await readWarehouseAvailability(trx, fx.skuId, destWarehouse.id);
      const dest = await readViewRow(trx, fx.skuId, destWarehouse.id);

      expect(dest.transferPending).toBe(TRANSIT_QTY); // 심은 행이 실제로 뷰에 보인다
      expect(destModule.available).toBe(0);
      expect(dest.available).toBe(0);
      expect(dest.inboundPending).toBe(0);
      expect(dest.projected).toBe(0);
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
      await seedNonOnHandLedgers(trx, fx);

      const fromModule = await readWarehouseAvailability(trx, fx.skuId, fx.warehouseId);
      const fromView = await readViewRow(trx, fx.skuId, fx.warehouseId);

      expect(fromView.available).toBe(fromModule.available);
      expect(fromView.available).toBe(7);
      expect(fromView.projected).toBe(7);
      expectProjectedDerivesFromAvailable(fromView);
      expectNonOnHandSeeded(fromView);
    });
  });
});
