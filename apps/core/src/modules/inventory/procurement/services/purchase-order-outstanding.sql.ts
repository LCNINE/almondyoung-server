import { sql, SQL } from 'drizzle-orm';
import { wmsTables } from '../../schema/inventory.schema';

const pol = wmsTables.purchaseOrderLines;
const po = wmsTables.purchaseOrders;

/**
 * 남은 수량이 있는 실발주 라인(스펙 §5.1). `purchase-order-status.rules.ts` 의 `outstandingQty` 와 같은 식이고,
 * `stock_summary_view` 의 inbound_pending 서브쿼리·`sync-restock-to-medusa.ts` 도 같은 식을 손으로 든다 —
 * 파리티는 `expected-arrivals-parity.integration.spec.ts` 가 고정한다. 호출자가 purchaseOrders 를 조인해야 한다.
 */
export function outstandingLineWhere(): SQL {
  return sql`${pol.status} = 'ordered' AND ${pol.closedAt} IS NULL AND ${pol.receivedQty} < COALESCE(${pol.orderedQty}, 0) AND ${po.status} <> 'cancelled'`;
}

export function outstandingQtySql(): SQL<number> {
  return sql<number>`COALESCE(${pol.orderedQty}, 0) - ${pol.receivedQty}`;
}
