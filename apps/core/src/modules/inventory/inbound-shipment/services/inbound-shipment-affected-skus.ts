import { and, eq, isNull } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

/** 그 선적의 `kind='sku'` 줄 SKU (중복 제거) — 선적 단위 동작이 판매가능수량을 다시 낼 대상. */
export async function shipmentSkuIds(trx: DbTx, shipmentId: string): Promise<string[]> {
  const rows = await trx
    .select({ skuId: wmsTables.inboundShipmentLines.skuId })
    .from(wmsTables.inboundShipmentLines)
    .where(
      and(eq(wmsTables.inboundShipmentLines.shipmentId, shipmentId), eq(wmsTables.inboundShipmentLines.kind, 'sku')),
    );
  return uniqueSkuIds(rows.map((r) => r.skuId));
}

/**
 * 그 상자를 덮는 `kind='sku'` 줄 SKU ∪ 그 상자의 리스트에 없던 물건(`line_id IS NULL`) SKU.
 * 취소된 집계도 포함한다 — 확정 취소 직후에도 부르므로.
 */
export async function boxSkuIds(trx: DbTx, boxId: string): Promise<string[]> {
  const covered = await trx
    .select({ skuId: wmsTables.inboundShipmentLines.skuId })
    .from(wmsTables.inboundShipmentLineBoxes)
    .innerJoin(
      wmsTables.inboundShipmentLines,
      eq(wmsTables.inboundShipmentLines.id, wmsTables.inboundShipmentLineBoxes.lineId),
    )
    .where(and(eq(wmsTables.inboundShipmentLineBoxes.boxId, boxId), eq(wmsTables.inboundShipmentLines.kind, 'sku')));
  const unplanned = await trx
    .select({ skuId: wmsTables.inboundShipmentBoxCounts.skuId })
    .from(wmsTables.inboundShipmentBoxCounts)
    .where(and(eq(wmsTables.inboundShipmentBoxCounts.boxId, boxId), isNull(wmsTables.inboundShipmentBoxCounts.lineId)));
  return uniqueSkuIds([...covered.map((r) => r.skuId), ...unplanned.map((r) => r.skuId)]);
}

export function uniqueSkuIds(ids: readonly (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}
