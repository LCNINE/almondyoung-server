import { planPartialCancel, PartialCancelRejected, OrderLine, CancelRequestItem } from '../plan-partial-cancel';

const line = (id: string, quantity: number, unitPrice: number, adj = 0): OrderLine => ({
  id, quantity, unitPrice, productId: `p_${id}`, requiresShipping: true,
  adjustments: adj ? [{ amount: adj, code: 'P' }] : [],
});

describe('planPartialCancel', () => {
  it('수량 감소는 비례 할인 재작성, 줄 제거는 재작성 없음', () => {
    const plan = planPartialCancel([line('a', 3, 10000, 3000), line('b', 1, 5000, 500)], [
      { itemId: 'a', quantity: 1 },
      { itemId: 'b', quantity: 1 },
    ]);
    expect(plan.lines).toEqual([
      { itemId: 'a', oldQty: 3, newQty: 2, replaceAdjustments: [{ amount: 2000, code: 'P' }] },
      { itemId: 'b', oldQty: 1, newQty: 0, replaceAdjustments: null },
    ]);
    // a: 10,000 − 1,000 + b: 5,000 − 500
    expect(plan.itemRefundEstimate).toBe(13500);
  });

  it('할인 없는 줄의 수량 감소는 재작성할 것이 없다', () => {
    expect(planPartialCancel([line('a', 2, 1000)], [{ itemId: 'a', quantity: 1 }]).lines[0].replaceAdjustments).toBeNull();
  });

  it.each<[string, CancelRequestItem[]]>([
    ['없는 줄', [{ itemId: 'zz', quantity: 1 }]],
    ['0 이하 수량', [{ itemId: 'a', quantity: 0 }]],
    ['현재 수량 초과', [{ itemId: 'a', quantity: 3 }]],
    ['같은 줄 두 번', [{ itemId: 'a', quantity: 1 }, { itemId: 'a', quantity: 1 }]],
    ['빈 요청', []],
  ])('%s 는 거절한다', (_label, items) => {
    expect(() => planPartialCancel([line('a', 2, 1000)], items)).toThrow(PartialCancelRejected);
  });

  it('모든 줄을 0 으로 만드는 요청은 거절한다 — 전체취소 경로를 써야 한다', () => {
    expect(() => planPartialCancel([line('a', 1, 1000)], [{ itemId: 'a', quantity: 1 }])).toThrow(PartialCancelRejected);
  });
});
