import { conflict } from './allocation.errors';
import { SourceCapacity } from './allocation.types';

export interface AllocatableLine {
  id: string;
  skuId: string;
  qty: number;
  workItemId: string;
}

export interface AllocationDraft {
  workItemId: string;
  shipmentLineId: string;
  sourceLocationId: string;
  qty: number;
  sourceStockVersion: number;
}

/**
 * 줄 id 순으로, 같은 SKU 의 위치를 위치 id 순으로 선착 배정한다(옛 planPicking 의 루프 그대로).
 * 모자라면 아무것도 돌려주지 않고 던진다 — 호출자는 한 트랜잭션에서 전량이 아니면 배정하지 않는다.
 * 입력 용량은 복사해서 깎는다: 호출자가 같은 용량 목록을 다시 쓰는 일이 있다.
 */
export function allocateLines(
  lines: readonly AllocatableLine[],
  capacities: readonly SourceCapacity[],
): AllocationDraft[] {
  const remaining = capacities.map((capacity) => ({ ...capacity }));
  const drafts: AllocationDraft[] = [];
  for (const line of [...lines].sort((left, right) => left.id.localeCompare(right.id))) {
    let needed = line.qty;
    const sources = remaining
      .filter((source) => source.skuId === line.skuId && source.remainingQty > 0)
      .sort((left, right) => left.sourceLocationId.localeCompare(right.sourceLocationId));
    for (const source of sources) {
      if (needed === 0) break;
      const quantity = Math.min(needed, source.remainingQty);
      drafts.push({
        workItemId: line.workItemId,
        shipmentLineId: line.id,
        sourceLocationId: source.sourceLocationId,
        qty: quantity,
        sourceStockVersion: source.stockVersion,
      });
      source.remainingQty -= quantity;
      needed -= quantity;
    }
    if (needed > 0) {
      throw conflict(
        'PICKING_SOURCE_INSUFFICIENT',
        `Generally available source stock is short by ${needed} for shipment line ${line.id}`,
      );
    }
  }
  return drafts;
}
