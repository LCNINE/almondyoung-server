import { sql, type SQL } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';
import { CUSTOMER_RETURN_ACTIVE_STATUSES, CUSTOMER_RETURN_CONSUMED_STATUSES } from './claim-statuses';

/**
 * 청구(반품) 수량의 단 하나의 정의 (K6 PR3a). 청구 기록을 수량으로 읽는 커널 파일은 이것 하나다.
 * 반품 예정 기록(`customer_returns`·`customer_return_lines`, K8 PR5)이 청구의 유일한 원천이다 — 옛 반품·교환 표는
 * K8 PR 10 이 걷었다. 교환(K8 PR11)도 같은 `customer_returns` 행(`kind 'exchange'`)이라 이미 여기서 센다 — 원래 줄의
 * claimable 이 반품과 같이 준다. 교환 줄(`exchange_return_line_id`)은 청구 줄이 가리키지 않으니 청구 수량이 없다.
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
 * 반품 예정 기록의 줄을 굳은 구성으로 SKU 에 펼친다 (K8 PR5). 행 = (sales_order_line_id uuid, sku_id uuid, return_active,
 * return_consumed — int). SKU 수량 = 줄의 판매 단위 × 1개당 수량.
 * 줄은 소포를 모른다(판매 라인 단위로 적는다) — 소포 자격은 SKU 몫으로 덮인다(N5, `parcelClaimEligibilitySql`).
 * 구성이 없는 라인(FO 전)은 행이 없다 — FO 전엔 SKU 층도 비어 있다.
 * 줄의 판매 라인이 기록의 주문 라인인 것만 — 다른 주문 라인을 적은 줄이 그 라인 사실에 섞이지 않게.
 */
function customerReturnSkuItemsSql(salesOrderScope: SQL): SQL {
  const t = wmsTables;
  return sql`
    select customer_return_line.sales_order_line_id,
           customer_return_composition.sku_id,
           (case when ${statusIn(sql`customer_return.status`, CUSTOMER_RETURN_ACTIVE_STATUSES)}
                 then (customer_return_line.quantity - customer_return_line.missing_qty) * customer_return_composition.qty_per_unit else 0 end)::int
             as return_active,
           (case when ${statusIn(sql`customer_return.status`, CUSTOMER_RETURN_CONSUMED_STATUSES)}
                 then (customer_return_line.quantity - customer_return_line.missing_qty) * customer_return_composition.qty_per_unit else 0 end)::int
             as return_consumed
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
 * 판매 라인 × SKU 의 청구 합. 행 = (sales_order_line_id uuid, sku_id uuid, return_active, return_consumed — int).
 * `salesOrderScope` 는 판매주문 id 한 열을 내는 SELECT.
 */
export function claimTotalsBySkuSql(salesOrderScope: SQL): SQL {
  return sql`
    select customer_return_item.sales_order_line_id,
           customer_return_item.sku_id,
           sum(customer_return_item.return_active)::int as return_active,
           sum(customer_return_item.return_consumed)::int as return_consumed
      from (${customerReturnSkuItemsSql(salesOrderScope)}) as customer_return_item
     group by customer_return_item.sales_order_line_id, customer_return_item.sku_id
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
           (held_return_line.quantity - held_return_line.missing_qty) as held_quantity
      from ${t.customerReturnLines} as held_return_line
      join ${t.customerReturns} as held_return on held_return.id = held_return_line.customer_return_id
     where ${statusIn(sql`held_return.status`, CUSTOMER_RETURN_COUNTED_STATUSES)}
  `;
}
