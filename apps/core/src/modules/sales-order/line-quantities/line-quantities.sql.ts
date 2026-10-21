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
 * 취소 라인 테이블을 칼럼 이름을 바꾼 파생 테이블(`cancellation_line`)로 감싸 읽는다. drizzle 은 조인 없는 select 에서
 * 칼럼을 테이블 이름 없이(`"id"`) 그리므로, 바깥 쿼리의 `sales_order_lines.id` 가 서브쿼리 안에서
 * 취소 라인 자신의 `id` 로 묶여 조용히 0 이 나온다(이 파일을 처음 쓸 때 일치 spec 이 잡았다).
 * 파생 테이블에는 바깥 칼럼과 겹치는 이름(`id`·`quantity`·`sales_order_id` …)이 없어 바깥 참조가 바깥으로 풀린다.
 */
export function lineCanceledQuantitySql(
  salesOrderLineId: SQLWrapper,
  phase: CancellationShipmentPhase | 'any',
): SQL<number> {
  const cl = wmsTables.salesOrderCancellationLines;
  const phaseFilter = phase === 'any' ? sql`` : sql` and cancellation_line.canceled_phase = ${phase}`;
  return sql<number>`coalesce((
    select sum(cancellation_line.canceled_quantity)
    from (
      select ${cl.salesOrderLineId} as canceled_line_id, ${cl.quantity} as canceled_quantity, ${cl.shipmentPhase} as canceled_phase
      from ${cl}
    ) as cancellation_line
    where cancellation_line.canceled_line_id = ${salesOrderLineId}${phaseFilter}
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

/**
 * 판매 라인 × SKU(구성품) 층의 출고·배송 사실 (K6 PR2b). 행 = (sales_order_id uuid, sales_order_line_id uuid, sku_id uuid,
 * qty_per_unit int|null, required, shipped, forwarded, delivered, partner_completed, outstanding — 전부 int).
 * `salesOrderScope` 는 판매주문 id 한 열을 내는 SELECT.
 *
 * 키 = 범위 주문의 (판매 라인, SKU) 중 FOI 가 있거나 굳은 구성(`sales_order_line_compositions`)에 있는 것.
 * 구성 갈래는 FO 가 있는 주문만 본다 — 운영자는 FO 전에도 구성을 지정한다(`assignByOperator`, #1063 스펙 D1).
 * FO 전엔 SKU 층이 비어야(스펙 §6.1) 소비자가 «빈 skus» 로 FO 전 갈래를 고른다. 0 으로 채운 행이 나오면 그 갈래를 놓친다.
 * 구성에서 빠진 SKU 의 FOI 는 `qty_per_unit` 이 null 로 남는다 — 판매 단위 환산이 그걸 보고 거절한다.
 * 구성에만 있고 FOI 가 없는 SKU 는 0 으로 나온다(빠지면 환산이 그 구성품을 못 본다).
 * FOI 갈래의 `key_line.sales_order_id = key_fo.sales_order_id` 는 `::text` 조인이 pkey 를 못 타서
 * `sales_order_lines` 전체를 훑지 않게 주문 인덱스로 좁히는 조건이다(여러 주문 범위로 다시 쓰인다).
 *
 * FOI 단위로 정한 뒤 (라인, SKU) 로 합한다:
 *   required          = qty − canceled_qty
 *   shipped           = shipped_qty (셀메이트 스크립트·직배 완료·V2 발송이 모두 여기를 채운다)
 *   outstanding       = qty − shipped_qty − canceled_qty
 *   forwarded         = 직배 FO 가 `forwarded` 면 outstanding — 파트너에게 넘겼을 뿐 출고가 아니다(넘긴 뒤에도 취소된다)
 *   partner_completed = 직배 FO 가 `completed` 면 shipped_qty — 배송완료가 아니다(표시용, 파트너는 배송 추적을 안 준다)
 *   delivered         = 그 FOI 의 상자 라인에서 `dispatched` 인 출고 시도의 소스 수량 중 그 시도에 `delivered` 추적이 있는 것.
 *                       회수된 시도(`recalled`)는 추적 행이 남아 있어도 세지 않는다 — 회수가 shipped_qty 도 되돌렸다
 * FO 상태로 거르지 않는다 — FO 취소는 진행 단계 사다리가 따로 본다.
 * 인쇄 외주 라인은 FOI 가 없어 이 층에 없다(진행 단계 사다리가 `print_orders` 를 접는다).
 *
 * 모든 테이블에 별칭을 붙이고 칼럼을 별칭으로 한정한다 — 바깥 쿼리 모양과 무관하게 같은 뜻으로 풀리게(2a 교훈).
 * FOI 의 `sales_order_line_id` 는 varchar 라 판매 라인과는 `sol.id::text` 로 잇는다.
 */
export function lineSkuQuantitiesSql(salesOrderScope: SQL): SQL {
  const t = wmsTables;
  return sql`
    select sku_key.sales_order_id,
           sku_key.sales_order_line_id,
           sku_key.sku_id,
           composition.qty_per_unit,
           coalesce(item_fact.required, 0)::int as required,
           coalesce(item_fact.shipped, 0)::int as shipped,
           coalesce(item_fact.forwarded, 0)::int as forwarded,
           coalesce(item_fact.delivered, 0)::int as delivered,
           coalesce(item_fact.partner_completed, 0)::int as partner_completed,
           coalesce(item_fact.outstanding, 0)::int as outstanding
      from (
        select key_line.sales_order_id, key_line.id as sales_order_line_id, key_item.sku_id
          from ${t.fulfillmentOrders} as key_fo
          join ${t.fulfillmentOrderItems} as key_item on key_item.fulfillment_order_id = key_fo.id
          join ${t.salesOrderLines} as key_line
            on key_item.sales_order_line_id = key_line.id::text
           and key_line.sales_order_id = key_fo.sales_order_id
         where key_fo.sales_order_id in (${salesOrderScope})
        union
        select key_line.sales_order_id, key_line.id as sales_order_line_id, key_composition.sku_id
          from ${t.salesOrderLines} as key_line
          join ${t.salesOrderLineCompositions} as key_composition on key_composition.sales_order_line_id = key_line.id
         where key_line.sales_order_id in (${salesOrderScope})
           and exists (
             select 1
               from ${t.fulfillmentOrders} as key_composition_fo
              where key_composition_fo.sales_order_id = key_line.sales_order_id
           )
      ) as sku_key
      left join ${t.salesOrderLineCompositions} as composition
        on composition.sales_order_line_id = sku_key.sales_order_line_id
       and composition.sku_id = sku_key.sku_id
      left join (
        select foi.sales_order_line_id,
               foi.sku_id,
               sum(foi.qty - foi.canceled_qty)::int as required,
               sum(foi.shipped_qty)::int as shipped,
               sum(foi.qty - foi.shipped_qty - foi.canceled_qty)::int as outstanding,
               sum(case when fo.fulfillment_mode = 'drop_ship' and fo.direct_ship_status = 'forwarded'
                        then foi.qty - foi.shipped_qty - foi.canceled_qty else 0 end)::int as forwarded,
               sum(case when fo.fulfillment_mode = 'drop_ship' and fo.direct_ship_status = 'completed'
                        then foi.shipped_qty else 0 end)::int as partner_completed,
               sum(coalesce(item_delivered.qty, 0))::int as delivered
          from ${t.fulfillmentOrders} as fo
          join ${t.fulfillmentOrderItems} as foi on foi.fulfillment_order_id = fo.id
          left join (
            -- 배송완료 수량은 범위의 FOI 전부를 한 번에 묶어 센 뒤 FOI id 로 되붙인다 — FOI 마다 상관 서브쿼리로 세면
            -- shipment_lines(fulfillment_order_item_id) 인덱스가 없어 FOI 수 × 출고 시도 소스 수로 자란다(R15)
            select delivered_sl.fulfillment_order_item_id, sum(delivered_das.qty)::int as qty
              from ${t.fulfillmentOrders} as delivered_fo
              join ${t.fulfillmentOrderItems} as delivered_foi on delivered_foi.fulfillment_order_id = delivered_fo.id
              join ${t.shipmentLines} as delivered_sl on delivered_sl.fulfillment_order_item_id = delivered_foi.id
              join ${t.dispatchAttemptSources} as delivered_das on delivered_das.shipment_line_id = delivered_sl.id
              join ${t.dispatchAttempts} as delivered_da on delivered_da.id = delivered_das.dispatch_attempt_id
             where delivered_fo.sales_order_id in (${salesOrderScope})
               and delivered_da.status = 'dispatched'
               and exists (
                 select 1
                   from ${t.shipmentTracking} as delivered_st
                  where delivered_st.dispatch_attempt_id = delivered_da.id
                    and delivered_st.status = 'delivered'
               )
             group by delivered_sl.fulfillment_order_item_id
          ) as item_delivered on item_delivered.fulfillment_order_item_id = foi.id
         where fo.sales_order_id in (${salesOrderScope})
         group by foi.sales_order_line_id, foi.sku_id
      ) as item_fact
        on item_fact.sales_order_line_id = sku_key.sales_order_line_id::text
       and item_fact.sku_id = sku_key.sku_id
  `;
}
