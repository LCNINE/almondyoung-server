import { sql, type SQL } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { claimTotalsByParcelSql } from './claim-quantities.sql';
import { deliveredParcelsSql, lineSkuQuantitiesSql } from './line-quantities.sql';

/**
 * 소포 단위 청구 자격 (K6 PR3a, 스펙 §6.1 «청구 자격은 소포 단위로도 낸다»). 반품·교환 생성이 «어느 소포의 무엇»을 고른다.
 * 행 = (sales_order_id, sales_order_line_id, sku_id, shipment_id, shipment_line_id, dispatch_attempt_id — uuid,
 *       delivered_at timestamptz, delivered_qty, claimed_qty, sku_claimable, claimable — int).
 * `salesOrderScope` 는 판매주문 id 한 열을 내는 SELECT.
 *
 * 행 = 범위 주문의 배송완료 소포(`deliveredParcelsSql` — 출고 시도 × 상자 라인). 판매 라인은 상자 라인의 FOI 로 잇는다 —
 * FOI 가 같은 주문의 판매 라인을 가리킬 때만(G-e: 라인과 안 이어진 FOI 의 소포는 안 보인다). SKU 는 FOI 의 것.
 *   delivered_qty = 그 소포가 그 상자 라인에서 낸 수량
 *   claimed_qty   = 그 소포를 적은 청구 항목 합(`claimTotalsByParcelSql` — SKU 합과 같은 항목 집합, R4). 없으면 0
 *   sku_claimable = 그 (라인, SKU) 의 `claimable`(`lineSkuQuantitiesSql`) — 출고 뒤 취소·다른 소포의 청구까지 뺀 SKU 몫
 *   claimable     = least(delivered_qty − claimed_qty, sku_claimable). 소포에 남았어도 SKU 몫이 없으면 청구할 수 없다.
 *                   GREATEST 로 덮지 않는다 — 음수는 SKU 층과 같은 뜻으로 그대로 보인다(표시는 소비자가 클램프한다).
 * SKU 층 행은 같은 FOI 갈래 키로 언제나 있으므로 inner join 이다 — 없으면 행이 사라져 어긋남이 보인다.
 *
 * 모든 테이블에 별칭을 붙이고 칼럼을 별칭으로 한정한다(2a 교훈). FOI 의 `sales_order_line_id` 는 varchar 라 `::text` 로 잇는다.
 */
export function parcelClaimEligibilitySql(salesOrderScope: SQL): SQL {
  const t = wmsTables;
  return sql`
    select parcel_line.sales_order_id,
           parcel_line.id as sales_order_line_id,
           parcel_foi.sku_id,
           parcel.shipment_id,
           parcel.shipment_line_id,
           parcel.dispatch_attempt_id,
           parcel.delivered_at,
           parcel.qty as delivered_qty,
           coalesce(parcel_claim.claimed, 0)::int as claimed_qty,
           parcel_sku.claimable as sku_claimable,
           least(parcel.qty - coalesce(parcel_claim.claimed, 0), parcel_sku.claimable)::int as claimable
      from (${deliveredParcelsSql(salesOrderScope)}) as parcel
      join ${t.fulfillmentOrderItems} as parcel_foi on parcel_foi.id = parcel.fulfillment_order_item_id
      join ${t.fulfillmentOrders} as parcel_fo on parcel_fo.id = parcel_foi.fulfillment_order_id
      join ${t.salesOrderLines} as parcel_line
        on parcel_foi.sales_order_line_id = parcel_line.id::text
       and parcel_line.sales_order_id = parcel_fo.sales_order_id
      join (${lineSkuQuantitiesSql(salesOrderScope)}) as parcel_sku
        on parcel_sku.sales_order_line_id = parcel_line.id
       and parcel_sku.sku_id = parcel_foi.sku_id
      left join (${claimTotalsByParcelSql(salesOrderScope)}) as parcel_claim
        on parcel_claim.dispatch_attempt_id = parcel.dispatch_attempt_id
       and parcel_claim.shipment_line_id = parcel.shipment_line_id
  `;
}
