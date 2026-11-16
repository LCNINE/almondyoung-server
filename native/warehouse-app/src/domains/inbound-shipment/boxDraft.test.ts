import { describe, expect, it } from 'vitest';
import {
  MAX_LINE_QTY,
  applyList,
  applyScan,
  blankLineIds,
  canApplyList,
  confirmBlock,
  createBoxDraft,
  isRangeLine,
  reconcileDraft,
  reviewRows,
  setLineQty,
  setUnplannedQty,
  toReceiveBody,
} from './boxDraft';
import type { BoxLine, BoxView } from './types';

const line = (over: Partial<BoxLine> & { lineId: string }): BoxLine => ({
  kind: 'sku',
  skuId: 'sku-1',
  sku: { code: 'C1', name: '합성 SKU 1' },
  productName: '합성 상품',
  option: '',
  expectedQty: 40,
  coversBoxLabels: ['A'],
  alreadyCountedInOtherBoxes: 0,
  remark: '',
  ...over,
});

const box = (over: Partial<BoxView> = {}): BoxView => ({
  shipmentId: 's',
  shipmentName: '11월 2차 배편',
  shipmentStatus: 'receiving',
  expectedArrival: null,
  boxId: 'box-1',
  label: 'A',
  origin: 'list',
  disposition: 'stock',
  status: 'open',
  forwardNote: null,
  receiptId: null,
  receivedAt: null,
  lines: [
    line({ lineId: 'L1' }),
    line({ lineId: 'L2', expectedQty: 10 }),
    line({
      lineId: 'L3',
      skuId: 'sku-2',
      sku: { code: 'C2', name: '합성 SKU 2' },
      expectedQty: 100,
      coversBoxLabels: ['A', 'B'],
      alreadyCountedInOtherBoxes: 30,
      option: '빨강',
    }),
    line({ lineId: 'L4', kind: 'free', skuId: null, sku: null, productName: '자유 줄', expectedQty: 5 }),
  ],
  counts: [],
  ...over,
});

const sku1 = { id: 'sku-1', code: 'C1', name: '합성 SKU 1' };
const fill = (b: BoxView) => {
  let d = createBoxDraft(b, 'k');
  for (const l of b.lines) d = setLineQty(d, l.lineId, 1);
  return d;
};

