import type { BoxLine, BoxView, ReceiveBoxBody } from './types';

/** core `inbound-shipment-list.parser.ts` 의 상한과 같은 값. 앱엔 공유 사본이 없다. */
export const MAX_LINE_QTY = 1_000_000;

export type CountMethod = 'counted' | 'list';

export interface BoxDraft {
  boxId: string;
  key: string;
  cells: Record<string, { qty: number; method: CountMethod }>;
  unplanned: { skuId: string; skuCode: string; skuName: string; qty: number }[];
  /** 초안을 만든(또는 마지막으로 맞춘) 때의 줄. */
  snapshot: Record<
    string,
    { kind: BoxLine['kind']; skuId: string | null; expectedQty: number | null }
  >;
  /**
   * 이 키로 보낸 확정 본문 — 있으면 결과를 모르는 것이다(칸 잠금). 재전송은 이 본문 그대로, 같은 키로.
   * 확정·거절이 나면 지운다(거절이면 새 키와 함께).
   */
  sentBody?: ReceiveBoxBody | null;
}

const snap = (l: BoxLine) => ({
  kind: l.kind,
  skuId: l.skuId,
  expectedQty: l.expectedQty,
});

const validQty = (q: number) =>
  Number.isInteger(q) && q >= 0 && q <= MAX_LINE_QTY;

export function createBoxDraft(box: BoxView, key: string): BoxDraft {
  const snapshot: BoxDraft['snapshot'] = {};
  for (const l of box.lines) snapshot[l.lineId] = snap(l);
  return { boxId: box.boxId, key, cells: {}, unplanned: [], snapshot };
}

export const isRangeLine = (line: BoxLine): boolean =>
  line.coversBoxLabels.length > 1;

export const canApplyList = (line: BoxLine): boolean =>
  line.kind !== 'unresolved' && !isRangeLine(line) && line.expectedQty !== null;

export function setLineQty(
  draft: BoxDraft,
  lineId: string,
  qty: number,
): BoxDraft {
  if (!validQty(qty)) return draft;
  return {
    ...draft,
    cells: { ...draft.cells, [lineId]: { qty, method: 'counted' } },
  };
}

/** 칸을 빈칸(아직 안 넣음)으로 되돌린다 — 0 과 다르다 */
export function clearLine(draft: BoxDraft, lineId: string): BoxDraft {
  if (!draft.cells[lineId]) return draft;
  const cells = { ...draft.cells };
  delete cells[lineId];
  return { ...draft, cells };
}

export function applyList(draft: BoxDraft, line: BoxLine): BoxDraft {
  if (!canApplyList(line) || line.expectedQty === null) return draft;
  return {
    ...draft,
    cells: {
      ...draft.cells,
      [line.lineId]: { qty: line.expectedQty, method: 'list' },
    },
  };
}

export type ScanTarget =
  | { kind: 'line'; lineId: string }
  | { kind: 'unplanned'; skuId: string };

/**
 * 합계가 상한을 넘기면 `rejected: true` 와 함께 초안을 그대로 돌려준다(호출자가 오류음).
 */
export function applyScan(
  draft: BoxDraft,
  box: BoxView,
  sku: { id: string; code: string; name: string },
  increment: number,
  currentLineId: string | null,
): { draft: BoxDraft; target: ScanTarget; rejected?: true } {
  if (!Number.isInteger(increment) || increment < 1) {
    const target: ScanTarget = { kind: 'unplanned', skuId: sku.id };
    return { draft, target, rejected: true };
  }
  const matches = box.lines.filter(
    (l) => l.kind === 'sku' && l.skuId === sku.id,
  );
  if (matches.length > 0) {
    const line =
      matches.find((l) => l.lineId === currentLineId) ?? matches[0];
    const target: ScanTarget = { kind: 'line', lineId: line.lineId };
    const next = (draft.cells[line.lineId]?.qty ?? 0) + increment;
    if (!validQty(next)) return { draft, target, rejected: true };
    return { draft: setLineQty(draft, line.lineId, next), target };
  }
  const target: ScanTarget = { kind: 'unplanned', skuId: sku.id };
  const existing = draft.unplanned.find((u) => u.skuId === sku.id);
  const next = (existing?.qty ?? 0) + increment;
  if (!validQty(next) || next < 1) return { draft, target, rejected: true };
  const unplanned = existing
    ? draft.unplanned.map((u) => (u.skuId === sku.id ? { ...u, qty: next } : u))
    : [
        ...draft.unplanned,
        { skuId: sku.id, skuCode: sku.code, skuName: sku.name, qty: next },
      ];
  return { draft: { ...draft, unplanned }, target };
}

export function setUnplannedQty(
  draft: BoxDraft,
  skuId: string,
  qty: number,
): BoxDraft {
  if (!validQty(qty)) return draft;
  if (!draft.unplanned.some((u) => u.skuId === skuId)) return draft;
  if (qty === 0) {
    return { ...draft, unplanned: draft.unplanned.filter((u) => u.skuId !== skuId) };
  }
  return {
    ...draft,
    unplanned: draft.unplanned.map((u) => (u.skuId === skuId ? { ...u, qty } : u)),
  };
}

