import { describe, expect, it } from 'vitest';
import { afterPutaway, returnLocations } from './returnPutaway';

const bin = {
  id: 'b',
  barcode: 'RB-1',
  warehouseId: 'wh',
  items: [
    { skuId: 's-1', skuCode: 'C1', skuName: '볼펜', sourceLocationId: 'l-1', locationCode: 'A-01', qty: 2 },
    { skuId: 's-1', skuCode: 'C1', skuName: '볼펜', sourceLocationId: 'l-2', locationCode: 'B-02', qty: 1 },
    { skuId: 's-2', skuCode: 'C2', skuName: '노트', sourceLocationId: 'l-1', locationCode: 'A-01', qty: 1 },
  ],
};

describe('되돌림 적치 판정', () => {
  it('reads location candidates from the server conflict', () => {
    const locations = [
      { locationCode: 'A-01', qty: 2 },
      { locationCode: 'B-02', qty: 1 },
    ];

    expect(returnLocations(locations)).toEqual(locations);
  });

  it.each([
    undefined,
    null,
    'invalid',
    {},
    [null, {}, { locationCode: 'A', qty: '2' }, { locationCode: 'B', qty: -1 }],
  ])('ignores malformed location candidates: %j', (errors) => {
    expect(returnLocations(errors)).toEqual([]);
  });

  it('적치 뒤 바구니가 비어도 같은 작업자의 바구니를 유지한다', () => {
    expect(afterPutaway(bin, [])).toEqual({ kind: 'product', bin: { ...bin, items: [] } });
    expect(afterPutaway(bin, [bin.items[2]])).toEqual({ kind: 'product', bin: { ...bin, items: [bin.items[2]] } });
  });
});
