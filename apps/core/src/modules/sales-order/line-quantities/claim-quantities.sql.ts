import { sql, type SQL } from 'drizzle-orm';
import { returnExchangeTables, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  ACTIVE_EXCHANGE_STATUSES,
  ACTIVE_RETURN_STATUSES,
  CONSUMED_RETURN_STATUSES,
  CUSTOMER_RETURN_ACTIVE_STATUSES,
  CUSTOMER_RETURN_CONSUMED_STATUSES,
} from './claim-statuses';

/**
 * 청구(반품·교환) 수량의 단 하나의 정의 (K6 PR3a). 청구 항목 테이블을 읽는 커널 파일은 이것 하나다.
 * 반품 예정 기록(`customer_returns`·`customer_return_lines`, K8 PR5)도 여기서 읽는다 — 옛 반품 표는 PR 10 까지 함께 읽고,
 * 두 갈래는 같은 칸(`return_active`·`return_consumed`)에 합쳐 서로를 뺀다.
 * 상태 목록은 `claim-statuses.ts` 에서 파라미터로 넣는다 — SQL 에 상태 문자열을 다시 쓰지 않는다.
 * 모든 테이블에 별칭을 붙이고 칼럼을 별칭으로 한정한다(2a 교훈). 합계는 `::int`.
 */

/** 반품 예정 기록 중 세는 것 — 진행 중 + 소진. 곧 «취소되지 않은 반품»이다(`claim-statuses.ts`). */
const CUSTOMER_RETURN_COUNTED_STATUSES = [...CUSTOMER_RETURN_ACTIVE_STATUSES, ...CUSTOMER_RETURN_CONSUMED_STATUSES];

function statusIn(column: SQL, statuses: readonly string[]): SQL {
  return sql`${column} in (${sql.join(
    statuses.map((status) => sql`${status}`),
    sql`, `,
  )})`;
}

/**
 * 청구 항목을 그 소포의 SKU 로 해석한다 — «세는 항목»의 단 하나의 정의(R4). SKU 합·소포 합·요청 환산이 모두 이것을 지난다.
 * `itemsSql` 은 (sales_order_line_id, shipment_line_id, dispatch_attempt_id, …) 칸을 가진 항목 행. 그 칸을 모두 그대로 내고
 * `sku_id` 를 붙인다. `sku_id` 는 항목이 세어질 때만 non-null 이다:
 *   - 두 소포 칸(`shipment_line_id`·`dispatch_attempt_id`)이 모두 있고(N1 — 하나라도 비면 어느 소포의 무엇인지 모른다)
 *   - 그 상자 라인의 FOI 가 항목의 판매 라인을 가리킨다 — 다른 라인의 소포를 적은 항목이 엉뚱한 라인·소포에서 빠지지 않게.
 * left join 이라 해석 못 한 항목도 행은 남는다 — 요청 환산이 그 라인을 «세트 일부»로 보려면 봐야 한다.
 * FOI 의 `sales_order_line_id` 는 varchar 라 `::text` 로 잇는다.
 */
function resolvedClaimItemsSql(itemsSql: SQL): SQL {
  const t = wmsTables;
  return sql`
    select raw_item.*, resolved_foi.sku_id
      from (${itemsSql}) as raw_item
      left join ${t.shipmentLines} as resolved_sl
        on resolved_sl.id = raw_item.shipment_line_id
       and raw_item.dispatch_attempt_id is not null
      left join ${t.fulfillmentOrderItems} as resolved_foi
        on resolved_foi.id = resolved_sl.fulfillment_order_item_id
       and resolved_foi.sales_order_line_id = raw_item.sales_order_line_id::text
  `;
}

/**
 * 세는 청구 항목 하나당 한 행 — (sales_order_line_id, shipment_line_id, dispatch_attempt_id, sku_id, return_active,
 * return_consumed, exchange_active). 셋 중 많아야 하나만 그 항목 수량이고 나머지는 0 이다. 아무것도 빼지 않는 상태의 항목과
 * 소포의 SKU 로 해석되지 않는 항목(`resolvedClaimItemsSql`)은 행이 없다.
 * 요청의 `sales_order_id` 가 범위 안인 것만 — 항목 테이블에는 주문 칸이 없다.
 */
