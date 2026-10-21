import { sql, type SQL } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { lineSkuQuantitiesSql } from './line-quantities.sql';

/** 주문의 출고 단계(관리자) — 주문 목록·상세 뱃지와 일별 통계가 같이 쓴다 */
export type OrderShipmentPhase = 'pending' | 'preparing' | 'shipping' | 'delivered' | 'external_shipped' | 'cancelled';

/**
 * 주문 하나의 진행 단계 사다리 한 벌 (K6 PR2b). 관리자 뱃지·일별 통계·고객 actions 가 모두 이 SQL 을 읽는다 —
 * 화면마다 따로 세면 통계 숫자와 뱃지와 고객 화면이 어긋난다(#1016 15번, 감사 «어디까지 왔나» 3벌).
 * 일별 통계는 기간 상한이 없는 집계라 SQL 이어야 하고, TS 판을 하나 더 두면 일치 spec 을 영구히 들고 가야 해서
 * 사다리는 여기에만 쓴다. 두 화면 값은 사다리 결과 위의 CASE 다.
 *
 * 행 = (sales_order_id, admin_phase OrderShipmentPhase, store_phase StoreFulfillmentStatus, any_shipped boolean).
 * `salesOrderScope` 는 판매주문 id 한 열을 내는 SELECT. 행은 판매주문에서 시작해 몫마다 LEFT JOIN 하므로
 * 범위에 든(존재하는) 주문마다 정확히 한 행이다 — FO·인쇄 행이 없는 주문도 0 으로 접혀 나온다.
 *
 * 주문별로 접는 사실:
 *   창고 몫 — `lineSkuQuantitiesSql` 의 합(required·shipped·forwarded·delivered·partner_completed·outstanding).
 *            «움직임»·«배송완료»를 상자 status 가 아니라 수량으로 본다(P5) — 회수된 소포는 shipped_qty 가 되돌아가 빠진다.
 *   인쇄 몫 — 활성(`cancelled` 아닌) `print_orders` 의 수·`shipped`/`delivered` 수·`delivered` 수. 인쇄 라인은 FOI 가 없어
 *            SKU 층에 없으므로 여기서 직접 접는다(R5).
 *   FO 취소 — FO 가 있고 `canceled` 인가.
 *
 * 사다리(위에서 먼저 맞는 것이 이긴다):
 *   1. SO cancelled·timeout                                   → cancelled
 *   2. SO pending                                             → pending
 *   3. SO shipped·delivered                                   → external_shipped
 *      (producer 는 셀메이트 스크립트뿐이라 «core 밖에서 나갔다» 뜻이다. core 상자가 남아 있어도 이게 이긴다 —
 *       같은 주문을 두 번 세지 않으려는 순서다)
 *   4. FO 가 canceled, 활성 인쇄 0                             → cancelled
 *   5. (FO 없음 또는 required 합 0), 활성 인쇄 0               → not_created
 *   6. 있는 몫이 전부 끝남 — 창고 몫(required>0)은 outstanding 0 이고 delivered+partner_completed ≥ required,
 *      인쇄 몫은 전부 delivered. 없는 몫은 조건에서 빠진다(5 가 «둘 다 없음»을 이미 걸렀다) → delivered
 *   7. 창고 shipped+forwarded > 0, 또는 인쇄 shipped/delivered 하나 이상 → shipping
 *   8. 그 밖                                                  → preparing
 * 직배 `forwarded` 는 출고가 아니지만 화면은 «배송 중», 직배 `completed` 는 배송완료 수량이 0(모름)이지만 화면은 «배송 완료»다
 * (스펙 §6.4 — 단계는 표시용 투영이라 일부러 다르게 읽는다).
 *
 * 매핑: admin_phase 는 not_created → preparing. store_phase 는 pending → not_created, external_shipped → shipping,
 *       cancelled → canceled.
 * any_shipped 는 사다리와 독립인 사실이다 — SO shipped·delivered, 창고 shipped+forwarded > 0, 인쇄 shipped/delivered 하나 이상.
 * SO 가 취소여도 나간 것은 나간 것이라 SO 상태로 덮지 않는다(셀프취소 차단이 읽는다).
 *
 * 모든 테이블에 별칭을 붙이고 칼럼을 별칭으로 한정한다 — 바깥 쿼리(일별 통계의 CTE 등) 모양과 무관하게 같은 뜻으로 풀리게.
 */
