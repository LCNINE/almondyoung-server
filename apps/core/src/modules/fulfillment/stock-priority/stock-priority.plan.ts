export interface PriorityTargetLine {
  lineId: string;
  skuId: string;
  missingQty: number;
}

export interface PrioritySourceLine {
  lineId: string;
  shipmentId: string;
  skuId: string;
  reservedQty: number;
  /** 상자의 모든 줄이 예약됐는가 — 가져오면 나갈 수 있던 상자가 못 나가게 된다 */
  ready: boolean;
  /** 재고 대기 순번. 클수록 뒤에 온 주문이다 */
  queuedAt: number;
}

export interface PriorityTake {
  sourceLineId: string;
  sourceShipmentId: string;
  targetLineId: string;
  skuId: string;
  qty: number;
  ready: boolean;
}

export interface PriorityPlan {
  /** 아무 상자도 예약하지 않은 재고에서 받는 몫 */
  free: { targetLineId: string; qty: number }[];
  takes: PriorityTake[];
  missingQty: number;
}

/**
 * 우선할당할 상자의 모자란 줄을 무엇으로 채울지. 남는 재고 → 어차피 못 나가는 상자(뒤에 온 것부터) 순이고,
 * `includeReady` 면 나갈 수 있던 상자도 쓴다 — 이미 건드린 상자를 먼저 써서 못 나가게 되는 상자를 줄인다.
 */
export function planStockPriority(
  targets: readonly PriorityTargetLine[],
  freeBySku: ReadonlyMap<string, number>,
  sources: readonly PrioritySourceLine[],
  includeReady: boolean,
): PriorityPlan {
  const freeLeft = new Map(freeBySku);
  const left = new Map(sources.map((source) => [source.lineId, source.reservedQty]));
  const touched = new Set<string>();
  const plan: PriorityPlan = { free: [], takes: [], missingQty: 0 };
  const open: { target: PriorityTargetLine; missing: number }[] = [];

  for (const target of [...targets].sort((a, b) => a.lineId.localeCompare(b.lineId))) {
    let missing = target.missingQty;
    const free = Math.min(missing, Math.max(0, freeLeft.get(target.skuId) ?? 0));
    if (free > 0) {
      freeLeft.set(target.skuId, (freeLeft.get(target.skuId) ?? 0) - free);
      plan.free.push({ targetLineId: target.lineId, qty: free });
      missing -= free;
    }
    open.push({ target, missing });
  }

  for (const ready of includeReady ? [false, true] : [false]) {
    for (const row of open) {
      const candidates = sources
        .filter((source) => source.ready === ready && source.skuId === row.target.skuId)
        .sort(
          (a, b) =>
            Number(touched.has(b.shipmentId)) - Number(touched.has(a.shipmentId)) ||
            b.queuedAt - a.queuedAt ||
            a.lineId.localeCompare(b.lineId),
        );
      for (const source of candidates) {
        const qty = Math.min(row.missing, left.get(source.lineId) ?? 0);
        if (qty <= 0) continue;
        left.set(source.lineId, (left.get(source.lineId) ?? 0) - qty);
        row.missing -= qty;
        touched.add(source.shipmentId);
        plan.takes.push({
          sourceLineId: source.lineId,
          sourceShipmentId: source.shipmentId,
          targetLineId: row.target.lineId,
          skuId: source.skuId,
          qty,
          ready,
        });
      }
    }
  }

  plan.missingQty = open.reduce((total, row) => total + row.missing, 0);
  return plan;
}
