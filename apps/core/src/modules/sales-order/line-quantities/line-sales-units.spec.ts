import { LineQuantities, LineSkuQuantities } from './line-quantities.reader';
import { cancellableSalesUnits, completedSetUnits, exactSetUnits } from './line-sales-units';

/** 판매 단위 환산만 본다 — 라인 칸은 판정에 쓰이지 않으므로 아무 값이나 둔다. 넘긴 SKU 칸이 기본값을 덮는다. */
function line(
  skus: Array<Pick<LineSkuQuantities, 'skuId' | 'qtyPerUnit'> & Partial<LineSkuQuantities>>,
): LineQuantities {
  return {
    salesOrderLineId: 'l',
    ordered: 0,
    canceledBeforeShipment: 0,
    canceledAfterShipment: 0,
    canceled: 0,
    demand: 0,
    remaining: 0,
    returnHeld: 0,
    skus: skus.map((sku) => ({
      required: sku.outstanding ?? 0,
      outstanding: 0,
      shipped: 0,
      forwarded: 0,
      delivered: 0,
      partnerCompleted: 0,
      returnActive: 0,
      returnConsumed: 0,
      claimable: 0,
      ...sku,
    })),
  };
}

/** A×1·B×2 세트. */
const SET = [
  { skuId: 'a', qtyPerUnit: 1 },
  { skuId: 'b', qtyPerUnit: 2 },
];

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
    ).toThrow('Boxed component progress is inconsistent for SalesOrder line l');
  });

  it('not divisible is not aligned', () => {
    expect(() => cancellableSalesUnits(line([{ skuId: 'a', qtyPerUnit: 2, outstanding: 3 }]))).toThrow(
      'Boxed progress is not aligned for SalesOrder line l',
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
    ).toThrow('Boxed fulfillment SKU x is outside the composition of SalesOrder line l');
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

describe('exactSetUnits', () => {
  const requested = (entries: Record<string, number>) => new Map(Object.entries(entries));

  it('exact whole set', () => {
    expect(exactSetUnits(line(SET), requested({ a: 2, b: 4 }))).toBe(2);
  });

  it('one component only is not a whole set', () => {
    expect(exactSetUnits(line(SET), requested({ b: 2 }))).toBeNull();
  });

  it('not divisible is not a whole set', () => {
    expect(exactSetUnits(line([{ skuId: 'a', qtyPerUnit: 2 }]), requested({ a: 3 }))).toBeNull();
  });

  it('stray sku in the request is not a whole set', () => {
    expect(exactSetUnits(line([{ skuId: 'a', qtyPerUnit: 1 }]), requested({ a: 1, x: 1 }))).toBeNull();
  });

  it('sku outside the frozen composition is not a whole set', () => {
    // 구성에서 빠진 SKU 의 FOI 는 1개당 수량을 모른다(N4) — 그 SKU 를 적은 요청은 세트 수를 정할 수 없다
    expect(
      exactSetUnits(
        line([
          { skuId: 'a', qtyPerUnit: 1 },
          { skuId: 'x', qtyPerUnit: null },
        ]),
        requested({ a: 1, x: 1 }),
      ),
    ).toBeNull();
  });

  it('unfrozen line is not a whole set', () => {
    expect(exactSetUnits(line([{ skuId: 'a', qtyPerUnit: null }]), requested({ a: 1 }))).toBeNull();
  });
});

describe('completedSetUnits', () => {
  it('completed sets take the floor minimum', () => {
    expect(
      completedSetUnits(
        line([
          { skuId: 'a', qtyPerUnit: 1, returnConsumed: 2 },
          { skuId: 'b', qtyPerUnit: 2, returnConsumed: 3 },
        ]),
        (sku) => sku.returnConsumed,
      ),
    ).toBe(1);
  });

  it('completed sets ignore a sku outside the composition', () => {
    expect(
      completedSetUnits(
        line([
          { skuId: 'a', qtyPerUnit: 1, returnConsumed: 2 },
          { skuId: 'x', qtyPerUnit: null, returnConsumed: 0 },
        ]),
        (sku) => sku.returnConsumed,
      ),
    ).toBe(2);
  });

  it('completed sets of an unfrozen line is zero', () => {
    expect(
      completedSetUnits(line([{ skuId: 'a', qtyPerUnit: null, returnConsumed: 3 }]), (sku) => sku.returnConsumed),
    ).toBe(0);
  });
});
