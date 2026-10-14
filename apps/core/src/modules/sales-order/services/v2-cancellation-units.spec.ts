import { outstandingSalesUnits, physicalCancellationByItem } from './v2-cancellation-units';

const item = (id: string, skuId: string, qty: number, shippedQty = 0, canceledQty = 0) => ({
  id,
  skuId,
  qty,
  shippedQty,
  canceledQty,
});

describe('outstandingSalesUnits', () => {
  it('구성 SKU 마다 미출고 ÷ 1개당 수량이 같으면 그 값', () => {
    expect(
      outstandingSalesUnits(
        'l',
        [item('i1', 'a', 6, 0, 2), item('i2', 'b', 2)],
        [
          { skuId: 'a', qtyPerUnit: 2 },
          { skuId: 'b', qtyPerUnit: 1 },
        ],
      ),
    ).toBe(2);
  });

  it('구성 밖 SKU 의 qty 0 항목(구성 변경으로 대체됨)은 무시한다', () => {
    expect(outstandingSalesUnits('l', [item('i1', 'a', 0), item('i2', 'b', 6)], [{ skuId: 'b', qtyPerUnit: 2 }])).toBe(
      3,
    );
  });

  it('FO 생성 전 부분 취소로 FO 항목 수량이 주문 수량의 배수가 아니어도 된다', () => {
    // 주문 3, FO 전 1 취소 → FO 항목 2. 옛 역산(2 % 3)은 여기서 409 였다
    expect(outstandingSalesUnits('l', [item('i1', 'a', 2)], [{ skuId: 'a', qtyPerUnit: 1 }])).toBe(2);
  });

  it('SKU 마다 단위가 다르거나 나눠떨어지지 않으면 409', () => {
    expect(() =>
      outstandingSalesUnits(
        'l',
        [item('i1', 'a', 2), item('i2', 'b', 1)],
        [
          { skuId: 'a', qtyPerUnit: 1 },
          { skuId: 'b', qtyPerUnit: 1 },
        ],
      ),
    ).toThrow(/inconsistent/);
    expect(() => outstandingSalesUnits('l', [item('i1', 'a', 3)], [{ skuId: 'a', qtyPerUnit: 2 }])).toThrow(
      /not aligned/,
    );
  });

  it('구성 밖 SKU 에 미출고가 남아 있거나 구성이 비었으면 409', () => {
    expect(() => outstandingSalesUnits('l', [item('i1', 'a', 1)], [{ skuId: 'b', qtyPerUnit: 1 }])).toThrow(
      /outside the composition/,
    );
    expect(() => outstandingSalesUnits('l', [item('i1', 'a', 1)], [])).toThrow(/not frozen/);
  });
});

describe('physicalCancellationByItem', () => {
  it('판매 단위 × 1개당 수량을 그 SKU 의 항목들에서 id 순으로 미출고만큼 뺀다', () => {
    expect(
      physicalCancellationByItem(
        'l',
        2,
        [item('i2', 'a', 3, 0, 2), item('i1', 'a', 3)],
        [{ skuId: 'a', qtyPerUnit: 2 }],
      ),
    ).toEqual([
      { itemId: 'i1', qty: 3 },
      { itemId: 'i2', qty: 1 },
    ]);
  });

  it('미출고보다 많이 취소하려 하면 400(출고·이미 취소된 수량 포함)', () => {
    expect(() => physicalCancellationByItem('l', 2, [item('i1', 'a', 2, 1)], [{ skuId: 'a', qtyPerUnit: 1 }])).toThrow(
      /includes shipped or already canceled quantity/,
    );
  });
});
