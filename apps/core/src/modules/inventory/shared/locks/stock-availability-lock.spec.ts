import { sortAndDedupeStockPairs } from './stock-availability-lock';

describe('sortAndDedupeStockPairs', () => {
  it('(skuId, warehouseId) 오름차순 정렬', () => {
    const out = sortAndDedupeStockPairs([
      { skuId: 'b', warehouseId: 'w1' },
      { skuId: 'a', warehouseId: 'w2' },
      { skuId: 'a', warehouseId: 'w1' },
    ]);
    expect(out).toEqual([
      { skuId: 'a', warehouseId: 'w1' },
      { skuId: 'a', warehouseId: 'w2' },
      { skuId: 'b', warehouseId: 'w1' },
    ]);
  });

  it('동일 (sku, warehouse) 중복 제거', () => {
    const out = sortAndDedupeStockPairs([
      { skuId: 'a', warehouseId: 'w1' },
      { skuId: 'a', warehouseId: 'w1' },
    ]);
    expect(out).toEqual([{ skuId: 'a', warehouseId: 'w1' }]);
  });

  it('빈 배열은 빈 배열', () => {
    expect(sortAndDedupeStockPairs([])).toEqual([]);
  });
});
