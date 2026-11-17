import { planMissingBarcodes } from './register-missing-barcodes';

describe('planMissingBarcodes', () => {
  it('아무도 안 쓰는 코드면 전부 insert 한다', () => {
    const plan = planMissingBarcodes(
      [
        { skuId: 's1', code: 'A1' },
        { skuId: 's2', code: 'A2' },
      ],
      new Map(),
    );

    expect(plan.insert).toEqual([
      { skuId: 's1', barcode: 'A1' },
      { skuId: 's2', barcode: 'A2' },
    ]);
    expect(plan.conflicts).toEqual([]);
  });

  it('다른 SKU 가 그 값을 쓰면 conflicts 로 보내고 insert 에서 뺀다', () => {
    const plan = planMissingBarcodes(
      [
        { skuId: 's1', code: 'A1' },
        { skuId: 's2', code: 'A2' },
      ],
      new Map([['A1', 'other']]),
    );

    expect(plan.insert).toEqual([{ skuId: 's2', barcode: 'A2' }]);
    expect(plan.conflicts).toEqual([{ skuId: 's1', barcode: 'A1', ownerSkuId: 'other' }]);
  });

  it('같은 코드가 두 번 들어오면 첫 행만 insert 한다', () => {
    const plan = planMissingBarcodes(
      [
        { skuId: 's1', code: 'A1' },
        { skuId: 's2', code: 'A1' },
      ],
      new Map(),
    );

    expect(plan.insert).toEqual([{ skuId: 's1', barcode: 'A1' }]);
    expect(plan.conflicts).toEqual([{ skuId: 's2', barcode: 'A1', ownerSkuId: 's1' }]);
  });
});
