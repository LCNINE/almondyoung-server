import { sumCancelledByLine } from './partial-cancellation';

describe('sumCancelledByLine', () => {
  it('취소 메타데이터의 cancelledLines 를 라인별로 더한다', () => {
    const result = sumCancelledByLine([
      {
        cancelledLines: [
          { salesOrderLineId: 'a', quantity: 1 },
          { salesOrderLineId: 'b', quantity: 2 },
        ],
      },
      { cancelledLines: [{ salesOrderLineId: 'a', quantity: 3 }] },
    ]);
    expect([...result.entries()].sort()).toEqual([
      ['a', 4],
      ['b', 2],
    ]);
  });

  it('형식이 아닌 값은 건너뛴다', () => {
    const result = sumCancelledByLine([
      null,
      {},
      { cancelledLines: 'x' },
      { cancelledLines: [null, { salesOrderLineId: 1, quantity: 1 }, { salesOrderLineId: 'a', quantity: '2' }] },
    ]);
    expect(result.size).toBe(0);
  });
});
