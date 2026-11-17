import { planSecondaryBarcodes, type Barcode2Want } from './barcode2-plan';

const want = (skuId: string, primary: string, secondary: string): Barcode2Want => ({ skuId, primary, secondary });
const none = new Map<string, string>();

describe('planSecondaryBarcodes', () => {
  it('빈 값과 대표와 같은 값은 건너뛴다', () => {
    expect(planSecondaryBarcodes([want('s1', 'P1', ''), want('s2', 'P2', 'P2')], none)).toEqual({
      insert: [],
      alreadyOk: 0,
      conflicts: [],
    });
  });

  it('core 에 없는 값은 넣는다', () => {
    expect(planSecondaryBarcodes([want('s1', 'P1', 'S1')], none).insert).toEqual([{ skuId: 's1', barcode: 'S1' }]);
  });

  it('대표가 비어도 보조로만 넣는다', () => {
    expect(planSecondaryBarcodes([want('s1', '', 'S1')], none).insert).toEqual([{ skuId: 's1', barcode: 'S1' }]);
  });

  it('이미 같은 SKU 에 있으면 그대로 둔다', () => {
    const plan = planSecondaryBarcodes([want('s1', 'P1', 'S1')], new Map([['S1', 's1']]));

    expect(plan.alreadyOk).toBe(1);
    expect(plan.insert).toEqual([]);
  });

  it('다른 SKU 가 점유하면 충돌로만 남긴다', () => {
    const plan = planSecondaryBarcodes([want('s1', 'P1', 'S1')], new Map([['S1', 's9']]));

    expect(plan.insert).toEqual([]);
    expect(plan.conflicts).toEqual([{ skuId: 's1', barcode: 'S1', ownerSkuId: 's9' }]);
  });

  it('대표가 먼저 차지한다', () => {
    const plan = planSecondaryBarcodes([want('s1', 'P1', 'X'), want('s2', 'X', '')], none);

    expect(plan.insert).toEqual([]);
    expect(plan.conflicts).toEqual([{ skuId: 's1', barcode: 'X', ownerSkuId: 's2' }]);
  });

  it('같은 보조 값을 두 SKU 가 원하면 먼저 온 쪽', () => {
    const plan = planSecondaryBarcodes([want('s1', 'P1', 'S'), want('s2', 'P2', 'S')], none);

    expect(plan.insert).toEqual([{ skuId: 's1', barcode: 'S' }]);
    expect(plan.conflicts).toEqual([{ skuId: 's2', barcode: 'S', ownerSkuId: 's1' }]);
  });
});
