import { sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { wmsTables } from '../../inventory/schema/inventory.schema';

// 판매주문 부분취소가 줄마다 취소한 수량. SalesOrdersService.getCancelledQuantityByLine 과 같은 계산(partial 취소 metadata.cancelledLines 합)이다.
// 줄 상태 컬럼은 쓰는 생산자가 없어 부분취소를 반영하지 못했고(지금은 지웠다) — 인쇄 판정·발주 수요처럼
// 「줄에 아직 살아 있는 수량」이 필요한 SQL 은 이 한 벌에서 읽는다(#1016 15번 §1.1).
export function cancelledQuantitySql(salesOrderId: SQLWrapper, salesOrderLineId: SQLWrapper): SQL {
  const c = wmsTables.salesOrderCancellations;
  return sql`coalesce((
    select sum((cl.value->>'quantity')::numeric)
    from ${c}
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(${c.metadata}->'cancelledLines') = 'array' then ${c.metadata}->'cancelledLines' else '[]'::jsonb end
    ) as cl(value)
    where ${c.salesOrderId} = ${salesOrderId}
      and ${c.cancellationScope} = 'partial'
      and jsonb_typeof(cl.value) = 'object'
      and jsonb_typeof(cl.value->'quantity') = 'number'
      and cl.value->>'salesOrderLineId' = (${salesOrderLineId})::text
  ), 0)`;
}
