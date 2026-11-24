import { planStockPriority, PrioritySourceLine } from './stock-priority.plan';

const target = (missingQty: number, lineId = 't1', skuId = 'sku') => ({ lineId, skuId, missingQty });
const source = (over: Partial<PrioritySourceLine>): PrioritySourceLine => ({
  lineId: 's1',
  shipmentId: 'box1',
  skuId: 'sku',
  reservedQty: 1,
  ready: false,
  queuedAt: 1,
  ...over,
});

describe('planStockPriority', () => {
  it('못 나가는 상자가 잡은 재고를 옮겨 온다', () => {
    const plan = planStockPriority([target(1)], new Map(), [source({})], false);

    expect(plan).toEqual({
      free: [],
      takes: [{ sourceLineId: 's1', sourceShipmentId: 'box1', targetLineId: 't1', skuId: 'sku', qty: 1, ready: false }],
      missingQty: 0,
    });
  });

  it('남는 재고를 먼저 쓰고 모자란 만큼만 옮겨 온다', () => {
    const plan = planStockPriority([target(3)], new Map([['sku', 2]]), [source({ reservedQty: 5 })], false);

    expect(plan.free).toEqual([{ targetLineId: 't1', qty: 2 }]);
    expect(plan.takes.map((take) => take.qty)).toEqual([1]);
  });

  it('뒤에 온 주문부터 가져온다', () => {
    const plan = planStockPriority(
      [target(2)],
      new Map(),
      [
        source({ lineId: 'early', shipmentId: 'early', queuedAt: 1, reservedQty: 5 }),
        source({ lineId: 'late', shipmentId: 'late', queuedAt: 9, reservedQty: 1 }),
      ],
      false,
    );

    expect(plan.takes.map((take) => [take.sourceLineId, take.qty])).toEqual([
      ['late', 1],
      ['early', 1],
    ]);
  });

  it('완전출고 상자는 고르지 않으면 건드리지 않고, 골라도 못 나가는 상자 다음에 쓴다', () => {
    const sources = [
      source({ lineId: 'ready', shipmentId: 'ready', ready: true, queuedAt: 9, reservedQty: 5 }),
      source({ lineId: 'stuck', shipmentId: 'stuck', queuedAt: 1, reservedQty: 1 }),
    ];

    expect(planStockPriority([target(2)], new Map(), sources, false)).toMatchObject({
      takes: [{ sourceLineId: 'stuck', qty: 1 }],
      missingQty: 1,
    });
    expect(planStockPriority([target(2)], new Map(), sources, true)).toMatchObject({
      takes: [
        { sourceLineId: 'stuck', qty: 1, ready: false },
        { sourceLineId: 'ready', qty: 1, ready: true },
      ],
      missingQty: 0,
    });
  });

  it('완전출고 상자를 여럿 쓸 때 이미 건드린 상자를 먼저 쓴다', () => {
    const plan = planStockPriority(
      [target(1, 't1', 'a'), target(1, 't2', 'b')],
      new Map(),
      [
        source({ lineId: 'x-a', shipmentId: 'x', skuId: 'a', ready: true, queuedAt: 9 }),
        source({ lineId: 'x-b', shipmentId: 'x', skuId: 'b', ready: true, queuedAt: 1 }),
        source({ lineId: 'y-b', shipmentId: 'y', skuId: 'b', ready: true, queuedAt: 5 }),
      ],
      true,
    );

    expect(plan.takes.map((take) => take.sourceLineId)).toEqual(['x-a', 'x-b']);
  });

  it('같은 상품 줄이 둘이면 같은 재고를 두 번 쓰지 않는다', () => {
    const plan = planStockPriority([target(1, 't1'), target(1, 't2')], new Map(), [source({ reservedQty: 1 })], false);

    expect(plan.takes).toHaveLength(1);
    expect(plan.missingQty).toBe(1);
  });
});
