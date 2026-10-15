import { inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { CompositionItem, sortComposition } from './line-composition';

/**
 * 라인들의 굳힌 구성(SKU 순). 라인 판정 리더·고객 취소 경로·수정 경로가 같은 읽기를 쓴다 — 한 곳이 정렬이나 조건을 바꾸면
 * 다른 곳의 비교(sameComposition)·비율 계산이 조용히 갈린다.
 */
export async function selectFrozenCompositions(
  trx: DbTx,
  lineIds: readonly string[],
): Promise<Map<string, CompositionItem[]>> {
  if (lineIds.length === 0) return new Map();
  const table = wmsTables.salesOrderLineCompositions;
  const rows = await trx
    .select({ salesOrderLineId: table.salesOrderLineId, skuId: table.skuId, qtyPerUnit: table.qtyPerUnit })
    .from(table)
    .where(inArray(table.salesOrderLineId, [...lineIds]));
  const byLine = new Map<string, CompositionItem[]>();
  for (const row of rows) {
    const items = byLine.get(row.salesOrderLineId) ?? [];
    items.push({ skuId: row.skuId, qtyPerUnit: row.qtyPerUnit });
    byLine.set(row.salesOrderLineId, items);
  }
  for (const [lineId, items] of byLine) byLine.set(lineId, sortComposition(items));
  return byLine;
}
