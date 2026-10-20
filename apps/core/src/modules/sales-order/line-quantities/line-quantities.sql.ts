import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { type CancellationShipmentPhase, wmsTables } from '../../inventory/schema/inventory.schema';

/**
 * 판매 라인 수량의 단 하나의 정의 (K6 PR2a).
 * 라인별 취소 수량은 취소 라인 행(`sales_order_cancellation_lines`)에서만 읽는다 — 취소 행 metadata 를 다시 파싱하지 않는다.
 * TS 문(`readLineQuantities`)도 SQL 소비자도 이 조각을 select 한다. 같은 뺄셈을 TS 에서 다시 하지 않는다.
 * postgres `sum(integer)` 는 bigint 라 postgres.js 가 문자열로 주므로 모두 `::int` 로 캐스트한다.
 */

/**
 * 라인의 취소 수량 — `phase` 갈래만, `'any'` 면 갈래 무관 합. 취소가 없으면 0.
 *
 * 취소 라인 테이블을 칼럼 이름을 바꾼 파생 테이블(`k6_cl`)로 감싸 읽는다. drizzle 은 조인 없는 select 에서
 * 칼럼을 테이블 이름 없이(`"id"`) 그리므로, 바깥 쿼리의 `sales_order_lines.id` 가 서브쿼리 안에서
 * 취소 라인 자신의 `id` 로 묶여 조용히 0 이 나온다(이 파일을 처음 쓸 때 일치 spec 이 잡았다).
 * 파생 테이블에는 바깥 칼럼과 겹치는 이름(`id`·`quantity`·`sales_order_id` …)이 없어 바깥 참조가 바깥으로 풀린다.
 */
export function lineCanceledQuantitySql(
  salesOrderLineId: SQLWrapper,
  phase: CancellationShipmentPhase | 'any',
): SQL<number> {
  const cl = wmsTables.salesOrderCancellationLines;
  const phaseFilter = phase === 'any' ? sql`` : sql` and k6_cl.k6_shipment_phase = ${phase}`;
  return sql<number>`coalesce((
    select sum(k6_cl.k6_quantity)
    from (
      select ${cl.salesOrderLineId} as k6_line_id, ${cl.quantity} as k6_quantity, ${cl.shipmentPhase} as k6_shipment_phase
      from ${cl}
    ) as k6_cl
    where k6_cl.k6_line_id = ${salesOrderLineId}${phaseFilter}
  ), 0)::int`;
}

/** 라인의 수요 = 주문 수량 − 출고 전 취소. 이미 나간 수량의 취소는 물건이 창고를 떠났으므로 빼지 않는다(E2). */
export function lineDemandSql(lineQuantity: SQLWrapper, salesOrderLineId: SQLWrapper): SQL<number> {
  return sql<number>`(${lineQuantity} - ${lineCanceledQuantitySql(salesOrderLineId, 'before_shipment')})::int`;
}

/**
 * 라인의 남은 수량 = 주문 수량 − 갈래 무관 취소. 더 취소할 수 있는 판매 단위의 상한.
 * GREATEST 로 덮지 않는다 — 음수면 불변식(취소 ≤ 주문) 위반이 그대로 보여야 한다.
 */
export function lineRemainingSql(lineQuantity: SQLWrapper, salesOrderLineId: SQLWrapper): SQL<number> {
  return sql<number>`(${lineQuantity} - ${lineCanceledQuantitySql(salesOrderLineId, 'any')})::int`;
}
