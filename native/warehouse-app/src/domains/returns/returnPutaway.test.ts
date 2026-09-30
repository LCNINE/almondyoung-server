import { describe, expect, it } from 'vitest';
import { afterPutaway, pickTarget } from './returnPutaway';

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
  it('스캔한 상품의 원래 로케이션을 모두 보여 준다(같은 상품이 두 로케이션에서 왔을 수 있다)', () => {
    expect(pickTarget(bin, ['s-1'])).toEqual({
      skuName: '볼펜',
      locations: [
        { locationCode: 'A-01', qty: 2 },
        { locationCode: 'B-02', qty: 1 },
      ],
    });
  });

  it('바구니에 없는 상품이면 null', () => {
    expect(pickTarget(bin, ['s-9'])).toBeNull();
  });

  it('적치 뒤 바구니가 비면 다음 바구니를 받고, 남으면 다음 상품을 받는다', () => {
    expect(afterPutaway(bin, [])).toEqual({ kind: 'bin' });
    expect(afterPutaway(bin, [bin.items[2]])).toEqual({ kind: 'product', bin: { ...bin, items: [bin.items[2]] } });
  });
});
