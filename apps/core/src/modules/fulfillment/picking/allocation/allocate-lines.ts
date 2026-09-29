import { LineShortage, SourceCapacity } from './allocation.types';

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

export interface AllocationOutcome {
  drafts: AllocationDraft[];
  shortages: LineShortage[];
}

const byId = (left: { id: string }, right: { id: string }) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/** 로케이션 코드 순, 같은 코드(다른 창고는 오지 않는다)면 id 순 — 사람이 읽는 순서이자 결정적 순서. */
const byCode = (left: SourceCapacity, right: SourceCapacity) =>
  left.locationCode < right.locationCode
    ? -1
    : left.locationCode > right.locationCode
      ? 1
      : left.sourceLocationId < right.sourceLocationId
        ? -1
        : left.sourceLocationId > right.sourceLocationId
          ? 1
          : 0;

/**
 * 배정 전략의 단일 지점(스펙 E8). 나중에 동선·오래된 재고 먼저 등으로 고도화할 때 이 함수만 바꾼다.
 *
 * 1. 줄은 줄 id 순(결정적)
 * 2. 한 로케이션에서 줄 전량을 채울 수 있으면 그런 곳 중 코드 순 첫째
 * 3. 아니면 코드 순으로 나눠 채운다
 *
 * 모자라도 던지지 않고 모자란 줄을 **전부** 돌려준다(스펙 §6 «사유는 전부»). shortages 가 하나라도 있으면 호출자는
 * drafts 를 쓰지 않는다. 사유는 SKU 별 적치 대기분을 줄 순서대로 누적 소진하며 가른다 — 대기분으로 채워지면
 * INBOUND_PENDING(적치하면 풀린다), 아니면 STOCK_SHORT.
 * 입력 용량은 복사해서 깎는다: 호출자가 같은 용량 목록을 다시 쓰는 일이 있다.
 */
export function allocateLines(
  lines: readonly AllocatableLine[],
  capacities: readonly SourceCapacity[],
  inboundPendingBySku: ReadonlyMap<string, number> = new Map(),
): AllocationOutcome {
  const remaining = capacities.map((capacity) => ({ ...capacity }));
  const pending = new Map(inboundPendingBySku);
  const drafts: AllocationDraft[] = [];
  const shortages: LineShortage[] = [];
  for (const line of [...lines].sort(byId)) {
    const sources = remaining.filter((source) => source.skuId === line.skuId && source.remainingQty > 0).sort(byCode);
    const whole = sources.find((source) => source.remainingQty >= line.qty);
    let needed = line.qty;
    for (const source of whole ? [whole] : sources) {
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
      const inbound = pending.get(line.skuId) ?? 0;
      pending.set(line.skuId, Math.max(0, inbound - needed));
      shortages.push({
        workItemId: line.workItemId,
        shipmentLineId: line.id,
        skuId: line.skuId,
        requiredQty: line.qty,
        shortQty: needed,
        reason: inbound >= needed ? 'INBOUND_PENDING' : 'STOCK_SHORT',
      });
    }
  }
  return { drafts, shortages };
}
