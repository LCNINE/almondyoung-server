import { physicalCancellationByItem } from './v2-cancellation-units';

const item = (id: string, skuId: string, qty: number, shippedQty = 0, canceledQty = 0) => ({
  id,
  skuId,
  qty,
  shippedQty,
  canceledQty,
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
