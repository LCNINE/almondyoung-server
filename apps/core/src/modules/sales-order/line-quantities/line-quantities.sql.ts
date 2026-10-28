import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { type CancellationShipmentPhase, wmsTables } from '../../inventory/schema/inventory.schema';
import { claimTotalsBySkuSql, heldCustomerReturnLinesSql } from './claim-quantities.sql';

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

/**
 * 라인의 반품이 잡은 판매 단위 = 취소되지 않은 반품 예정 기록 줄 수량의 합(K8 PR5). 없으면 0.
 * 취소 상한(`remaining − returnHeld`)에서만 뺀다 — `lineRemainingSql` 은 반품을 모른다(N6: Medusa 반품은 주문 줄 수량을
 * 줄이지 않아 채널 변경 대조가 `remaining` 을 Medusa 줄 수량과 비교한다).
 * 줄을 칼럼 이름을 바꾼 파생 테이블로 감싸 읽는다 — `lineCanceledQuantitySql` 의 바깥 참조 함정과 같다.
 */
export function lineReturnHeldSql(salesOrderLineId: SQLWrapper): SQL<number> {
  return sql<number>`coalesce((
    select sum(held_line.held_quantity)
    from (${heldCustomerReturnLinesSql()}) as held_line
    where held_line.held_line_id = ${salesOrderLineId}
  ), 0)::int`;
}

/** 라인의 수요 = 주문 수량 − 출고 전 취소. 이미 나간 수량의 취소는 물건이 창고를 떠났으므로 빼지 않는다(E2). */
export function lineDemandSql(lineQuantity: SQLWrapper, salesOrderLineId: SQLWrapper): SQL<number> {
  return sql<number>`(${lineQuantity} - ${lineCanceledQuantitySql(salesOrderLineId, 'before_shipment')})::int`;
}

/**
 * 라인의 남은 수량 = 주문 수량 − 갈래 무관 취소. 반품은 모른다(N6) — 취소 상한은 `remaining − returnHeld`(`cancelableOf`)다.
 * GREATEST 로 덮지 않는다 — 음수면 불변식(취소 ≤ 주문) 위반이 그대로 보여야 한다.
 */
export function lineRemainingSql(lineQuantity: SQLWrapper, salesOrderLineId: SQLWrapper): SQL<number> {
  return sql<number>`(${lineQuantity} - ${lineCanceledQuantitySql(salesOrderLineId, 'any')})::int`;
}

/**
 * 배송완료 소포의 단 하나의 정의 (K6 PR3a — 2b 의 SKU 층 배송완료 서브쿼리를 꺼냈다). 행 = (fulfillment_order_item_id,
 * shipment_id, shipment_line_id, dispatch_attempt_id — uuid, delivered_at timestamptz, qty int).
 * 행 = 범위 주문 FO 의 (출고 시도 × 상자 라인) 중 시도가 `dispatched` 이고 그 시도에 `delivered` 추적 행이 있는 것.
 * qty = 그 시도가 그 상자 라인에서 낸 소스 수량의 합(위치가 여럿이면 소스 행이 여럿이다).
 * delivered_at = 그 시도의 `delivered` 추적 timestamp 최댓값.
 * 회수된 시도(`recalled`)는 추적 행이 남아 있어도 세지 않는다 — 회수가 shipped_qty 도 되돌렸다.
 * SKU 층의 `delivered`(FOI 로 합한다)와 소포 자격(`parcelClaimEligibilitySql`)이 이것을 읽는다 — 배송완료를 두 벌로 쓰지 않게.
 * FOI → 상자 라인 조인은 `idx_shipment_lines_fulfillment_order_item`(K6 PR3a 가 더했다, R15)을 탄다.
 */
export function deliveredParcelsSql(salesOrderScope: SQL): SQL {
  const t = wmsTables;
  return sql`
    select delivered_sl.fulfillment_order_item_id,
           delivered_sl.shipment_id,
           delivered_sl.id as shipment_line_id,
           delivered_da.id as dispatch_attempt_id,
           delivered_track.delivered_at,
           sum(delivered_das.qty)::int as qty
      from ${t.fulfillmentOrders} as delivered_fo
      join ${t.fulfillmentOrderItems} as delivered_foi on delivered_foi.fulfillment_order_id = delivered_fo.id
      join ${t.shipmentLines} as delivered_sl on delivered_sl.fulfillment_order_item_id = delivered_foi.id
      join ${t.dispatchAttemptSources} as delivered_das on delivered_das.shipment_line_id = delivered_sl.id
      join ${t.dispatchAttempts} as delivered_da on delivered_da.id = delivered_das.dispatch_attempt_id
      join lateral (
        select max(delivered_st.timestamp) as delivered_at
          from ${t.shipmentTracking} as delivered_st
         where delivered_st.dispatch_attempt_id = delivered_da.id
           and delivered_st.status = 'delivered'
      ) as delivered_track on delivered_track.delivered_at is not null
     where delivered_fo.sales_order_id in (${salesOrderScope})
       and delivered_da.status = 'dispatched'
     group by delivered_sl.fulfillment_order_item_id, delivered_sl.shipment_id, delivered_sl.id, delivered_da.id,
              delivered_track.delivered_at
  `;
}

