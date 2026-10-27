import { describe, expect, it } from 'vitest';
import {
  acceptedOf,
  heldTotal,
  inspectionItems,
  setInspectionCell,
  type InspectionDraft,
} from './inspection';
import { item, view } from './fixtures';

const empty: InspectionDraft = new Map();

describe('inspection', () => {
  const v = view([item({ id: 'A', expectedQty: 3, arrivedQty: 3 })], {
    status: 'arrived',
  });
  const it0 = v.lines[0].items[0];

  it('기본 양품 = 도착', () => {
    expect(acceptedOf(it0, empty)).toBe(3);
  });
  it('불량 2 -> 양품 1, 보류 2 는 over max 1', () => {
    const r = setInspectionCell(v, empty, 'A', 'rejected', 2);
    if (r.kind !== 'ok') throw new Error();
    expect(acceptedOf(it0, r.draft)).toBe(1);
    expect(setInspectionCell(v, r.draft, 'A', 'held', 2)).toEqual({
      kind: 'over',
      max: 1,
    });
    const h = setInspectionCell(v, r.draft, 'A', 'held', 1);
    if (h.kind !== 'ok') throw new Error();
    expect(heldTotal(h.draft)).toBe(1);
  });
  it('inspectionItems 는 도착 0 항목도 0/0/0 으로 싣는다', () => {
    const closed = view(
      [item({ id: 'A', arrivedQty: 3 }), item({ id: 'B', arrivedQty: 0 })],
      { status: 'arrived', csResolution: { missing: {} } }
    );
    const r = setInspectionCell(closed, empty, 'A', 'rejected', 1);
    if (r.kind !== 'ok') throw new Error();
    expect(inspectionItems(closed, r.draft)).toEqual([
      { customerReturnItemId: 'A', accepted: 2, rejected: 1, held: 0 },
      { customerReturnItemId: 'B', accepted: 0, rejected: 0, held: 0 },
    ]);
  });
});
