import { LineQuantities, LineSkuQuantities } from './line-quantities.reader';
import { cancellableSalesUnits } from './line-sales-units';

/** 판매 단위 환산만 본다 — 라인 칸은 판정에 쓰이지 않으므로 아무 값이나 둔다. */
function line(skus: Array<Pick<LineSkuQuantities, 'skuId' | 'qtyPerUnit' | 'outstanding'>>): LineQuantities {
  return {
    salesOrderLineId: 'l',
    ordered: 0,
    canceledBeforeShipment: 0,
    canceledAfterShipment: 0,
    canceled: 0,
    demand: 0,
    remaining: 0,
    skus: skus.map((sku) => ({
      ...sku,
      required: sku.outstanding,
      shipped: 0,
      forwarded: 0,
      delivered: 0,
      partnerCompleted: 0,
    })),
  };
}

describe('cancellableSalesUnits', () => {
  it('single sku outstanding 2 per unit 1 is 2', () => {
    expect(cancellableSalesUnits(line([{ skuId: 'a', qtyPerUnit: 1, outstanding: 2 }]))).toBe(2);
  });

  it('set A×1·B×2 with outstanding 3·6 is 3', () => {
    expect(
      cancellableSalesUnits(
        line([
          { skuId: 'a', qtyPerUnit: 1, outstanding: 3 },
          { skuId: 'b', qtyPerUnit: 2, outstanding: 6 },
        ]),
      ),
    ).toBe(3);
  });

  it('bundle with one shipped component is inconsistent', () => {
    // 조용히 min 을 고르면 일부 구성품만 취소된다 — 거절해야 한다
    expect(() =>
      cancellableSalesUnits(
        line([
          { skuId: 'a', qtyPerUnit: 1, outstanding: 0 },
          { skuId: 'b', qtyPerUnit: 1, outstanding: 1 },
        ]),
      ),
    ).toThrow('V2 component progress is inconsistent for SalesOrder line l');
  });

  it('not divisible is not aligned', () => {
    expect(() => cancellableSalesUnits(line([{ skuId: 'a', qtyPerUnit: 2, outstanding: 3 }]))).toThrow(
      'V2 progress is not aligned for SalesOrder line l',
    );
  });

  it('no frozen composition', () => {
    expect(() => cancellableSalesUnits(line([{ skuId: 'a', qtyPerUnit: null, outstanding: 1 }]))).toThrow(
      'Line composition is not frozen for SalesOrder line l',
    );
  });

  it('stray sku with outstanding is outside the composition', () => {
    expect(() =>
      cancellableSalesUnits(
        line([
          { skuId: 'a', qtyPerUnit: 1, outstanding: 1 },
          { skuId: 'x', qtyPerUnit: null, outstanding: 1 },
        ]),
      ),
    ).toThrow('V2 fulfillment SKU x is outside the composition of SalesOrder line l');
  });

  it('stray sku without outstanding is ignored', () => {
    // 구성에서 빠진 SKU 의 항목은 amend 가 qty 를 줄여 미출고 0 으로 남긴다
    expect(
      cancellableSalesUnits(
        line([
          { skuId: 'a', qtyPerUnit: 1, outstanding: 1 },
          { skuId: 'x', qtyPerUnit: null, outstanding: 0 },
        ]),
      ),
    ).toBe(1);
  });
});