/**
 * 판매 라인 × SKU(구성품) 층의 출고·배송·청구 사실 (K6 PR2b, 청구는 PR3a). 행 = (sales_order_id uuid,
 * sales_order_line_id uuid, sku_id uuid, qty_per_unit int|null, required, shipped, forwarded, delivered, partner_completed,
 * outstanding, return_active, return_consumed, claimable — 전부 int).
 * `salesOrderScope` 는 판매주문 id 한 열을 내는 SELECT.
 *
 * 키 = 범위 주문의 (판매 라인, SKU) 중 FOI 가 있거나 굳은 구성(`sales_order_line_compositions`)에 있는 것.
 * 구성 갈래는 FO 가 있는 주문만 본다 — 운영자는 FO 전에도 구성을 지정한다(`assignByOperator`, #1063 스펙 D1).
 * FO 전엔 SKU 층이 비어야(스펙 §6.1) 소비자가 «빈 skus» 로 FO 전 갈래를 고른다. 0 으로 채운 행이 나오면 그 갈래를 놓친다.
 * 구성에서 빠진 SKU 의 FOI 는 `qty_per_unit` 이 null 로 남는다 — 판매 단위 환산이 그걸 보고 거절한다.
 * 구성에만 있고 FOI 가 없는 SKU 는 0 으로 나온다(빠지면 환산이 그 구성품을 못 본다).
 * FOI 갈래의 `key_line.sales_order_id = key_fo.sales_order_id` 는 `::text` 조인이 pkey 를 못 타서
 * `sales_order_lines` 전체를 훑지 않게 주문 인덱스로 좁히는 조건이다(여러 주문 범위로 다시 쓰인다).
 * 사실 갈래(`item_fact`)도 같은 조건으로 라인에 잇는다 — 범위의 다른 주문 FOI 가 그 라인을 가리켜도 그 라인 사실에 섞이지 않게.
 *
 * FOI 단위로 정한 뒤 (라인, SKU) 로 합한다:
 *   required          = qty − canceled_qty
 *   shipped           = shipped_qty (셀메이트 스크립트·입점사 발송·V2 발송이 모두 여기를 채운다)
 *   outstanding       = qty − shipped_qty − canceled_qty
 *   forwarded         = 그 FOI 의 넘긴 입점사 상자(draft·recovery_required, 넘김 묶음 있음) 라인 수량 합 — 입점사에게
 *                       넘겼을 뿐 출고가 아니다(넘긴 뒤에도 취소된다)
 *   partner_completed = 그 FOI 의 발송된 입점사 상자(shipped) 라인 수량 합 — 배송완료가 아니다(표시용, 입점사는 배송 추적을 안 준다)
 *   delivered         = 그 FOI 의 배송완료 소포 수량 합(`deliveredParcelsSql`)
 * 입점사 상자 단계(넘김·발송)의 정의는 `fulfillment/shipment/supplier-shipment-stage.ts` 하나다 — 여기 술어는 그것과 같아야 한다.
 * 옛 FO 단위 직배 판별(FO 모드·직배 상태 칸)은 K3 PR4 가 읽기를 끊고 PR 8 이 걷었다.
 *
 * 청구 사실(K6 PR3a) — `claimTotalsBySkuSql` 을 (라인, SKU) 로 붙인다. 없으면 0:
 *   (postgres 는 넓은 범위 소비자(진행 단계 SQL·관리자 카드)가 청구 칸을 안 고를 때만 청구 조인을 잘라낸다 — 넓은 범위에서
 *    청구 칸을 고르면 행마다 청구 집계 스캔과 취소 서브플랜 값을 치른다.)
 *   return_active     = 진행 중 반품 예정 수량(SKU 단위)
 *   return_consumed   = 정산 끝난 반품 수량 — 돌아온 물건
 *   claimable         = delivered − return_consumed − return_active
 *                       − 출고 뒤 취소(판매 단위) × qty_per_unit. 출고 뒤 취소로 돈을 돌려준 수량은 다시 청구할 수 없다(C9).
 *                       구성 밖 SKU(qty_per_unit null)는 0 — 출고 뒤 취소를 SKU 로 환산할 수 없다(N4).
 *                       GREATEST 로 덮지 않는다 — 회수가 배송완료를 되돌리면 음수가 그대로 보여야 한다.
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
           coalesce(item_fact.outstanding, 0)::int as outstanding,
           coalesce(claim.return_active, 0)::int as return_active,
           coalesce(claim.return_consumed, 0)::int as return_consumed,
           (case when composition.qty_per_unit is null then 0
                 else coalesce(item_fact.delivered, 0)
                      - coalesce(claim.return_consumed, 0)
                      - coalesce(claim.return_active, 0)
                      - ${lineCanceledQuantitySql(sql`sku_key.sales_order_line_id`, 'after_shipment')} * composition.qty_per_unit
            end)::int as claimable
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
               sum(coalesce(item_supplier.forwarded, 0))::int as forwarded,
               sum(coalesce(item_supplier.partner_completed, 0))::int as partner_completed,
               sum(coalesce(item_delivered.qty, 0))::int as delivered
          from ${t.fulfillmentOrders} as fo
          join ${t.fulfillmentOrderItems} as foi on foi.fulfillment_order_id = fo.id
          join ${t.salesOrderLines} as line
            on foi.sales_order_line_id = line.id::text
           and line.sales_order_id = fo.sales_order_id
          left join (
            -- 배송완료 수량은 범위의 FOI 전부를 한 번에 묶어 센 뒤 FOI id 로 되붙인다 — FOI 마다 상관 서브쿼리로 세면
            -- FOI 수만큼 배송완료 소포 조회를 다시 돈다(R15). FOI → 상자 라인 조인은 K6 PR3a 가 더한
            -- idx_shipment_lines_fulfillment_order_item 을 탄다
            select delivered_parcel.fulfillment_order_item_id, sum(delivered_parcel.qty)::int as qty
              from (${deliveredParcelsSql(salesOrderScope)}) as delivered_parcel
             group by delivered_parcel.fulfillment_order_item_id
          ) as item_delivered on item_delivered.fulfillment_order_item_id = foi.id
          left join (
            -- 입점사 상자 라인 수량도 배송완료와 같은 모양이다 — 범위 FOI 를 한 번에 묶어 센 뒤 FOI id 로 되붙인다(R15).
            -- FOI → 상자 라인은 idx_shipment_lines_fulfillment_order_item 을 탄다. 단계 술어는 supplier-shipment-stage.ts 와 같다:
            -- 넘김 = draft·recovery_required + 넘김 묶음, 발송 = shipped. 넘기지 않은 상자·canceled·superseded 는 0 이다
            select supplier_sl.fulfillment_order_item_id,
                   sum(case when supplier_s.status in ('draft', 'recovery_required')
                             and supplier_s.supplier_handoff_id is not null
                            then supplier_sl.qty else 0 end)::int as forwarded,
                   sum(case when supplier_s.status = 'shipped' then supplier_sl.qty else 0 end)::int as partner_completed
              from ${t.fulfillmentOrders} as supplier_fo
              join ${t.fulfillmentOrderItems} as supplier_foi on supplier_foi.fulfillment_order_id = supplier_fo.id
              join ${t.shipmentLines} as supplier_sl on supplier_sl.fulfillment_order_item_id = supplier_foi.id
              join ${t.shipments} as supplier_s on supplier_s.id = supplier_sl.shipment_id
             where supplier_fo.sales_order_id in (${salesOrderScope})
               and supplier_s.supplier_id is not null
             group by supplier_sl.fulfillment_order_item_id
          ) as item_supplier on item_supplier.fulfillment_order_item_id = foi.id
         where fo.sales_order_id in (${salesOrderScope})
         group by foi.sales_order_line_id, foi.sku_id
      ) as item_fact
        on item_fact.sales_order_line_id = sku_key.sales_order_line_id::text
       and item_fact.sku_id = sku_key.sku_id
      left join (${claimTotalsBySkuSql(salesOrderScope)}) as claim
        on claim.sales_order_line_id = sku_key.sales_order_line_id
       and claim.sku_id = sku_key.sku_id
  `;
}
