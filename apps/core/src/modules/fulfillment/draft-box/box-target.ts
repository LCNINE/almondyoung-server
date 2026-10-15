import { ConflictException } from '@nestjs/common';
import { CompositionItem, sortComposition } from '../../product-matching/line-composition/line-composition';

/**
 * «박스에 무엇이 들어가야 하나»의 유일한 정의(#1063 스펙 §6.1). 박스 목표 = 라인별 담긴 개수 × 라인 구성.
 * 라인 구성 변경은 구성을, S2(주문 수정 전파)는 개수를 바꿔 같은 함수를 부른다 — 둘이 따로 계산하면 S2 가 상품매칭으로
 * 되돌아가 운영자 지정을 조용히 지운다.
 */
export interface BoxTargetItem {
  salesOrderLineId: string;
  skuId: string;
  qty: number;
}

/** salesOrderLineIds 밖의 박스 줄은 건드리지 않는다 — 합포장 박스의 다른 주문 라인을 지키는 경계다. */
export interface BoxTarget {
  salesOrderLineIds: readonly string[];
  items: readonly BoxTargetItem[];
}

export interface BoxLineView {
  shipmentLineId: string;
  salesOrderLineId: string | null;
  skuId: string;
  qty: number;
}

export interface BoxDiff {
  decreases: Array<{ shipmentLineId: string; qty: number }>;
  increases: Array<{ salesOrderLineId: string; skuId: string; qty: number; shipmentLineId: string | null }>;
}

export function boxTarget(
  unitsByLine: ReadonlyMap<string, number>,
  compositionByLine: ReadonlyMap<string, readonly CompositionItem[]>,
): BoxTarget {
  const salesOrderLineIds = [...unitsByLine.keys()].sort();
  const items: BoxTargetItem[] = [];
  for (const salesOrderLineId of salesOrderLineIds) {
    const units = unitsByLine.get(salesOrderLineId) ?? 0;
    if (units === 0) continue;
    const composition = compositionByLine.get(salesOrderLineId);
    if (!composition || composition.length === 0) throw new Error(`No composition for line ${salesOrderLineId}`);
    for (const entry of sortComposition(composition)) {
      items.push({ salesOrderLineId, skuId: entry.skuId, qty: units * entry.qtyPerUnit });
    }
  }
  return { salesOrderLineIds, items };
}

/**
 * 박스에 담긴 그 라인의 판매 개수(#1063 스펙 §6.2) = 그 라인 SKU 줄 수량 ÷ 옛 구성의 1개당 수량. 옛 구성 SKU 마다 같은 값이
 * 나와야 한다 — 분할로 SKU 가 다른 박스에 갈라졌으면 «이 박스에 몇 개»가 정의되지 않으므로 거절한다.
 */
export function unitsOfLineInBox(
  salesOrderLineId: string,
  boxLines: readonly BoxLineView[],
  composition: readonly CompositionItem[],
): number {
  const qtyBySku = new Map<string, number>();
  for (const line of boxLines) {
    if (line.salesOrderLineId !== salesOrderLineId) continue;
    qtyBySku.set(line.skuId, (qtyBySku.get(line.skuId) ?? 0) + line.qty);
  }
  if (qtyBySku.size === 0) return 0;
  const ambiguous = () =>
    new ConflictException({
      code: 'COMPOSITION_UNITS_AMBIGUOUS',
      message: `Cannot derive how many units of line ${salesOrderLineId} the box holds`,
      salesOrderLineId,
    });
  const known = new Set(composition.map((entry) => entry.skuId));
  if ([...qtyBySku.keys()].some((skuId) => !known.has(skuId))) throw ambiguous();
  const units = composition.map((entry) => {
    const qty = qtyBySku.get(entry.skuId) ?? 0;
    if (qty % entry.qtyPerUnit !== 0) throw ambiguous();
    return qty / entry.qtyPerUnit;
  });
  if (composition.length === 0 || new Set(units).size !== 1) throw ambiguous();
  return units[0];
}

/** 박스 줄과 목표를 (라인, SKU) 로 비교한다. 늘림은 그 (라인, SKU) 의 첫 줄(id 순)에, 줄임은 줄 id 순으로 나눠 뺀다. */
export function diffBox(lines: readonly BoxLineView[], target: BoxTarget): BoxDiff {
  const scope = new Set(target.salesOrderLineIds);
  const key = (salesOrderLineId: string, skuId: string) => `${salesOrderLineId}\u0000${skuId}`;

  const current = new Map<string, { salesOrderLineId: string; skuId: string; lines: BoxLineView[] }>();
  for (const line of [...lines].sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId))) {
    if (line.salesOrderLineId === null || !scope.has(line.salesOrderLineId)) continue;
    const k = key(line.salesOrderLineId, line.skuId);
    const group = current.get(k) ?? { salesOrderLineId: line.salesOrderLineId, skuId: line.skuId, lines: [] };
    group.lines.push(line);
    current.set(k, group);
  }

  const wanted = new Map<string, BoxTargetItem>();
  for (const item of target.items) {
    if (!scope.has(item.salesOrderLineId)) {
      throw new Error(`Target item for line ${item.salesOrderLineId} is outside the target scope`);
    }
    const k = key(item.salesOrderLineId, item.skuId);
    if (wanted.has(k)) throw new Error(`Target has duplicate (line, SKU) ${item.salesOrderLineId}/${item.skuId}`);
    wanted.set(k, item);
  }

  const diff: BoxDiff = { decreases: [], increases: [] };
  for (const [k, group] of current) {
    const have = group.lines.reduce((total, line) => total + line.qty, 0);
    const want = wanted.get(k)?.qty ?? 0;
    if (want > have) {
      diff.increases.push({
        salesOrderLineId: group.salesOrderLineId,
        skuId: group.skuId,
        qty: want - have,
        shipmentLineId: group.lines[0].shipmentLineId,
      });
    }
    let rest = have - want;
    for (const line of group.lines) {
      if (rest <= 0) break;
      const qty = Math.min(rest, line.qty);
      diff.decreases.push({ shipmentLineId: line.shipmentLineId, qty });
      rest -= qty;
    }
  }
  for (const [k, item] of wanted) {
    if (current.has(k) || item.qty === 0) continue;
    diff.increases.push({
      salesOrderLineId: item.salesOrderLineId,
      skuId: item.skuId,
      qty: item.qty,
      shipmentLineId: null,
    });
  }
  diff.decreases.sort((a, b) => a.shipmentLineId.localeCompare(b.shipmentLineId));
  diff.increases.sort((a, b) => key(a.salesOrderLineId, a.skuId).localeCompare(key(b.salesOrderLineId, b.skuId)));
  return diff;
}