export function orderFulfillmentPhaseSql(salesOrderScope: SQL): SQL {
  const t = wmsTables;
  return sql`
    select ladder.sales_order_id,
           case ladder.phase when 'not_created' then 'preparing' else ladder.phase end as admin_phase,
           case ladder.phase
             when 'pending' then 'not_created'
             when 'external_shipped' then 'shipping'
             when 'cancelled' then 'canceled'
             else ladder.phase
           end as store_phase,
           ladder.any_shipped
      from (
        select order_fact.sales_order_id,
               case
                 when order_fact.so_status in ('cancelled', 'timeout') then 'cancelled'
                 when order_fact.so_status = 'pending' then 'pending'
                 when order_fact.so_status in ('shipped', 'delivered') then 'external_shipped'
                 when order_fact.fo_canceled and order_fact.print_active = 0 then 'cancelled'
                 when order_fact.required = 0 and order_fact.print_active = 0 then 'not_created'
                 when (order_fact.required = 0
                       or (order_fact.outstanding = 0
                           and order_fact.delivered + order_fact.partner_completed >= order_fact.required))
                  and order_fact.print_delivered = order_fact.print_active then 'delivered'
                 when order_fact.shipped + order_fact.forwarded > 0 or order_fact.print_moved > 0 then 'shipping'
                 else 'preparing'
               end as phase,
               (order_fact.so_status in ('shipped', 'delivered')
                 or order_fact.shipped + order_fact.forwarded > 0
                 or order_fact.print_moved > 0) as any_shipped
          from (
            select phase_so.id as sales_order_id,
                   phase_so.status::text as so_status,
                   coalesce(fo_share.canceled, false) as fo_canceled,
                   coalesce(warehouse_share.required, 0)::int as required,
                   coalesce(warehouse_share.shipped, 0)::int as shipped,
                   coalesce(warehouse_share.forwarded, 0)::int as forwarded,
                   coalesce(warehouse_share.delivered, 0)::int as delivered,
                   coalesce(warehouse_share.partner_completed, 0)::int as partner_completed,
                   coalesce(warehouse_share.outstanding, 0)::int as outstanding,
                   coalesce(print_share.active, 0)::int as print_active,
                   coalesce(print_share.moved, 0)::int as print_moved,
                   coalesce(print_share.delivered, 0)::int as print_delivered
              from ${t.salesOrders} as phase_so
              left join (
                -- FO 는 SO 당 0..1 이지만 묶어서 접는다 — 주문당 한 행이 조인 모양에 기대지 않게
                select phase_fo.sales_order_id, bool_and(phase_fo.status = 'canceled') as canceled
                  from ${t.fulfillmentOrders} as phase_fo
                 where phase_fo.sales_order_id in (${salesOrderScope})
                 group by phase_fo.sales_order_id
              ) as fo_share on fo_share.sales_order_id = phase_so.id
              left join (
                select line_sku.sales_order_id,
                       sum(line_sku.required)::int as required,
                       sum(line_sku.shipped)::int as shipped,
                       sum(line_sku.forwarded)::int as forwarded,
                       sum(line_sku.delivered)::int as delivered,
                       sum(line_sku.partner_completed)::int as partner_completed,
                       sum(line_sku.outstanding)::int as outstanding
                  from (${lineSkuQuantitiesSql(salesOrderScope)}) as line_sku
                 group by line_sku.sales_order_id
              ) as warehouse_share on warehouse_share.sales_order_id = phase_so.id
              left join (
                select print_row.sales_order_id,
                       count(*)::int as active,
                       count(*) filter (where print_row.status in ('shipped', 'delivered'))::int as moved,
                       count(*) filter (where print_row.status = 'delivered')::int as delivered
                  from ${t.printOrders} as print_row
                 where print_row.sales_order_id in (${salesOrderScope})
                   and print_row.status <> 'cancelled'
                 group by print_row.sales_order_id
              ) as print_share on print_share.sales_order_id = phase_so.id
             where phase_so.id in (${salesOrderScope})
          ) as order_fact
      ) as ladder
  `;
}
