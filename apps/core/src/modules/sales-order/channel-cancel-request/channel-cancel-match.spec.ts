import { combineRequestLines, takeRequestedIncreases } from './channel-cancel-match';

describe('takeRequestedIncreases — 채널이 아직 안 줄인 정산 중 부분취소(D10)', () => {
  const line = (salesOrderLineId: string, quantity: number) =>
    ({ type: 'cancel_line', salesOrderLineId, channelOrderItemId: `ci-${salesOrderLineId}`, quantity }) as const;
  const qc = (salesOrderLineId: string, quantityBefore: number, correctedQuantity: number) =>
    ({ type: 'quantity_correction', salesOrderLineId, channelOrderItemId: `ci-${salesOrderLineId}`, quantityBefore, correctedQuantity }) as const;

  it('요청 줄과 같은 크기의 늘어남을 먹고 나머지를 돌려준다', () => {
    const address = { type: 'shipping_address_change', before: {}, after: {} } as never;
    const r = takeRequestedIncreases([line('a', 1)], [qc('a', 1, 2), address]);
    expect(r).toEqual({ matched: true, rest: [address] });
  });

  it('크기가 다르면 아무것도 먹지 않는다', () => {
    expect(takeRequestedIncreases([line('a', 1)], [qc('a', 1, 3)])).toEqual({ matched: false });
  });

  it('줄어듦은 늘어남이 아니다', () => {
    expect(takeRequestedIncreases([line('a', 1)], [qc('a', 2, 1)])).toEqual({ matched: false });
  });
});

describe('combineRequestLines — 정산 중 부분취소 여럿의 줄을 판매 줄별로 합친다', () => {
  const line = (salesOrderLineId: string, quantity: number) =>
    ({ type: 'cancel_line', salesOrderLineId, channelOrderItemId: `ci-${salesOrderLineId}`, quantity }) as const;

  it('같은 판매 줄은 수량을 더하고 다른 줄은 그대로 둔다(처음 나온 순서)', () => {
    expect(combineRequestLines([line('a', 1), line('b', 2), line('a', 1)])).toEqual([line('a', 2), line('b', 2)]);
  });

  it('합친 줄로 거울 늘어남 하나를 먹는다', () => {
    const qc = { type: 'quantity_correction', salesOrderLineId: 'a', channelOrderItemId: 'ci-a', quantityBefore: 0, correctedQuantity: 2 } as const;
    expect(takeRequestedIncreases(combineRequestLines([line('a', 1), line('a', 1)]), [qc])).toEqual({ matched: true, rest: [] });
  });

  it('빈 목록은 빈 목록', () => {
    expect(combineRequestLines([])).toEqual([]);
  });
});
