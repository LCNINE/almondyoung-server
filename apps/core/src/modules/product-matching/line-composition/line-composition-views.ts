import { eq, inArray } from 'drizzle-orm';
import { DbService } from '@app/db';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { CompositionSource } from './line-composition';

export interface CompositionItemView {
  skuId: string;
  skuCode: string;
  skuName: string;
  qtyPerUnit: number;
}

export interface LineCompositionView {
  salesOrderLineId: string;
  productName: string;
  quantity: number;
  compositionSource: CompositionSource | null;
  composition: CompositionItemView[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Reader = DbTx | DbService<typeof wmsSchema>['db'];

/**
 * 화면 표시용 라인 구성(SKU 코드 순). 판정·비교는 selectFrozenCompositions 를 쓴다 — 그쪽 정렬은 sameComposition 의 계약이라
 * 표시 요구(이름·코드 조인)를 거기 섞지 않는다.
 */
export async function selectCompositionItemViews(
  db: Reader,
  lineIds: readonly string[],
): Promise<Map<string, CompositionItemView[]>> {
  if (lineIds.length === 0) return new Map();
  const table = wmsTables.salesOrderLineCompositions;
  const rows = await db
    .select({
      salesOrderLineId: table.salesOrderLineId,
      skuId: table.skuId,
      qtyPerUnit: table.qtyPerUnit,
      skuCode: wmsTables.skus.code,
      skuName: wmsTables.skus.name,
    })
    .from(table)
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, table.skuId))
    .where(inArray(table.salesOrderLineId, [...lineIds]))
    .orderBy(wmsTables.skus.code);
  const byLine = new Map<string, CompositionItemView[]>();
  for (const row of rows) {
    const items = byLine.get(row.salesOrderLineId) ?? [];
    items.push({ skuId: row.skuId, skuCode: row.skuCode, skuName: row.skuName, qtyPerUnit: row.qtyPerUnit });
    byLine.set(row.salesOrderLineId, items);
  }
  return byLine;
}

/** 출고 주문 상세가 라인마다 구성과 출처를 그린다(스펙 §8-2). 굳히지 않은 라인은 composition 이 빈 배열이다 */
export async function selectLineCompositionViews(
  db: Reader,
  lineIds: readonly string[],
): Promise<LineCompositionView[]> {
  // FO 항목의 sales_order_line_id 는 varchar 라 uuid 가 아닌 옛 값이 섞일 수 있다 — 하나가 상세 전체를 500 으로 만들지 않게 거른다
  const validIds = lineIds.filter((id) => UUID_PATTERN.test(id));
  if (validIds.length === 0) return [];
  const lines = wmsTables.salesOrderLines;
  const rows = await db
    .select({
      id: lines.id,
      productName: lines.productName,
      quantity: lines.quantity,
      compositionSource: lines.compositionSource,
    })
    .from(lines)
    .where(inArray(lines.id, validIds))
    .orderBy(lines.createdAt, lines.id);
  const items = await selectCompositionItemViews(db, validIds);
  return rows.map((row) => ({
    salesOrderLineId: row.id,
    productName: row.productName,
    quantity: row.quantity,
    compositionSource: row.compositionSource ?? null,
    composition: items.get(row.id) ?? [],
  }));
}
