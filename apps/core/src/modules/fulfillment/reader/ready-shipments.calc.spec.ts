import { judgeReadiness, ReadyBoxInput, SkuBudget } from './ready-shipments.calc';

const box = (shipmentId: string, ...lines: [string, number][]): ReadyBoxInput => ({
  shipmentId,
  lines: lines.map(([skuId, qty]) => ({ skuId, qty })),
});
const budgets = (o: Record<string, [number, number]>): Map<string, SkuBudget> =>
  new Map(Object.entries(o).map(([k, [pickableQty, inboundPendingQty]]) => [k, { pickableQty, inboundPendingQty }]));

describe('judgeReadiness', () => {
  it('바로 집을 수 있는 재고로 다 되면 ready', () => {
    const r = judgeReadiness([box('A', ['X', 2])], budgets({ X: [2, 0] }));
    expect(r.get('A')).toBe('ready');
  });

  it('적치 대기분이 있어야 되면 putaway_required', () => {
    const r = judgeReadiness([box('A', ['X', 2])], budgets({ X: [1, 1] }));
    expect(r.get('A')).toBe('putaway_required');
  });

  it('대기분까지 써도 모자라면 빠진다', () => {
    const r = judgeReadiness([box('A', ['X', 2])], budgets({ X: [1, 0] }));
    expect(r.has('A')).toBe(false);
  });

  it('앞선 상자가 먼저 쓴다', () => {
    const r = judgeReadiness([box('A', ['X', 1]), box('B', ['X', 1])], budgets({ X: [1, 1] }));
    expect(r.get('A')).toBe('ready');
    expect(r.get('B')).toBe('putaway_required');
  });

  it('여러 상품 상자는 모든 상품이 되어야 하고, 빠진 상자는 재고를 쓰지 않는다', () => {
    const r = judgeReadiness([box('A', ['X', 1], ['Y', 1]), box('B', ['X', 1])], budgets({ X: [1, 0], Y: [0, 0] }));
    expect(r.has('A')).toBe(false);
    expect(r.get('B')).toBe('ready');
  });

  it('같은 상품 줄이 둘이면 합쳐 센다', () => {
    const r = judgeReadiness([box('A', ['X', 1], ['X', 2])], budgets({ X: [2, 0] }));
    expect(r.has('A')).toBe(false);
  });

  it('예산이 없는 상품은 0', () => {
    expect(judgeReadiness([box('A', ['X', 1])], new Map()).has('A')).toBe(false);
  });

  it('입력을 바꾸지 않는다', () => {
    const b = budgets({ X: [1, 1] });
    judgeReadiness([box('A', ['X', 2])], b);
    expect(b.get('X')).toEqual({ pickableQty: 1, inboundPendingQty: 1 });
  });
});
