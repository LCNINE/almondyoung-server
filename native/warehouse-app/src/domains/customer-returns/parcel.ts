import type { ReturnItem, ReturnView } from './types';

export type ParcelCounts = ReadonlyMap<string, number>;

function allItems(view: ReturnView): ReturnItem[] {
  return view.lines.flatMap((l) => l.items);
}

/** 기대 − 이미 도착 − 이번 소포. */
export function remainingOf(item: ReturnItem, counts: ParcelCounts): number {
  return item.expectedQty - item.arrivedQty - (counts.get(item.id) ?? 0);
}

function withCount(counts: ParcelCounts, itemId: string, qty: number) {
  const next = new Map(counts);
  if (qty > 0) next.set(itemId, qty);
  else next.delete(itemId);
  return next;
}

/** N5 — 바코드를 가진 항목 중 남은 수량이 있는 첫 항목에 +1. 포장단위는 무시(낱개로 센다). */
export function scanIntoParcel(
  view: ReturnView,
  counts: ParcelCounts,
  barcode: string
):
  | { kind: 'counted'; counts: ParcelCounts; itemId: string }
  | { kind: 'full'; itemId: string }
  | { kind: 'unknown' } {
  const matches = allItems(view).filter((i) => i.barcodes.includes(barcode));
  if (matches.length === 0) return { kind: 'unknown' };
  const target = matches.find((i) => remainingOf(i, counts) > 0);
  if (!target) return { kind: 'full', itemId: matches[matches.length - 1].id };
  return {
    kind: 'counted',
    counts: withCount(counts, target.id, (counts.get(target.id) ?? 0) + 1),
    itemId: target.id,
  };
}

/** 손 입력 — 항목별 상한은 기대 − 이미 도착. */
export function setParcelCount(
  view: ReturnView,
  counts: ParcelCounts,
  itemId: string,
  qty: number
): { kind: 'ok'; counts: ParcelCounts } | { kind: 'over'; max: number } {
  const item = allItems(view).find((i) => i.id === itemId);
  const max = item ? Math.max(0, item.expectedQty - item.arrivedQty) : 0;
  if (!Number.isInteger(qty) || qty < 0 || qty > max)
    return { kind: 'over', max };
  return { kind: 'ok', counts: withCount(counts, itemId, qty) };
}

export function arrivalItems(
  counts: ParcelCounts
): Array<{ customerReturnItemId: string; quantity: number }> {
  return [...counts]
    .filter(([, q]) => q > 0)
    .map(([customerReturnItemId, quantity]) => ({
      customerReturnItemId,
      quantity,
    }));
}

/** N6 — 이미 받은 소포가 있는 반품은 F10 을 두 번 눌러야 보낸다. */
export function hasPriorArrival(view: ReturnView): boolean {
  return allItems(view).some((i) => i.arrivedQty > 0);
}
