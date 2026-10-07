import { takeRequestedDecreases } from './channel-cancel-match';
import type { ChannelDelta } from '../channel-order-change/channel-order-change.types';

const line = (salesOrderLineId: string, quantity: number) => ({
  type: 'cancel_line' as const,
  salesOrderLineId,
  channelOrderItemId: `ci-${salesOrderLineId}`,
  quantity,
});
const decrease = (salesOrderLineId: string, before: number, after: number): ChannelDelta => ({
  type: 'quantity_correction',
  salesOrderLineId,
  channelOrderItemId: `ci-${salesOrderLineId}`,
  quantityBefore: before,
  correctedQuantity: after,
});
const address: ChannelDelta = {
  type: 'shipping_address_change',
  before: { recipientName: 'a', phone: '1', postalCode: '1', roadAddress: 'x', detailAddress: '1' },
  after: { recipientName: 'a', phone: '1', postalCode: '1', roadAddress: 'y', detailAddress: '1' },
};

describe('takeRequestedDecreases (스펙 §5.4)', () => {
  it('요청 줄마다 «정확히 그 수량만큼» 준 감소가 있으면 그것을 먹고 나머지를 돌려준다', () => {
    expect(takeRequestedDecreases([line('l1', 1)], [decrease('l1', 2, 1), address])).toEqual({ matched: true, rest: [address] });
  });

  it('줄 통째 제거(→0)도 같은 감소다', () => {
    expect(takeRequestedDecreases([line('l1', 2)], [decrease('l1', 2, 0)])).toEqual({ matched: true, rest: [] });
  });

  it.each([
    ['수량이 다름', [decrease('l1', 2, 0)]],
    ['감소가 없음', [address]],
    ['다른 줄', [decrease('l2', 2, 1)]],
  ])('%s → 안 맞음', (_label, deltas) => {
    expect(takeRequestedDecreases([line('l1', 1)], deltas)).toEqual({ matched: false });
  });

  it('요청 줄 하나라도 못 찾으면 안 맞음(일부만 맞음도 안 맞음)', () => {
    expect(takeRequestedDecreases([line('l1', 1), line('l2', 1)], [decrease('l1', 2, 1)])).toEqual({ matched: false });
  });
});
