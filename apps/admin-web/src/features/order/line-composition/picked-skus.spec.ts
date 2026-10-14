import {
  addPicked,
  pickedFromComposition,
  removePicked,
  setPickedQuantity,
  toCompositionItems,
} from './picked-skus';

const a = { skuId: 'a', skuName: 'A', quantity: 1 };

describe('picked skus', () => {
  it('adds a new SKU with quantity 1 and refuses a duplicate', () => {
    expect(addPicked([], { id: 'a', name: 'A' })).toEqual({ ok: true, list: [a] });
    expect(addPicked([a], { id: 'a', name: 'A' })).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('removes by skuId', () => {
    expect(removePicked([a, { ...a, skuId: 'b' }], 'a')).toEqual([{ ...a, skuId: 'b' }]);
  });

  it('keeps quantity a positive integer (0·소수·NaN → 1 이상 정수)', () => {
    expect(setPickedQuantity([a], 'a', 3.7)[0].quantity).toBe(3);
    expect(setPickedQuantity([a], 'a', 0)[0].quantity).toBe(1);
    expect(setPickedQuantity([a], 'a', Number('x'))[0].quantity).toBe(1);
  });

  it('converts between line composition and picked list', () => {
    const picked = pickedFromComposition([{ skuId: 'a', skuCode: 'C', skuName: 'A', qtyPerUnit: 2 }]);
    expect(picked).toEqual([{ skuId: 'a', skuName: 'A', quantity: 2 }]);
    expect(toCompositionItems(picked)).toEqual([{ skuId: 'a', qtyPerUnit: 2 }]);
  });
});
