import { SQL, sql } from 'drizzle-orm';

/**
 * 상자별 «라인 수량 합 vs 확정 예약 합» — «덜 예약된 상자»의 유일한 정의다(#1016 15번).
 * 정체 보드의 판정(order-progress.judge-sql)과 재고 부족 읽기가 같이 쓴다. 두 곳이 따로 세면 보드의
 * «예약» 단계에 있는 상자와 «나눠 보내기» 대상이 어긋난다.
 *
 * 상자 하나가 한 행이다: shipment_id, line_qty(shipment_lines.qty 합), reserved_qty(그 라인들에 걸린
 * target_type='SHIPMENT_LINE' · status='confirmed' 인 stock_reservations.quantity 합).
 * 상자 «전체»로 잰다 — 합포장 상자는 어느 주문의 라인이든 모두 센다. 덜 예약 = line_qty > reserved_qty.
 *
 * 상자마다 LATERAL 로 그 상자의 라인만 읽고(idx_shipment_lines_shipment), 라인마다 예약을 LATERAL 로 합친다
 * (예약 행을 라인에 그대로 조인해 line_qty 를 곱하지 않는다 · idx_stock_reservations_shipment_line).
 *
 * scopeShipmentIds 는 상자 id 한 열을 돌려주는 SELECT. 이 목록이 «구동 테이블»이다 — 집계 «뒤에»
 * WHERE shipment_id IN (…) 로 거르면 Postgres 가 반 조인을 집계 아래로 내리지 못해 전 상자를 집계하고
 * 라인마다 예약을 찾는다(40만 라인에서 ~3초). 안 주면 전 상자(범위 없는 호출용).
 * 범위가 있는 호출은 반드시 이 인자로 넘길 것.
 */
export function shipmentReservationTotalsSql(scopeShipmentIds?: SQL): SQL {
  const drive = scopeShipmentIds
    ? sql`SELECT DISTINCT x.shipment_id FROM (${scopeShipmentIds}) x(shipment_id)`
    : sql`SELECT id AS shipment_id FROM shipments`;
  return sql`
    SELECT sc.shipment_id, t.line_qty, t.reserved_qty
      FROM (${drive}) sc
      CROSS JOIN LATERAL (
        SELECT coalesce(sum(sl.qty), 0)::int AS line_qty,
               coalesce(sum(res.quantity), 0)::int AS reserved_qty
          FROM shipment_lines sl
          LEFT JOIN LATERAL (
            SELECT sum(r.quantity) AS quantity
              FROM stock_reservations r
             WHERE r.shipment_line_id = sl.id AND r.target_type = 'SHIPMENT_LINE' AND r.status = 'confirmed'
          ) res ON true
         WHERE sl.shipment_id = sc.shipment_id
      ) t
  `;
}