function claimItemsSql(salesOrderScope: SQL): SQL {
  const t = returnExchangeTables;
  const returnCounted = [...ACTIVE_RETURN_STATUSES, ...CONSUMED_RETURN_STATUSES];
  return sql`
    select counted_item.*
      from (${resolvedClaimItemsSql(sql`
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
           and ${statusIn(sql`exchange_request.status`, ACTIVE_EXCHANGE_STATUSES)}
      `)}) as counted_item
     where counted_item.sku_id is not null
  `;
}

/**
 * 반품 예정 기록의 줄을 굳은 구성으로 SKU 에 펼친다 (K8 PR5). 행 = (sales_order_line_id uuid, sku_id uuid, return_active,
 * return_consumed, exchange_active — int) — `claimItemsSql` 과 같은 칸이다. SKU 수량 = 줄의 판매 단위 × 1개당 수량.
 * 줄은 소포를 모르므로(판매 라인 단위로 적는다) 소포 합에는 들어가지 않는다 — 소포 자격은 SKU 몫으로 덮인다(N5).
 * 구성이 없는 라인(FO 전)은 행이 없다 — FO 전엔 SKU 층도 비어 있다.
 * 줄의 판매 라인이 기록의 주문 라인인 것만 — 다른 주문 라인을 적은 줄이 그 라인 사실에 섞이지 않게.
 */
function customerReturnSkuItemsSql(salesOrderScope: SQL): SQL {
  const t = wmsTables;
  return sql`
    select customer_return_line.sales_order_line_id,
           customer_return_composition.sku_id,
           (case when ${statusIn(sql`customer_return.status`, CUSTOMER_RETURN_ACTIVE_STATUSES)}
                 then customer_return_line.quantity * customer_return_composition.qty_per_unit else 0 end)::int
             as return_active,
           (case when ${statusIn(sql`customer_return.status`, CUSTOMER_RETURN_CONSUMED_STATUSES)}
                 then customer_return_line.quantity * customer_return_composition.qty_per_unit else 0 end)::int
             as return_consumed,
           0::int as exchange_active
      from ${t.customerReturns} as customer_return
      join ${t.customerReturnLines} as customer_return_line
        on customer_return_line.customer_return_id = customer_return.id
      join ${t.salesOrderLines} as customer_return_sales_line
        on customer_return_sales_line.id = customer_return_line.sales_order_line_id
       and customer_return_sales_line.sales_order_id = customer_return.sales_order_id
      join ${t.salesOrderLineCompositions} as customer_return_composition
        on customer_return_composition.sales_order_line_id = customer_return_line.sales_order_line_id
     where customer_return.sales_order_id in (${salesOrderScope})
       and ${statusIn(sql`customer_return.status`, CUSTOMER_RETURN_COUNTED_STATUSES)}
  `;
}

/**
 * 판매 라인 × SKU 의 청구 합. 행 = (sales_order_line_id uuid, sku_id uuid, return_active, return_consumed,
 * exchange_active — int). `salesOrderScope` 는 판매주문 id 한 열을 내는 SELECT.
 * 옛 청구 항목은 SKU 를 항목의 상자 라인 → FOI 에서 얻는다(`resolvedClaimItemsSql`) — 소포 합과 같은 항목 집합이다(R4).
 * 반품 예정 기록은 구성으로 펼쳐 더한다(`customerReturnSkuItemsSql`) — 소포 합에는 없다(N5).
 */
