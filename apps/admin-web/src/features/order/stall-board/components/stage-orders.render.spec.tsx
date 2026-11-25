/** @jest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

const list = jest.fn();
jest.mock('@/lib/services/orders/queries', () => ({
  useOrderProgressOrders: (p: unknown) => list(p),
}));
jest.mock('@/features/order/fulfillments/detail/operation-operator', () => ({
  useOperatorNames: () => () => '',
}));
jest.mock('@/features/order/carrier-tracking/carrier-attention-panel', () => ({
  CarrierAttentionPanel: () => null,
}));
jest.mock('./pending-transfers', () => ({ PendingTransfers: () => null }));
jest.mock('./shortage-split-action', () => ({
  ShortageSplitAction: () => null,
}));
jest.mock('@/features/order/cancel-settlement/settlement-actions', () => ({
  SettlementActions: () => null,
}));
jest.mock('@/features/order/cancel-settlement/manual-refund-todo', () => ({
  ManualRefundTodo: () => null,
}));
jest.mock('../cs/cs-detail', () => ({
  CsDetail: (p: {
    item: { orderNo: string };
    inList: boolean;
    onClose: () => void;
  }) => (
    <div role="region" aria-label="CS 상세">
      {p.item.orderNo} {p.inList ? '목록에 있음' : '목록에 없음'}
      <button onClick={p.onClose}>닫기</button>
    </div>
  ),
}));

import { emptyCsDraft, type CsDrafts } from '../cs/cs-drafts';
import { StageOrders } from './stage-orders';

const item = (id: string) => ({
  salesOrderId: id,
  orderNo: `no-${id}`,
  channelOrderId: id,
  salesChannel: 'medusa',
  customerName: '김하나',
  orderedAt: '2026-11-24T00:00:00Z',
  state: 'created',
  stageEnteredAt: '2026-11-24T00:00:00Z',
  stuck: false,
  settlement: null,
  walletIntentId: null,
  shortage: null,
  cs: {
    customerPhone: '010-1111-2222',
    recipientName: null,
    recipientPhone: null,
    totalAmount: 12000,
    firstItemName: '가위',
    firstItemQty: 1,
    itemCount: 3,
    hasMemo: true,
    lastContact: null,
  },
});
const answer = (ids: string[], more: object = {}) =>
  list.mockReturnValue({
    data: { pages: [{ items: ids.map(item) }] },
    refetch: jest.fn(),
    ...more,
  });

const NOW = new Date('2026-11-24T01:00:00Z');
function Host() {
  const [drafts, setDrafts] = useState<CsDrafts>({});
  return (
    <StageOrders
      stage="fo"
      summary={undefined}
      now={NOW}
      drafts={drafts}
      setDraft={(id, change) =>
        setDrafts((a) => ({ ...a, [id]: change(a[id] ?? emptyCsDraft()) }))
      }
    />
  );
}

beforeEach(() => {
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => 'id',
  });
});

it('줄에서 연락처·상품·금액·메모를 바로 본다', () => {
  answer(['a']);
  render(<Host />);
  const row = screen.getAllByRole('row')[1];
  expect(
    within(row).getByRole('button', {
      name: '주문자 연락처 010-1111-2222 복사',
    })
  ).toBeTruthy();
  expect(within(row).getByText('가위 1개 외 2종')).toBeTruthy();
  expect(within(row).getByText('12,000원')).toBeTruthy();
  expect(within(row).getByText('메모 있음')).toBeTruthy();
});

it('펼친 주문이 목록에서 빠져도 상세가 닫히지 않고, 없어졌다고 알린다', () => {
  answer(['a', 'b']);
  const view = render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: /no-a/ }));
  expect(screen.getByRole('region', { name: 'CS 상세' }).textContent).toContain(
    'no-a 목록에 있음'
  );
  answer(['b']);
  view.rerender(<Host />);
  expect(screen.getByRole('region', { name: 'CS 상세' }).textContent).toContain(
    'no-a 목록에 없음'
  );
  fireEvent.click(screen.getByRole('button', { name: '닫기' }));
  expect(screen.queryByRole('region', { name: 'CS 상세' })).toBeNull();
});

it('«오늘 연락할 주문»은 서버가 거른다', () => {
  answer(['a']);
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: '오늘 연락할 주문' }));
  expect(list).toHaveBeenLastCalledWith(
    expect.objectContaining({ followUpDue: true })
  );
});

it('못 읽은 목록은 «없음»이 아니라 못 읽었다고 한다', () => {
  answer([], { isError: true });
  render(<Host />);
  expect(screen.getByRole('alert').textContent).toContain(
    '목록을 불러오지 못했어요'
  );
  expect(screen.queryByText('이 단계에 머무는 주문 없음')).toBeNull();
});

it('연락처를 싣지 않은 응답은 빈 칸이 아니라 못 불러왔다고 한다', () => {
  list.mockReturnValue({
    data: { pages: [{ items: [{ ...item('a'), cs: null }] }] },
  });
  render(<Host />);
  for (const text of [
    '연락처를 불러오지 못했어요',
    '상품을 불러오지 못했어요',
    '연락 기록을 불러오지 못했어요',
  ])
    expect(screen.getByText(text)).toBeTruthy();
});
