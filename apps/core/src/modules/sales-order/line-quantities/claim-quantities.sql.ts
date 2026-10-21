import { sql, type SQL } from 'drizzle-orm';
import { returnExchangeTables, wmsTables } from '../../inventory/schema/inventory.schema';
import { ACTIVE_EXCHANGE_STATUSES, ACTIVE_RETURN_STATUSES, CONSUMED_RETURN_STATUSES } from './claim-statuses';

/**
 * 청구(반품·교환) 수량의 단 하나의 정의 (K6 PR3a). 청구 항목 테이블을 읽는 커널 파일은 이것 하나다.
 * 상태 목록은 `claim-statuses.ts` 에서 파라미터로 넣는다 — SQL 에 상태 문자열을 다시 쓰지 않는다.
 * 모든 테이블에 별칭을 붙이고 칼럼을 별칭으로 한정한다(2a 교훈). 합계는 `::int`.
 */

function statusIn(column: SQL, statuses: readonly string[]): SQL {
  return sql`${column} in (${sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )})`;
}

/**
 * 청구 항목 하나당 한 행 — (sales_order_line_id, shipment_line_id, dispatch_attempt_id, return_active, return_consumed,
 * exchange_active). 셋 중 많아야 하나만 그 항목 수량이고 나머지는 0 이다. 아무것도 빼지 않는 상태의 항목은 행이 없다.
 * 소포 칸(`shipment_line_id`)이 빈 항목은 SKU 를 알 길이 없어 세지 않는다(N1).
 * 요청의 `sales_order_id` 가 범위 안인 것만 — 항목 테이블에는 주문 칸이 없다.
 */
function claimItemsSql(salesOrderScope: SQL): SQL {
  const t = returnExchangeTables;
  const returnCounted = [...ACTIVE_RETURN_STATUSES, ...CONSUMED_RETURN_STATUSES];
  return sql`
    select return_item.sales_order_line_id,
           return_item.shipment_line_id,
           return_item.dispatch_attempt_id,
           (case when ${statusIn(sql`return_request.status`, ACTIVE_RETURN_STATUSES)}
                 then return_item.quantity else 0 end)::int as return_active,
           (case when ${statusIn(sql`return_request.status`, CONSUMED_RETURN_STATUSES)}
                 then return_item.quantity else 0 end)::int as return_consumed,
           0::int as exchange_active
      from ${t.returnRequests} as return_request
      join ${t.returnRequestItems} as return_item on return_item.return_request_id = return_request.id
     where return_request.sales_order_id in (${salesOrderScope})
       and return_item.shipment_line_id is not null
       and ${statusIn(sql`return_request.status`, returnCounted)}
    union all
    select exchange_item.sales_order_line_id,
           exchange_item.shipment_line_id,
           exchange_item.dispatch_attempt_id,
           0::int as return_active,
           0::int as return_consumed,
           exchange_item.quantity::int as exchange_active
      from ${t.exchangeRequests} as exchange_request
      join ${t.exchangeRequestItems} as exchange_item on exchange_item.exchange_request_id = exchange_request.id
     where exchange_request.sales_order_id in (${salesOrderScope})
       and exchange_item.shipment_line_id is not null
       and ${statusIn(sql`exchange_request.status`, ACTIVE_EXCHANGE_STATUSES)}
  `;
}

/**
 * 판매 라인 × SKU 의 청구 합. 행 = (sales_order_line_id uuid, sku_id uuid, return_active, return_consumed,
 * exchange_active — int). `salesOrderScope` 는 판매주문 id 한 열을 내는 SELECT.
 *
 * 청구 항목 → `shipment_lines`(shipment_line_id) → `fulfillment_order_items`(sku_id, sales_order_line_id).
 * 상자 라인의 FOI 가 항목의 판매 라인을 가리킬 때만 센다 — 다른 라인의 소포를 적은 항목이 엉뚱한 라인에서 빠지지 않게.
 * FOI 의 `sales_order_line_id` 는 varchar 라 `::text` 로 잇는다.
 */
export function claimTotalsBySkuSql(salesOrderScope: SQL): SQL {
  const t = wmsTables;
  return sql`
    select claim_item.sales_order_line_id,
           claim_foi.sku_id,
           sum(claim_item.return_active)::int as return_active,
           sum(claim_item.return_consumed)::int as return_consumed,
           sum(claim_item.exchange_active)::int as exchange_active
      from (${claimItemsSql(salesOrderScope)}) as claim_item
      join ${t.shipmentLines} as claim_sl on claim_sl.id = claim_item.shipment_line_id
      join ${t.fulfillmentOrderItems} as claim_foi
        on claim_foi.id = claim_sl.fulfillment_order_item_id
       and claim_foi.sales_order_line_id = claim_item.sales_order_line_id::text
     group by claim_item.sales_order_line_id, claim_foi.sku_id
  `;
}

/**
 * 소포(출고 시도) × 상자 라인의 청구 합. 행 = (dispatch_attempt_id uuid, shipment_line_id uuid, claimed int).
 * claimed = 그 소포의 반품 항목 중 진행 중+소진 + 교환 항목 중 진행 중.
 * 출고 시도 칸이 빈 항목은 어느 소포인지 몰라 세지 않는다.
 */
export function claimTotalsByParcelSql(salesOrderScope: SQL): SQL {
  return sql`
    select claim_item.dispatch_attempt_id,
           claim_item.shipment_line_id,
           sum(claim_item.return_active + claim_item.return_consumed + claim_item.exchange_active)::int as claimed
      from (${claimItemsSql(salesOrderScope)}) as claim_item
     where claim_item.dispatch_attempt_id is not null
     group by claim_item.dispatch_attempt_id, claim_item.shipment_line_id
  `;
}