export const blankLineIds = (draft: BoxDraft, box: BoxView): string[] =>
  box.lines.filter((l) => !draft.cells[l.lineId]).map((l) => l.lineId);

/**
 * 관리자가 리스트를 고친 뒤 초안을 지금 상자에 맞춘다.
 * `changedLineIds` 는 kind·skuId·expectedQty 가 바뀌었거나 새로 생긴 줄 전부(칸이 지워졌든 남았든 빈칸이든, 행 순서),
 * 그 뒤에 초안엔 있었는데 상자에서 사라진 줄.
 */
export function reconcileDraft(
  draft: BoxDraft,
  box: BoxView,
): { draft: BoxDraft; changedLineIds: string[] } {
  const cells: BoxDraft['cells'] = {};
  const snapshot: BoxDraft['snapshot'] = {};
  const changedLineIds: string[] = [];
  for (const l of box.lines) {
    snapshot[l.lineId] = snap(l);
    const cell = draft.cells[l.lineId];
    const old = draft.snapshot[l.lineId];
    const identityChanged =
      !old || old.kind !== l.kind || old.skuId !== l.skuId;
    const expectedChanged = !!old && old.expectedQty !== l.expectedQty;
    if (identityChanged || expectedChanged) changedLineIds.push(l.lineId);
    if (!cell) continue;
    if (identityChanged || (expectedChanged && cell.method === 'list')) continue;
    cells[l.lineId] = cell;
  }
  for (const lineId of Object.keys(draft.snapshot)) {
    if (!snapshot[lineId]) changedLineIds.push(lineId);
  }
  return { draft: { ...draft, cells, snapshot }, changedLineIds };
}

export type ConfirmBlock =
  | null
  | { reason: 'blank'; lineIds: string[] }
  | { reason: 'stale_list'; lineIds: string[] }
  | { reason: 'unplanned_on_list'; skuIds: string[] }
  | { reason: 'empty_added_box' }
  | { reason: 'unresolved' }
  | { reason: 'not_stock_open' };

export function confirmBlock(draft: BoxDraft, box: BoxView): ConfirmBlock {
  if (box.disposition !== 'stock' || box.status !== 'open') {
    return { reason: 'not_stock_open' };
  }
  if (box.lines.some((l) => l.kind === 'unresolved')) {
    return { reason: 'unresolved' };
  }
  const blanks = blankLineIds(draft, box);
  if (blanks.length > 0) return { reason: 'blank', lineIds: blanks };
  const stale = box.lines
    .filter((l) => {
      const c = draft.cells[l.lineId];
      return c?.method === 'list' && (!canApplyList(l) || c.qty !== l.expectedQty);
    })
    .map((l) => l.lineId);
  if (stale.length > 0) return { reason: 'stale_list', lineIds: stale };
  const listed = new Set(
    box.lines.filter((l) => l.kind === 'sku' && l.skuId).map((l) => l.skuId),
  );
  const dup = draft.unplanned.filter((u) => listed.has(u.skuId)).map((u) => u.skuId);
  if (dup.length > 0) return { reason: 'unplanned_on_list', skuIds: dup };
  if (box.origin === 'added' && draft.unplanned.length === 0) {
    return { reason: 'empty_added_box' };
  }
  return null;
}

export function toReceiveBody(draft: BoxDraft, box: BoxView): ReceiveBoxBody {
  const block = confirmBlock(draft, box);
  if (block) throw new Error(`상자를 확정할 수 없다: ${block.reason}`);
  return {
    counts: box.lines.map((l) => {
      const c = draft.cells[l.lineId];
      return { lineId: l.lineId, countedQty: c.qty, method: c.method };
    }),
    unplanned: draft.unplanned.map((u) => ({ skuId: u.skuId, quantity: u.qty })),
  };
}

export interface ReviewRow {
  kind: 'diff' | 'range' | 'unplanned';
  label: string;
  expected: number | null;
  counted: number;
  rangeTotal?: number;
  elsewhere?: number;
}

export function reviewRows(draft: BoxDraft, box: BoxView): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const l of box.lines) {
    const counted = draft.cells[l.lineId]?.qty ?? 0;
    const label = l.option ? `${l.productName} ${l.option}` : l.productName;
    if (isRangeLine(l)) {
      rows.push({
        kind: 'range',
        label,
        expected: l.expectedQty,
        counted,
        rangeTotal: l.expectedQty ?? undefined,
        elsewhere: l.alreadyCountedInOtherBoxes,
      });
    } else if (counted !== l.expectedQty) {
      rows.push({ kind: 'diff', label, expected: l.expectedQty, counted });
    }
  }
  for (const u of draft.unplanned) {
    rows.push({ kind: 'unplanned', label: u.skuName, expected: null, counted: u.qty });
  }
  return rows;
}
