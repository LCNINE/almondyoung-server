/** @jest-environment jsdom */
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mutate = jest.fn();
jest.mock('@/lib/services/orders/mutations', () => ({
  useUpdateSalesOrderMemo: () => ({ mutate, isPending: false }),
}));
jest.mock('@/lib/services/orders/order-cs', () => ({
  orderCsKeys: { order: (id: string) => ['cs', 'sales-order', id] },
}));
jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { MemoEditor } from './memo-editor';
import type { MemoDraft } from './cs-drafts';

const client = new QueryClient();
function Host({ memo }: { memo: string }) {
  const [draft, setDraft] = useState<MemoDraft | null>(null);
  return (
    <QueryClientProvider client={client}>
      <MemoEditor
        salesOrderId="o1"
        memo={memo}
        draft={draft}
        onDraft={setDraft}
      />
    </QueryClientProvider>
  );
}
const box = () => screen.getByLabelText<HTMLTextAreaElement>('메모 내용');

beforeEach(() => mutate.mockReset());

it('고치기 시작할 때 본 메모를 함께 보낸다', () => {
  render(<Host memo="처음" />);
  fireEvent.click(screen.getByRole('button', { name: '고치기' }));
  fireEvent.change(box(), { target: { value: '내 글' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(mutate.mock.calls[0][0]).toEqual({
    id: 'o1',
    memo: '내 글',
    expectedMemo: '처음',
  });
});

it('그 사이 바뀌면 저장을 막고 바뀐 메모를 보이며, 붙여서 다시 저장할 수 있다', async () => {
  const view = render(<Host memo="처음" />);
  fireEvent.click(screen.getByRole('button', { name: '고치기' }));
  fireEvent.change(box(), { target: { value: '내 글' } });
  view.rerender(<Host memo="남의 글" />);
  expect(screen.getByText(/다른 사람이 메모를 바꿨어요/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '저장' })).toBeNull();
  expect(box().value).toBe('내 글');
  fireEvent.click(
    screen.getByRole('button', { name: '바뀐 메모 뒤에 내 글 붙이기' })
  );
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(mutate.mock.calls[0][0]).toEqual({
    id: 'o1',
    memo: '남의 글\n내 글',
    expectedMemo: '남의 글',
  });
});

it('409 면 적던 글을 두고 주문을 다시 읽는다', async () => {
  const read = jest.spyOn(client, 'invalidateQueries');
  mutate.mockImplementation((_, o) =>
    o.onError({ response: { status: 409, data: { message: '바뀜' } } })
  );
  render(<Host memo="" />);
  fireEvent.click(screen.getByRole('button', { name: '적기' }));
  fireEvent.change(box(), { target: { value: '내 글' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  await waitFor(() =>
    expect(read).toHaveBeenCalledWith({ queryKey: ['cs', 'sales-order', 'o1'] })
  );
  expect(box().value).toBe('내 글');
});

it('가려진 메모는 고칠 수 없다', () => {
  render(<Host memo="[가림]" />);
  expect(screen.queryByRole('button', { name: '고치기' })).toBeNull();
});
