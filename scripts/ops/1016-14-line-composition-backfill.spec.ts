import { deriveComposition } from './1016-14-line-composition-backfill';

describe('deriveComposition', () => {
  it('부분 취소가 없으면 주문 수량으로 나눈다', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 2,
        cancelledQty: 0,
        foItems: [{ skuId: 'a', qty: 6, canceledQty: 0 }],
      }),
    ).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [{ skuId: 'a', qtyPerUnit: 3 }],
    });
  });

  it('FO 생성 전 부분 취소였으면 유효 수량으로만 나눠떨어진다', () => {
    // 주문 3, 취소 1 → FO 는 유효 2 × 1개당 1 = 2
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 3,
        cancelledQty: 1,
        foItems: [{ skuId: 'a', qty: 2, canceledQty: 0 }],
      }),
    ).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [{ skuId: 'a', qtyPerUnit: 1 }],
    });
  });

  it('두 후보가 모두 나눠떨어지고 답이 다르면 ambiguous', () => {
    // 정확한 규칙((4-1)÷2)이 안 맞는 기록 불일치 — 주문 4, 취소 2, FO 4: 4÷4=1(FO 뒤 취소) 또는 4÷2=2(FO 전 취소)
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 4,
        cancelledQty: 2,
        foItems: [{ skuId: 'a', qty: 4, canceledQty: 1 }],
      }),
    ).toEqual({
      kind: 'ambiguous',
      lineId: 'l',
      candidates: [4, 2],
    });
  });

  it('어느 후보로도 나눠떨어지지 않으면 indivisible', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 2,
        cancelledQty: 0,
        foItems: [{ skuId: 'a', qty: 3, canceledQty: 0 }],
      }),
    ).toEqual({
      kind: 'indivisible',
      lineId: 'l',
    });
  });

  it('여러 SKU 는 모두 같은 후보로 나눠떨어져야 한다', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 2,
        cancelledQty: 0,
        foItems: [
          { skuId: 'b', qty: 2, canceledQty: 0 },
          { skuId: 'a', qty: 4, canceledQty: 0 },
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
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 1,
        cancelledQty: 1,
        foItems: [{ skuId: 'a', qty: 1, canceledQty: 0 }],
      }),
    ).toEqual({
      kind: 'ok',
      lineId: 'l',
      items: [{ skuId: 'a', qtyPerUnit: 1 }],
    });
  });

  it('FO 뒤 부분 취소는 canceledQty 로 정확히 역산한다 (예전엔 ambiguous)', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 2,
        cancelledQty: 1,
        foItems: [{ skuId: 'a', qty: 2, canceledQty: 1 }],
      }),
    ).toEqual({ kind: 'ok', lineId: 'l', items: [{ skuId: 'a', qtyPerUnit: 1 }] });
  });

  it('FO 뒤 부분 취소, 여러 개 구성', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 3,
        cancelledQty: 1,
        foItems: [{ skuId: 'a', qty: 6, canceledQty: 2 }],
      }),
    ).toEqual({ kind: 'ok', lineId: 'l', items: [{ skuId: 'a', qtyPerUnit: 2 }] });
  });

  it('FO 전 부분 취소는 canceledQty 0 으로 정확히 풀린다', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 3,
        cancelledQty: 1,
        foItems: [{ skuId: 'a', qty: 2, canceledQty: 0 }],
      }),
    ).toEqual({ kind: 'ok', lineId: 'l', items: [{ skuId: 'a', qtyPerUnit: 1 }] });
  });

  it('FO 뒤 전량 취소: 정확한 규칙은 건너뛰고 폴백 후보 1 이 맞아 ok', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 1,
        cancelledQty: 1,
        foItems: [{ skuId: 'a', qty: 1, canceledQty: 1 }],
      }),
    ).toEqual({ kind: 'ok', lineId: 'l', items: [{ skuId: 'a', qtyPerUnit: 1 }] });
  });

  it('옛 경로로 전량 취소돼 FO 수량이 0 이면 cancelled', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 2,
        cancelledQty: 2,
        foItems: [{ skuId: 'a', qty: 0, canceledQty: 0 }],
      }),
    ).toEqual({ kind: 'cancelled', lineId: 'l' });
  });

  it('살아 있는 단위가 있어도 FO 항목 수량이 전부 0 이면 규칙 4 에 따라 cancelled', () => {
    expect(
      deriveComposition({
        lineId: 'l',
        quantity: 1,
        cancelledQty: 0,
        foItems: [{ skuId: 'a', qty: 0, canceledQty: 0 }],
      }),
    ).toEqual({ kind: 'cancelled', lineId: 'l' });
  });
});
