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
 * 줄 id 순으로 한 번 배정한다(E8). 모자란 줄도 거기까지 채운 draft 를 남긴다 — 박스 단위 판정은 `allocateLines` 가 한다.
 * 입력 용량은 복사해서 깎는다: 호출자가 같은 용량 목록을 다시 쓰는 일이 있다.
 */
function allocatePass(
  lines: readonly AllocatableLine[],
  capacities: readonly SourceCapacity[],
): {
  drafts: AllocationDraft[];
  short: Array<{ line: AllocatableLine; shortQty: number }>;
  remaining: SourceCapacity[];
} {
  const remaining = capacities.map((capacity) => ({ ...capacity }));
  const drafts: AllocationDraft[] = [];
  const short: Array<{ line: AllocatableLine; shortQty: number }> = [];
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
    if (needed > 0) short.push({ line, shortQty: needed });
  }
  return { drafts, short, remaining };
}

/**
 * 배정 전략의 단일 지점(스펙 E8). 나중에 동선·오래된 재고 먼저 등으로 고도화할 때 이 함수만 바꾼다.
 *
 * 한 번의 배정(`allocatePass`):
 * 1. 줄은 줄 id 순(결정적)
 * 2. 한 로케이션에서 줄 전량을 채울 수 있으면 그런 곳 중 코드 순 첫째
 * 3. 아니면 코드 순으로 나눠 채운다
 *
 * 박스(`workItemId`) 단위 판정 — «막힌 박스»는 실제로 막는 박스만이다(스펙 §6, 원장 Ruling F1):
 * 모자란 줄이 채운 일부 draft 를 그대로 두면 그 몫 때문에 다른 박스까지 모자라게 보고된다(재고 5, A 6개·B 3개 →
 * A 만 막혀야 하는데 둘 다 보고). 그래서 한 번 전부 배정해 부족이 없으면 그대로 돌려주고, 부족이 있으면 고정점을
 * 찾는다 — 박스를 가장 앞선 줄 id 순으로 하나씩 들여, 이미 들인 박스들과 함께 전체 용량 위에서 배정해 보아 부족이
 * 없으면 들이고 있으면 막는다. 끝나면 들인 박스끼리는 부족이 없고, 막힌 박스는 저마다 앞선 박스들이 쓰고 남은
 * 용량으로는 모자란 박스다. 「부족이 난 박스를 전부 한꺼번에 막고 나머지로 다시」는 쓰지 않는다: A 의 줄이 먼저면
 * A 가 5개를 가져간 뒤라 B 도 부족으로 잡혀 둘 다 막힌다(순서 의존).
 * 경합 재고는 가장 앞선 줄 id 의 박스가 이긴다 — 결정적이지만 최적(가장 많은 박스)을 보장하지는 않는다.
 *
 * 돌려주는 것: drafts 는 막히지 않은 박스 것만, shortages 는 막힌 박스 것만. 막힌 박스들의 줄은 줄 id 순으로, 막히지
 * 않은 박스들의 draft 가 쓰고 남은 용량 위에서 다시 재어 모자란 줄을 **전부** 돌려준다(스펙 §6 «사유는 전부»).
 * shortages 가 하나라도 있으면 호출자는 drafts 를 쓰지 않는다(전부 아니면 전무). 사유는 SKU 별 적치 대기분을 그
 * 모자란 줄 순서대로 누적 소진하며 가른다 — 대기분으로 채워지면 INBOUND_PENDING(적치하면 풀린다), 아니면 STOCK_SHORT.
 * 입력은 변경하지 않는다.
 */
export function allocateLines(
  lines: readonly AllocatableLine[],
  capacities: readonly SourceCapacity[],
  inboundPendingBySku: ReadonlyMap<string, number> = new Map(),
): AllocationOutcome {
  const first = allocatePass(lines, capacities);
  if (!first.short.length) return { drafts: first.drafts, shortages: [] };

  const linesByBox = new Map<string, AllocatableLine[]>();
  for (const line of [...lines].sort(byId)) {
    const boxLines = linesByBox.get(line.workItemId) ?? [];
    boxLines.push(line);
    linesByBox.set(line.workItemId, boxLines);
  }
  // Map 은 삽입 순서를 지킨다 — 줄 id 순으로 넣었으니 박스는 «가장 앞선 줄 id» 순이다.
  const admitted: AllocatableLine[] = [];
  const blocked: AllocatableLine[] = [];
  for (const boxLines of linesByBox.values()) {
    const trial = allocatePass([...admitted, ...boxLines], capacities);
    if (trial.short.length) blocked.push(...boxLines);
    else admitted.push(...boxLines);
  }

  const settled = allocatePass(admitted, capacities);
  const measured = allocatePass(blocked, settled.remaining);
  // 막힌 박스는 들일 때 앞선 박스들의 몫으로 모자랐고, 여기서는 들인 박스 전부와 앞선 막힌 박스까지 뺀 용량으로
  // 재니 반드시 다시 모자란다. 아니면 호출자가 막힌 박스를 배정 없이 시작시키게 되므로 조용히 넘기지 않는다.
  if (!measured.short.length) throw new Error('allocateLines: blocked boxes measured no shortage');
  const pending = new Map(inboundPendingBySku);
  const shortages: LineShortage[] = measured.short.map(({ line, shortQty }) => {
    const inbound = pending.get(line.skuId) ?? 0;
    pending.set(line.skuId, Math.max(0, inbound - shortQty));
    return {
      workItemId: line.workItemId,
      shipmentLineId: line.id,
      skuId: line.skuId,
      requiredQty: line.qty,
      shortQty,
      reason: inbound >= shortQty ? 'INBOUND_PENDING' : 'STOCK_SHORT',
    };
  });
  return { drafts: settled.drafts, shortages };
}
