import type { ReturnItem, ReturnView } from './types';

export type InspectionDraft = ReadonlyMap<
  string,
  { rejected: number; held: number }
>;
export type InspectionColumn = 'rejected' | 'held';

function allItems(view: ReturnView): ReturnItem[] {
  return view.lines.flatMap((l) => l.items);
}

function cellOf(draft: InspectionDraft, itemId: string) {
  return draft.get(itemId) ?? { rejected: 0, held: 0 };
}

export function acceptedOf(item: ReturnItem, draft: InspectionDraft): number {
  const c = cellOf(draft, item.id);
  return item.arrivedQty - c.rejected - c.held;
}

/** N7 — 불량·보류만 입력, 합이 도착을 넘으면 거절. */
export function setInspectionCell(
  view: ReturnView,
  draft: InspectionDraft,
  itemId: string,
  column: InspectionColumn,
  qty: number
): { kind: 'ok'; draft: InspectionDraft } | { kind: 'over'; max: number } {
  const item = allItems(view).find((i) => i.id === itemId);
  const cur = cellOf(draft, itemId);
  const other = column === 'rejected' ? cur.held : cur.rejected;
  const max = Math.max(0, (item?.arrivedQty ?? 0) - other);
  if (!Number.isInteger(qty) || qty < 0 || qty > max)
    return { kind: 'over', max };
  const next = new Map(draft);
  next.set(itemId, { ...cur, [column]: qty });
  return { kind: 'ok', draft: next };
}

/** 서버가 «모든 항목 한 번씩»을 요구한다 — 도착 0 인 항목도 0/0/0 으로 싣는다. */
export function inspectionItems(
  view: ReturnView,
  draft: InspectionDraft
): Array<{
  customerReturnItemId: string;
  accepted: number;
  rejected: number;
  held: number;
}> {
  return allItems(view).map((item) => {
    const c = cellOf(draft, item.id);
    return {
      customerReturnItemId: item.id,
      accepted: acceptedOf(item, draft),
      rejected: c.rejected,
      held: c.held,
    };
  });
}

export function heldTotal(draft: InspectionDraft): number {
  let sum = 0;
  for (const c of draft.values()) sum += c.held;
  return sum;
}
