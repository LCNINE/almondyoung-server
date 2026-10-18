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
 * 라인마다 예약을 LATERAL 로 합친다(예약 행을 라인에 그대로 조인해 line_qty 를 곱하지 않는다) —
 * 호출하는 쪽이 shipment_id 로 거르면 shipment_lines 만 좁혀지고 예약은 idx_stock_reservations_shipment_line 으로 찾는다.
 */
export function shipmentReservationTotalsSql(): SQL {
  return sql`
    SELECT sl.shipment_id,
           sum(sl.qty)::int AS line_qty,
           coalesce(sum(res.quantity), 0)::int AS reserved_qty
      FROM shipment_lines sl
      LEFT JOIN LATERAL (
        SELECT sum(r.quantity) AS quantity
          FROM stock_reservations r
         WHERE r.shipment_line_id = sl.id AND r.target_type = 'SHIPMENT_LINE' AND r.status = 'confirmed'
      ) res ON true
     GROUP BY sl.shipment_id
  `;
}
