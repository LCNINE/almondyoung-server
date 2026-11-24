export type Readiness = 'ready' | 'putaway_required';

export interface ReadyBoxInput {
  shipmentId: string;
  lines: readonly { skuId: string; qty: number }[];
}

export interface SkuBudget {
  /** 바로 집을 수 있는 수량 */
  pickableQty: number;
  /** 적치 대기 중인 수량 */
  inboundPendingQty: number;
}

/**
 * 상자별 준비 판정. `boxes` 는 재고 대기 순번대로 온다. 앞선 상자가 재고를 먼저 쓴다.
 * 바로 집을 수 있는 재고로 다 되면 ready, 적치 대기분까지 써야 되면 putaway_required,
 * 그래도 모자라면 결과에 없고 재고도 쓰지 않는다.
 */
export function judgeReadiness(
  boxes: readonly ReadyBoxInput[],
  budgets: ReadonlyMap<string, SkuBudget>,
): Map<string, Readiness> {
  const left = new Map<string, { pick: number; pend: number }>();
  const remaining = (skuId: string) => {
    let entry = left.get(skuId);
    if (!entry) {
      const b = budgets.get(skuId);
      entry = { pick: Math.max(0, b?.pickableQty ?? 0), pend: Math.max(0, b?.inboundPendingQty ?? 0) };
      left.set(skuId, entry);
    }
    return entry;
  };

  const result = new Map<string, Readiness>();
  for (const box of boxes) {
    const need = new Map<string, number>();
    for (const line of box.lines) need.set(line.skuId, (need.get(line.skuId) ?? 0) + line.qty);

    const entries = [...need].map(([skuId, qty]) => ({ qty, stock: remaining(skuId) }));
    if (entries.every((e) => e.qty <= e.stock.pick)) {
      for (const e of entries) e.stock.pick -= e.qty;
      result.set(box.shipmentId, 'ready');
    } else if (entries.every((e) => e.qty <= e.stock.pick + e.stock.pend)) {
      for (const e of entries) {
        const fromPick = Math.min(e.qty, e.stock.pick);
        e.stock.pick -= fromPick;
        e.stock.pend -= e.qty - fromPick;
      }
      result.set(box.shipmentId, 'putaway_required');
    }
  }
  return result;
}
