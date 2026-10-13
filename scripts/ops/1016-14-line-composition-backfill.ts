/**
 * #1063 백필의 역산(스펙 §9.1). FO 항목 수량 = FO 생성 당시 유효 수량 × 1개당 수량 이었다. 그런데 FO 생성 «전» 부분 취소가
 * 있었는지는 기록으로 구분되지 않는다 — 그래서 «주문 수량»과 «주문 수량 − 부분 취소 합» 두 후보를 다 대 보고,
 * 하나만 맞으면 쓰고, 둘 다 맞는데 답이 다르면 사람에게 넘긴다.
 */
export interface BackfillLine {
  lineId: string;
  salesOrderId?: string;
  quantity: number;
  cancelledQty: number;
  foItems: Array<{ skuId: string; qty: number; canceledQty: number }>;
}

export type BackfillDecision =
  | { kind: 'ok'; lineId: string; items: Array<{ skuId: string; qtyPerUnit: number }> }
  | { kind: 'ambiguous'; lineId: string; candidates: number[] }
  | { kind: 'indivisible'; lineId: string }
  | { kind: 'cancelled'; lineId: string };

function divide(
  foItems: Array<{ skuId: string; qty: number }>,
  units: number,
): Array<{ skuId: string; qtyPerUnit: number }> | null {
  if (units <= 0) return null;
  if (foItems.some((item) => item.qty % units !== 0 || item.qty <= 0)) return null;
  return foItems
    .map((item) => ({ skuId: item.skuId, qtyPerUnit: item.qty / units }))
    .sort((a, b) => a.skuId.localeCompare(b.skuId));
}

export function deriveComposition(line: BackfillLine): BackfillDecision {
  // 정확한 규칙: FO 뒤 취소는 항목의 canceled_qty 로 남고 qty 는 그대로다(qty = 출고 + 취소 + 활성).
  // 그래서 (qty - canceled) = (주문 - 취소 합) × 1개당 수량 이 된다. 살아 있는 단위가 있을 때만 쓴다.
  const alive = line.quantity - line.cancelledQty;
  const candidates = [...new Set([line.quantity, alive])].filter((u) => u > 0);
  const fits = candidates
    .map((units) => ({ units, items: divide(line.foItems, units) }))
    .filter((c): c is { units: number; items: Array<{ skuId: string; qtyPerUnit: number }> } => c.items !== null);

  if (alive > 0 && line.foItems.length > 0) {
    const live = line.foItems.map((item) => ({ skuId: item.skuId, qty: item.qty - item.canceledQty }));
    const exact = divide(live, alive);
    if (exact) {
      // 두 취소 기록(FO 항목 canceled_qty, 주문 취소 내역)은 어긋날 수 있고 어긋남이 나눠떨어지면 정확 규칙이 자신 있게 틀린다.
      // 틀린 값을 쓰는 것보다 사람에게 넘기는 편이 낫다 — 그래서 옛 두 후보 규칙이 정확 규칙을 반박하면 모호함으로 낮춘다.
      const sameItems = (items: typeof exact) =>
        items.length === exact.length &&
        items.every((it, i) => it.skuId === exact[i].skuId && it.qtyPerUnit === exact[i].qtyPerUnit);
      const noFoSideEvidence = line.foItems.every((item) => item.canceledQty === 0);
      const refutedByAll = fits.length > 0 && !fits.some((f) => sameItems(f.items));
      const unrefutedAmbiguity = fits.length >= 2 && noFoSideEvidence;
      if (refutedByAll || unrefutedAmbiguity) {
        return {
          kind: 'ambiguous',
          lineId: line.lineId,
          candidates: [...new Set([alive, ...fits.map((f) => f.units)])],
        };
      }
      return { kind: 'ok', lineId: line.lineId, items: exact };
    }
  }
  if (fits.length === 0) {
    // 살아 있는 단위가 없거나 항목 수량이 전부 0 이면 구성이 출고에 영향을 주지 않는다 — 사람 판단 대상이 아니다
    const noLiveUnits = alive <= 0 || line.foItems.every((item) => item.qty === 0);
    return { kind: noLiveUnits ? 'cancelled' : 'indivisible', lineId: line.lineId };
  }
  if (fits.length > 1) return { kind: 'ambiguous', lineId: line.lineId, candidates: fits.map((f) => f.units) };
  return { kind: 'ok', lineId: line.lineId, items: fits[0].items };
}
