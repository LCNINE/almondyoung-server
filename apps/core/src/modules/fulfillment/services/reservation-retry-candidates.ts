import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { DbTx, wmsSchema } from '../../inventory/schema/inventory.schema';
import { reservationQueueOrderSql } from './reservation-queue-key';

/** 예약 재시도 후보 — 미예약 수량이 남은 draft 줄과 그 줄의 상품·수량 */
export interface ReservationRetryCandidate {
  id: string;
  skuId: string;
  qty: number;
}

/**
 * 후보: 미예약 수량이 남은 active draft shipment line 중 SKU 에 가용재고가 있는 것.
 * 우선할당한 출고주문부터, 그 안에서는 원 요청 시각(requested_at, short-pick 해제 이력 포함) asc — 오래된 요청부터.
 * 예약 이력이 없는 분할 라인은 원래 라인에서 물려받은 순번(demand_requested_at)을 쓴다.
 * `filter` 가 있으면 그 창고·상품의 줄만 고른다(입고 직후 재시도). 잠금 없는 SELECT 다.
 */
export async function findReservationRetryCandidates(
  db: DbTx | DbService<typeof wmsSchema>['db'],
  limit: number,
  filter?: { warehouseId: string; skuIds: readonly string[] },
): Promise<ReservationRetryCandidate[]> {
  if (filter && filter.skuIds.length === 0) return [];
  const narrowed = filter
    ? sql`AND shipment.warehouse_id = ${filter.warehouseId}
          AND sl.sku_id IN (${sql.join(
            filter.skuIds.map((skuId) => sql`${skuId}`),
            sql`, `,
          )})`
    : sql``;
  const rows = await db.execute<{ id: string; sku_id: string; qty: number }>(sql`
    SELECT sl.id, sl.sku_id, sl.qty
      FROM shipment_lines sl
      JOIN shipments shipment ON shipment.id = sl.shipment_id
      JOIN fulfillment_order_items item ON item.id = sl.fulfillment_order_item_id
      JOIN fulfillment_orders fo ON fo.id = item.fulfillment_order_id
      JOIN stock_summary_view summary
        ON summary.sku_id = sl.sku_id
       AND summary.warehouse_id = shipment.warehouse_id
     WHERE shipment.status = 'draft'
       AND summary.available_qty > 0
       AND sl.qty > COALESCE((
         SELECT SUM(reservation.quantity)
           FROM stock_reservations reservation
          WHERE reservation.target_type = 'SHIPMENT_LINE'
            AND reservation.shipment_line_id = sl.id
            AND reservation.status = 'confirmed'
       ), 0)
       ${narrowed}
     ORDER BY ${reservationQueueOrderSql(sql`sl`, sql`fo`)}, sl.id
     LIMIT ${limit}
  `);
  // execute 는 postgres.js RowList 를 돌려준다 — 행 모양은 위 SELECT 가 정한다
  return (rows as unknown as Array<{ id: string; sku_id: string; qty: number | string }>).map((row) => ({
    id: row.id,
    skuId: row.sku_id,
    qty: Number(row.qty),
  }));
}
