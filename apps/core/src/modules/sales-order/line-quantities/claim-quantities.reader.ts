import type { DbTx } from '../../inventory/schema/inventory.schema';
import { returnRequestSkuQuantitiesSql } from './claim-quantities.sql';
import { readLineQuantities } from './line-quantities.reader';
import { exactSetUnits } from './line-sales-units';

/** 반품 요청이 판매 라인 하나에서 돌려받은 판매 단위 — 통째 세트 수, 또는 세트 일부(세트 수를 정할 수 없다). */
export type ReturnedSalesUnits = { kind: 'whole'; units: number } | { kind: 'set_partial' };

type RequestSkuRow = {
  sales_order_id: string;
  sales_order_line_id: string;
  /** null = 소포의 SKU 로 해석되지 않는 항목들(N1). */
  sku_id: string | null;
  quantity: number;
};

/**
 * 반품 요청 하나의 라인별 판매 단위 (K6 PR3a, C6). 이 요청의 항목을 (라인, SKU) 로 합해(F2 — 소포가 여럿이어도 라인 하나)
 * `exactSetUnits` 로 환산한다. 호출자 트랜잭션에서 읽는다(ADR-0025). 키 = 이 요청 항목이 적은 판매 라인.
 * 소포의 SKU 로 해석되지 않는 항목(소포 칸이 비었거나 다른 라인의 소포를 적었다)이 있는 라인은 `set_partial` 이다 —
 * SKU 를 모르면 세트 수를 정할 수 없다(N1). 항목이 없는 요청은 빈 맵.
 * 항목 테이블은 이 파일이 아니라 `returnRequestSkuQuantitiesSql` 이 읽는다(R2).
 */
export async function readReturnRequestSalesUnits(
  trx: DbTx,
  returnRequestId: string,
): Promise<Map<string, ReturnedSalesUnits>> {
  const rows = await trx.execute<RequestSkuRow>(returnRequestSkuQuantitiesSql(returnRequestId));
  if (rows.length === 0) return new Map();
  const salesOrderId = rows[0].sales_order_id;
  const lines = await readLineQuantities(trx, salesOrderId);

  const requestedByLine = new Map<string, { bySku: Map<string, number>; unresolved: boolean }>();
  for (const row of rows) {
    const entry = requestedByLine.get(row.sales_order_line_id) ?? { bySku: new Map(), unresolved: false };
    if (row.sku_id === null) entry.unresolved = true;
    else entry.bySku.set(row.sku_id, row.quantity);
    requestedByLine.set(row.sales_order_line_id, entry);
  }

  const result = new Map<string, ReturnedSalesUnits>();
  for (const [lineId, requested] of requestedByLine) {
    const line = lines.get(lineId);
    // 항목의 판매 라인은 요청 주문의 라인이어야 한다 — 아니면 데이터가 어긋난 것이다(도메인 예외로 바꾸지 않는다)
    if (!line)
      throw new Error(`Return request ${returnRequestId} names line ${lineId} outside SalesOrder ${salesOrderId}`);
    const units = requested.unresolved ? null : exactSetUnits(line, requested.bySku);
    result.set(lineId, units === null ? { kind: 'set_partial' } : { kind: 'whole', units });
  }
  return result;
}
