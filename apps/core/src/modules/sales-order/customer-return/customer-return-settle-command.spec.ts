import { toSettleItems } from './customer-return-settle-command';

describe('toSettleItems — 줄 단위 수령·폐기 (K8 PR6 N8)', () => {
  it('단품 2개 중 불량 1 → received 1·dismissed 1', () => {
    expect(
      toSettleItems([{ channelOrderItemId: 'i1', quantity: 2, items: [{ qtyPerUnit: 1, rejectedQty: 1 }] }]),
    ).toEqual([{ channelOrderItemId: 'i1', received: 1, dismissed: 1 }]);
  });

  it('세트(A×2·B×1) 2벌, B 불량 1 → dismissed 1·received 1', () => {
    expect(
      toSettleItems([
        {
          channelOrderItemId: 'set',
          quantity: 2,
          items: [
            { qtyPerUnit: 2, rejectedQty: 0 },
            { qtyPerUnit: 1, rejectedQty: 1 },
          ],
        },
      ]),
    ).toEqual([{ channelOrderItemId: 'set', received: 1, dismissed: 1 }]);
  });

  it('세트(A×2·B×1) 2벌, A 불량 3 → dismissed 2(ceil(3/2))', () => {
    expect(
      toSettleItems([
        {
          channelOrderItemId: 'set',
          quantity: 2,
          items: [
            { qtyPerUnit: 2, rejectedQty: 3 },
            { qtyPerUnit: 1, rejectedQty: 0 },
          ],
        },
      ]),
    ).toEqual([{ channelOrderItemId: 'set', received: 0, dismissed: 2 }]);
  });

  it('불량 0 → 전부 received, 줄마다 따로', () => {
    expect(
      toSettleItems([
        { channelOrderItemId: 'a', quantity: 3, items: [{ qtyPerUnit: 1, rejectedQty: 0 }] },
        { channelOrderItemId: 'b', quantity: 1, items: [{ qtyPerUnit: 2, rejectedQty: 0 }] },
      ]),
    ).toEqual([
      { channelOrderItemId: 'a', received: 3, dismissed: 0 },
      { channelOrderItemId: 'b', received: 1, dismissed: 0 },
    ]);
  });

  it('구성품 불량이 줄 수량을 넘어도 dismissed 는 줄 수량까지', () => {
    expect(
      toSettleItems([{ channelOrderItemId: 'i1', quantity: 1, items: [{ qtyPerUnit: 1, rejectedQty: 5 }] }]),
    ).toEqual([{ channelOrderItemId: 'i1', received: 0, dismissed: 1 }]);
  });
});
