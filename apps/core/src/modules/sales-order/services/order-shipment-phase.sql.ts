import { SQL, sql } from 'drizzle-orm';

/** 주문의 출고 단계 — 일별 통계와 주문 목록·상세의 뱃지가 같이 쓴다 */
export type OrderShipmentPhase = 'pending' | 'preparing' | 'shipping' | 'delivered' | 'external_shipped' | 'cancelled';

/**
 * 주문(sales order) 하나의 «출고 단계» 정의 한 벌 — 일별 통계(`getDailyStatusStats`)와 주문 목록·상세 뱃지가
 * 같은 SQL 을 읽는다. 두 곳이 따로 세면 통계 숫자와 뱃지가 어긋난다(#1016 15번).
 *
 * `scope` 는 판매주문 id 한 열을 돌려주는 SELECT. 결과는 주문당 한 행 `(sales_order_id, phase)` 이고,
 * 위에서부터 먼저 맞는 규칙이 이긴다:
 *   1. status 가 cancelled·timeout            → cancelled
 *   2. status 가 pending                       → pending
 *   3. status 가 shipped·delivered             → external_shipped
 *      (producer 는 셀메이트 스크립트뿐이라 «core 밖에서 나갔다» 뜻이다. core 출고의 진실은 상자다 — ADR-0017.
 *       셀메이트 shipped 인데 core 상자도 남아 있으면 외부 출고가 이긴다 — 같은 주문을 두 번 세지 않으려는 순서다)
 *   4. 그 밖: 상자(canceled·superseded 제외) + 직배(direct_ship_status) 단위로 접는다
 *      전부 delivered → delivered, 하나라도 움직임(shipped·in_transit·failed·delivered) → shipping, 그 밖 → preparing
 */
export function orderShipmentPhaseSql(scope: SQL): SQL {
  return sql`
    WITH so AS (
      SELECT s.id, s.status::text AS status
        FROM sales_orders s
       WHERE s.id IN (${scope})
    ),
    units AS (
      SELECT DISTINCT fo.sales_order_id, s.id AS unit_id, s.status::text AS st
        FROM shipments s
        JOIN shipment_lines sl ON sl.shipment_id = s.id
        JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
        JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
        JOIN so ON so.id = fo.sales_order_id
       WHERE s.status NOT IN ('canceled', 'superseded')
      UNION ALL
      SELECT fo.sales_order_id, fo.id,
             CASE fo.direct_ship_status WHEN 'completed' THEN 'delivered' WHEN 'forwarded' THEN 'shipped' ELSE 'draft' END
        FROM fulfillment_orders fo
        JOIN so ON so.id = fo.sales_order_id
       WHERE fo.fulfillment_mode = 'drop_ship'
         AND fo.direct_ship_status IS NOT NULL
         AND fo.direct_ship_status <> 'canceled'
    ),
    unit_phase AS (
      SELECT sales_order_id,
             bool_and(st = 'delivered') AS all_delivered,
             bool_or(st IN ('shipped', 'in_transit', 'failed', 'delivered')) AS any_moved
        FROM units
       GROUP BY sales_order_id
    )
    SELECT so.id AS sales_order_id,
           CASE
             WHEN so.status IN ('cancelled', 'timeout') THEN 'cancelled'
             WHEN so.status = 'pending' THEN 'pending'
             WHEN so.status IN ('shipped', 'delivered') THEN 'external_shipped'
             WHEN coalesce(p.all_delivered, false) THEN 'delivered'
             WHEN coalesce(p.any_moved, false) THEN 'shipping'
             ELSE 'preparing'
           END AS phase
      FROM so
      LEFT JOIN unit_phase p ON p.sales_order_id = so.id
  `;
}