export function claimTotalsBySkuSql(salesOrderScope: SQL): SQL {
  return sql`
    select claim_item.sales_order_line_id,
           claim_item.sku_id,
           sum(claim_item.return_active)::int as return_active,
           sum(claim_item.return_consumed)::int as return_consumed,
           sum(claim_item.exchange_active)::int as exchange_active
      from (
        select old_claim_item.sales_order_line_id,
               old_claim_item.sku_id,
               old_claim_item.return_active,
               old_claim_item.return_consumed,
               old_claim_item.exchange_active
          from (${claimItemsSql(salesOrderScope)}) as old_claim_item
        union all
        select customer_return_item.sales_order_line_id,
               customer_return_item.sku_id,
               customer_return_item.return_active,
               customer_return_item.return_consumed,
               customer_return_item.exchange_active
          from (${customerReturnSkuItemsSql(salesOrderScope)}) as customer_return_item
      ) as claim_item
     group by claim_item.sales_order_line_id, claim_item.sku_id
  `;
}

/**
 * 취소되지 않은 반품 예정 기록의 줄 (K8 PR5). 행 = (held_line_id uuid, held_quantity int — 판매 단위).
 * 칼럼 이름을 바꿔 낸다 — 라인 수량 문(`lineReturnHeldSql`)이 이것을 파생 테이블로 감싸 바깥 라인 id 와 비교한다
 * (`lineCanceledQuantitySql` 과 같은 바깥 참조 함정 — 겹치는 이름 `id`·`quantity` 를 내지 않는다).
 */
export function heldCustomerReturnLinesSql(): SQL {
  const t = wmsTables;
  return sql`
    select held_return_line.sales_order_line_id as held_line_id,
           held_return_line.quantity as held_quantity
      from ${t.customerReturnLines} as held_return_line
      join ${t.customerReturns} as held_return on held_return.id = held_return_line.customer_return_id
     where ${statusIn(sql`held_return.status`, CUSTOMER_RETURN_COUNTED_STATUSES)}
  `;
}

/**
 * 소포(출고 시도) × 상자 라인의 청구 합. 행 = (dispatch_attempt_id uuid, shipment_line_id uuid, claimed int).
 * claimed = 그 소포의 반품 항목 중 진행 중+소진 + 교환 항목 중 진행 중. SKU 합과 같은 항목 집합을 센다(R4).
 */
export function claimTotalsByParcelSql(salesOrderScope: SQL): SQL {
  return sql`
    select claim_item.dispatch_attempt_id,
           claim_item.shipment_line_id,
           sum(claim_item.return_active + claim_item.return_consumed + claim_item.exchange_active)::int as claimed
      from (${claimItemsSql(salesOrderScope)}) as claim_item
     group by claim_item.dispatch_attempt_id, claim_item.shipment_line_id
  `;
}

/**
 * 반품 요청 하나의 판매 라인 × SKU 수량 — 상태와 무관하게 그 요청의 항목 전부. 행 = (sales_order_id uuid,
 * sales_order_line_id uuid, sku_id uuid|null, quantity int). 판매 단위 환산(`readReturnRequestSalesUnits`)이 읽는다.
 * `sku_id` 가 null 인 행 = 소포의 SKU 로 해석되지 않는 항목들의 합(`resolvedClaimItemsSql` — 소포 칸이 비었거나 다른 라인의
 * 소포를 적었다). 그 라인은 세트 수를 정할 수 없다.
 */
export function returnRequestSkuQuantitiesSql(returnRequestId: string): SQL {
  const t = returnExchangeTables;
  return sql`
    select request_item.sales_order_id,
           request_item.sales_order_line_id,
           request_item.sku_id,
           sum(request_item.quantity)::int as quantity
      from (${resolvedClaimItemsSql(sql`
        select return_request.sales_order_id,
               return_item.sales_order_line_id,
               return_item.shipment_line_id,
               return_item.dispatch_attempt_id,
               return_item.quantity
          from ${t.returnRequests} as return_request
          join ${t.returnRequestItems} as return_item on return_item.return_request_id = return_request.id
         where return_request.id = ${returnRequestId}::uuid
      `)}) as request_item
     group by request_item.sales_order_id, request_item.sales_order_line_id, request_item.sku_id
  `;
}
