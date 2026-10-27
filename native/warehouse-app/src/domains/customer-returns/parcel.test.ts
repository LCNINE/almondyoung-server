import { describe, expect, it } from 'vitest';
import {
  arrivalItems,
  hasPriorArrival,
  remainingOf,
  scanIntoParcel,
  setParcelCount,
  type ParcelCounts,
} from './parcel';
import { item, view } from './fixtures';

const empty: ParcelCounts = new Map();

describe('scanIntoParcel', () => {
  const v = view([item({ id: 'A' }), item({ id: 'B' })]);
  it('같은 바코드: 첫 스캔 A, 둘째 B, 셋째 full', () => {
    const r1 = scanIntoParcel(v, empty, '880');
    expect(r1).toMatchObject({ kind: 'counted', itemId: 'A' });
    if (r1.kind !== 'counted') throw new Error();
    const r2 = scanIntoParcel(v, r1.counts, '880');
    expect(r2).toMatchObject({ kind: 'counted', itemId: 'B' });
    if (r2.kind !== 'counted') throw new Error();
    expect(scanIntoParcel(v, r2.counts, '880')).toEqual({
      kind: 'full',
      itemId: 'B',
    });
  });
  it('이미 도착분을 뺀다', () => {
    const v2 = view([item({ id: 'A', expectedQty: 2, arrivedQty: 1 })]);
    const r1 = scanIntoParcel(v2, empty, '880');
    if (r1.kind !== 'counted') throw new Error();
    expect(scanIntoParcel(v2, r1.counts, '880').kind).toBe('full');
  });
  it('없는 바코드 -> unknown', () => {
    expect(scanIntoParcel(v, empty, '999')).toEqual({ kind: 'unknown' });
  });
  it('세트 항목은 낱개 두 번', () => {
    const v2 = view([item({ id: 'A', qtyPerUnit: 2, expectedQty: 2 })]);
    const r1 = scanIntoParcel(v2, empty, '880');
    if (r1.kind !== 'counted') throw new Error();
    expect(scanIntoParcel(v2, r1.counts, '880').kind).toBe('counted');
  });
  it('입력 counts 를 바꾸지 않는다', () => {
    scanIntoParcel(v, empty, '880');
    expect(empty.size).toBe(0);
  });
});

describe('setParcelCount', () => {
  const v = view([item({ id: 'A', expectedQty: 2, arrivedQty: 1 })]);
  it('상한 초과 -> over', () => {
    expect(setParcelCount(v, empty, 'A', 2)).toEqual({ kind: 'over', max: 1 });
  });
  it('범위 안 -> ok, 0 은 항목을 뺀다', () => {
    const r = setParcelCount(v, empty, 'A', 1);
    if (r.kind !== 'ok') throw new Error();
    expect(r.counts.get('A')).toBe(1);
    expect(remainingOf(v.lines[0].items[0], r.counts)).toBe(0);
    const z = setParcelCount(v, r.counts, 'A', 0);
    if (z.kind !== 'ok') throw new Error();
    expect(z.counts.has('A')).toBe(false);
  });
});

describe('arrivalItems / hasPriorArrival', () => {
  it('0 은 뺀다', () => {
    const counts: ParcelCounts = new Map([
      ['A', 1],
      ['B', 0],
    ]);
    expect(arrivalItems(counts)).toEqual([
      { customerReturnItemId: 'A', quantity: 1 },
    ]);
  });
  it('어느 항목이든 도착 > 0 이면 true', () => {
    expect(hasPriorArrival(view([item()]))).toBe(false);
    expect(
      hasPriorArrival(view([item(), item({ id: 'x', arrivedQty: 1 })]))
    ).toBe(true);
  });
});
