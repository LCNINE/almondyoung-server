import { deriveComposition } from './1016-14-line-composition-backfill';

describe('deriveComposition', () => {
  it('부분 취소가 없으면 주문 수량으로 나눈다', () => {
    expect(deriveComposition({ lineId: 'l', quantity: 2, cancelledQty: 0, foItems: [{ skuId: 'a', qty: 6 }] })).toEqual(
      {
        kind: 'ok',
        lineId: 'l',
        items: [{ skuId: 'a', qtyPerUnit: 3 }],
      },
    );
  });

  it('FO 생성 전 부분 취소였으면 유효 수량으로만 나눠떨어진다', () => {
    // 주문 3, 취소 1 → FO 는 유효 2 × 1개당 1 = 2
    expect(deriveComposition({ lineId: 'l', quantity: 3, cancelledQty: 1, foItems: [{ skuId: 'a', qty: 2 }] })).toEqual(
      {
        kind: 'ok',
        lineId: 'l',
        items: [{ skuId: 'a', qtyPerUnit: 1 }],
      },
    );
  });

  it('두 후보가 모두 나눠떨어지고 답이 다르면 ambiguous', () => {
    // 주문 4, 취소 2, FO 4: 4÷4=1(FO 뒤 취소) 또는 4÷2=2(FO 전 취소)
    expect(deriveComposition({ lineId: 'l', quantity: 4, cancelledQty: 2, foItems: [{ skuId: 'a', qty: 4 }] })).toEqual(
      {
        kind: 'ambiguous',
        lineId: 'l',
        candidates: [4, 2],
      },
    );
  });

  it('어느 후보로도 나눠떨어지지 않으면 indivisible', () => {
    expect(deriveComposition({ lineId: 'l', quantity: 2, cancelledQty: 0, foItems: [{ skuId: 'a', qty: 3 }] })).toEqual(
      {
        kind: 'indivisible',
        lineId: 'l',
      },
    );
  });

  it('여러 SKU 는 모두 같은 후보로 나눠떨어져야 한다', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 2,
        cancelledQty: 0,
        foItems: [
          { skuId: 'b', qty: 2 },
          { skuId: 'a', qty: 4 },
        ],
      }),
    ).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [
        { skuId: 'a', qtyPerUnit: 2 },
        { skuId: 'b', qtyPerUnit: 1 },
      ],
    });
  });

  it('유효 수량 0 이하 후보는 쓰지 않는다', () => {
    expect(deriveComposition({ lineId: 'l', quantity: 1, cancelledQty: 1, foItems: [{ skuId: 'a', qty: 1 }] })).toEqual(
      {
        kind: 'ok',
        lineId: 'l',
        items: [{ skuId: 'a', qtyPerUnit: 1 }],
      },
    );
  });
});