describe('boxDraft', () => {
  it('새 초안은 전부 빈칸', () => {
    const d = createBoxDraft(box(), 'k');
    expect(d.cells).toEqual({});
    expect(blankLineIds(d, box())).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(d.snapshot.L1).toEqual({ kind: 'sku', skuId: 'sku-1', expectedQty: 40 });
  });

  it('0 과 빈칸은 다르다; 범위 밖은 그대로', () => {
    const d0 = createBoxDraft(box(), 'k');
    const d = setLineQty(d0, 'L1', 0);
    expect(blankLineIds(d, box())).toEqual(['L2', 'L3', 'L4']);
    expect(d.cells.L1).toEqual({ qty: 0, method: 'counted' });
    expect(setLineQty(d0, 'L1', -1)).toBe(d0);
    expect(setLineQty(d0, 'L1', MAX_LINE_QTY + 1)).toBe(d0);
    expect(setLineQty(d0, 'L1', 1.5)).toBe(d0);
  });

  it('리스트대로는 단일 줄만', () => {
    const b = box();
    const d0 = createBoxDraft(b, 'k');
    expect(isRangeLine(b.lines[2])).toBe(true);
    expect(canApplyList(b.lines[2])).toBe(false);
    expect(canApplyList(b.lines[0])).toBe(true);
    expect(applyList(d0, b.lines[0]).cells.L1).toEqual({ qty: 40, method: 'list' });
    expect(applyList(d0, b.lines[2])).toBe(d0);
    expect(canApplyList(line({ lineId: 'x', expectedQty: null }))).toBe(false);
    expect(canApplyList(line({ lineId: 'x', kind: 'unresolved' }))).toBe(false);
  });

  it('스캔: 지금 줄 / 첫 줄 / list→counted / 리스트에 없던 물건', () => {
    const b = box();
    let d = createBoxDraft(b, 'k');
    let r = applyScan(d, b, sku1, 1, 'L2');
    expect(r.target).toEqual({ kind: 'line', lineId: 'L2' });
    expect(r.draft.cells.L2).toEqual({ qty: 1, method: 'counted' });
    r = applyScan(d, b, sku1, 3, 'L4');
    expect(r.target).toEqual({ kind: 'line', lineId: 'L1' });
    expect(r.draft.cells.L1.qty).toBe(3);
    d = applyList(d, b.lines[0]);
    r = applyScan(d, b, sku1, 2, null);
    expect(r.draft.cells.L1).toEqual({ qty: 42, method: 'counted' });
    const other = { id: 'sku-9', code: 'C9', name: '남의 물건' };
    r = applyScan(d, b, other, 1, null);
    expect(r.target).toEqual({ kind: 'unplanned', skuId: 'sku-9' });
    r = applyScan(r.draft, b, other, 1, null);
    expect(r.draft.unplanned).toEqual([
      { skuId: 'sku-9', skuCode: 'C9', skuName: '남의 물건', qty: 2 },
    ]);
  });

  it('스캔이 상한을 넘기면 rejected 로 그대로', () => {
    const b = box();
    const d = setLineQty(createBoxDraft(b, 'k'), 'L1', MAX_LINE_QTY);
    const r = applyScan(d, b, sku1, 1, null);
    expect(r.rejected).toBe(true);
    expect(r.draft).toBe(d);
  });

  it('증가분은 1 이상의 정수만', () => {
    const b = box();
    const d = createBoxDraft(b, 'k');
    for (const inc of [0, -1, 1.5]) {
      const r = applyScan(d, b, sku1, inc, null);
      expect(r.rejected).toBe(true);
      expect(r.draft).toBe(d);
      expect(blankLineIds(r.draft, b)).toContain('L1');
    }
  });

  it('리스트에 없던 물건도 상한에서 거절', () => {
    const b = box();
    const other = { id: 'sku-9', code: 'C9', name: 'n' };
    const d = setUnplannedQty(applyScan(createBoxDraft(b, 'k'), b, other, 1, null).draft, 'sku-9', MAX_LINE_QTY);
    const r = applyScan(d, b, other, 1, null);
    expect(r.rejected).toBe(true);
    expect(r.draft).toBe(d);
  });

  it('setUnplannedQty 모르는 SKU·비정수는 그대로', () => {
    const b = box();
    const other = { id: 'sku-9', code: 'C9', name: 'n' };
    const d = applyScan(createBoxDraft(b, 'k'), b, other, 1, null).draft;
    expect(setUnplannedQty(d, 'nope', 3)).toBe(d);
    expect(setUnplannedQty(d, 'sku-9', 1.5)).toBe(d);
  });

  it('setUnplannedQty 0 은 지운다', () => {
    const b = box();
    const other = { id: 'sku-9', code: 'C9', name: 'n' };
    const d = applyScan(createBoxDraft(b, 'k'), b, other, 5, null).draft;
    expect(setUnplannedQty(d, 'sku-9', 7).unplanned[0].qty).toBe(7);
    expect(setUnplannedQty(d, 'sku-9', 0).unplanned).toEqual([]);
  });

  describe('reconcileDraft', () => {
    it('(a)(b) 예정 숫자 변화', () => {
      const b = box();
      let d = applyList(createBoxDraft(b, 'k'), b.lines[0]);
      d = setLineQty(d, 'L2', 38);
      const b2 = box({
        lines: b.lines.map((l) => (l.lineId === 'L1' || l.lineId === 'L2' ? { ...l, expectedQty: 50 } : l)),
      });
      const r = reconcileDraft(d, b2);
      expect(r.draft.cells.L1).toBeUndefined();
      expect(r.draft.cells.L2).toEqual({ qty: 38, method: 'counted' });
      expect(r.changedLineIds).toEqual(['L1', 'L2']);
      expect(r.draft.snapshot.L1.expectedQty).toBe(50);
    });
    it('(c) SKU 바뀜', () => {
      const b = box();
      const d = setLineQty(createBoxDraft(b, 'k'), 'L1', 5);
      const b2 = box({ lines: b.lines.map((l) => (l.lineId === 'L1' ? { ...l, skuId: 'sku-7' } : l)) });
      const r = reconcileDraft(d, b2);
      expect(r.draft.cells.L1).toBeUndefined();
      expect(r.changedLineIds).toEqual(['L1']);
    });
    it('kind sku→free 는 지우고 알린다', () => {
      const b = box();
      const d = setLineQty(createBoxDraft(b, 'k'), 'L1', 5);
      const b2 = box({ lines: b.lines.map((l) => (l.lineId === 'L1' ? { ...l, kind: 'free' as const } : l)) });
      const r = reconcileDraft(d, b2);
      expect(r.draft.cells.L1).toBeUndefined();
      expect(r.changedLineIds).toEqual(['L1']);
    });
    it('빈칸 줄의 SKU 가 바뀌어도 알린다', () => {
      const b = box();
      const b2 = box({ lines: b.lines.map((l) => (l.lineId === 'L2' ? { ...l, skuId: 'sku-7' } : l)) });
      expect(reconcileDraft(createBoxDraft(b, 'k'), b2).changedLineIds).toEqual(['L2']);
    });
    it('(d) 사라진 줄·새 줄', () => {
      const b = box();
      const d = setLineQty(createBoxDraft(b, 'k'), 'L4', 5);
      const b2 = box({
        lines: [...b.lines.filter((l) => l.lineId !== 'L4'), line({ lineId: 'L5' })],
      });
      const r = reconcileDraft(d, b2);
      expect(r.draft.cells.L4).toBeUndefined();
      expect(r.draft.snapshot.L4).toBeUndefined();
      expect(r.draft.snapshot.L5).toBeDefined();
      expect(blankLineIds(r.draft, b2)).toContain('L5');
      expect(r.changedLineIds).toEqual(['L5']);
    });
    it('(e) 변화 없음', () => {
      const b = box();
      const d = fill(b);
      const r = reconcileDraft(d, b);
      expect(r.changedLineIds).toEqual([]);
      expect(r.draft.cells).toEqual(d.cells);
    });
  });

  describe('confirmBlock', () => {
    it('빈칸', () => {
      const b = box();
      expect(confirmBlock(createBoxDraft(b, 'k'), b)).toEqual({
        reason: 'blank',
        lineIds: ['L1', 'L2', 'L3', 'L4'],
      });
      expect(confirmBlock(fill(b), b)).toBeNull();
    });
    it('added 빈 상자', () => {
      const b = box({ origin: 'added', lines: [] });
      const d = createBoxDraft(b, 'k');
      expect(confirmBlock(d, b)).toEqual({ reason: 'empty_added_box' });
      const other = { id: 'sku-9', code: 'C9', name: 'n' };
      expect(confirmBlock(applyScan(d, b, other, 1, null).draft, b)).toBeNull();
    });
    it('전달용·받은 상자', () => {
      const b = box({ disposition: 'forward' });
      expect(confirmBlock(fill(b), b)).toEqual({ reason: 'not_stock_open' });
      const b2 = box({ status: 'received' });
      expect(confirmBlock(fill(b2), b2)).toEqual({ reason: 'not_stock_open' });
    });
    it('stale_list', () => {
      const b = box();
      const d = fill(b);
      const stale = { ...d, cells: { ...d.cells, L1: { qty: 39, method: 'list' as const }, L3: { qty: 100, method: 'list' as const } } };
      expect(confirmBlock(stale, b)).toEqual({ reason: 'stale_list', lineIds: ['L1', 'L3'] });
    });
    it('unplanned_on_list', () => {
      const b = box();
      const d = { ...fill(b), unplanned: [{ skuId: 'sku-1', skuCode: 'C1', skuName: 'n', qty: 1 }] };
      expect(confirmBlock(d, b)).toEqual({ reason: 'unplanned_on_list', skuIds: ['sku-1'] });
      expect(() => toReceiveBody(d, b)).toThrow();
    });
    it('toReceiveBody 는 not_stock_open 도 던진다', () => {
      const b = box({ disposition: 'forward' });
      expect(() => toReceiveBody(fill(b), b)).toThrow();
    });
    it('unresolved', () => {
      const b = box({ lines: [line({ lineId: 'U', kind: 'unresolved', skuId: null })] });
      expect(confirmBlock(setLineQty(createBoxDraft(b, 'k'), 'U', 1), b)).toEqual({ reason: 'unresolved' });
    });
  });

  it('toReceiveBody', () => {
    const b = box();
    let d = applyList(createBoxDraft(b, 'k'), b.lines[0]);
    for (const id of ['L2', 'L3', 'L4']) d = setLineQty(d, id, 0);
    d = applyScan(d, b, { id: 'sku-9', code: 'C9', name: 'n' }, 2, null).draft;
    expect(toReceiveBody(d, b)).toEqual({
      counts: [
        { lineId: 'L1', countedQty: 40, method: 'list' },
        { lineId: 'L2', countedQty: 0, method: 'counted' },
        { lineId: 'L3', countedQty: 0, method: 'counted' },
        { lineId: 'L4', countedQty: 0, method: 'counted' },
      ],
      unplanned: [{ skuId: 'sku-9', quantity: 2 }],
    });
    expect(() => toReceiveBody(createBoxDraft(b, 'k'), b)).toThrow();
  });

  it('reviewRows', () => {
    const b = box();
    let d = applyList(createBoxDraft(b, 'k'), b.lines[0]); // L1 = 40, same
    d = setLineQty(d, 'L2', 8); // differs
    d = setLineQty(d, 'L3', 70);
    d = setLineQty(d, 'L4', 5); // same
    d = applyScan(d, b, { id: 'sku-9', code: 'C9', name: '남의 물건' }, 2, null).draft;
    expect(reviewRows(d, b)).toEqual([
      { kind: 'diff', label: '합성 상품', expected: 10, counted: 8 },
      { kind: 'range', label: '합성 상품 빨강', expected: 100, counted: 70, rangeTotal: 100, elsewhere: 30 },
      { kind: 'unplanned', label: '남의 물건', expected: null, counted: 2 },
    ]);
  });
});
