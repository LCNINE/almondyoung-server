/** @jest-environment jsdom */
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({ orders: { salesOrders: {} } }));
jest.mock('@/lib/api/domains/orders/order-cs.client', () => ({
  orderCsClient: { contacts: jest.fn(), createContact: jest.fn() },
}));
jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/features/order/fulfillments/detail/operation-operator', () => ({
  useOperatorNames: () => () => '박직원',
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { toast } from 'sonner';
import { orderCsClient } from '@/lib/api/domains/orders/order-cs.client';
import { ContactLog } from './contact-log';
import { emptyContactDraft } from './cs-drafts';

let next = 0;
beforeEach(() => {
  next = 0;
  Object.defineProperty(globalThis.crypto, 'randomUUID', {
    configurable: true,
    value: () => `id-${(next += 1)}`,
  });
  jest.mocked(toast.error).mockReset();
  jest.mocked(orderCsClient.contacts).mockReset().mockResolvedValue([]);
  jest.mocked(orderCsClient.createContact).mockReset();
});

function Host() {
  const [draft, setDraft] = useState(emptyContactDraft);
  return <ContactLog salesOrderId="o1" draft={draft} onDraft={setDraft} />;
}
const show = () =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Host />
    </QueryClientProvider>
  );
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: '남기기' }));
const sent = () =>
  jest.mocked(orderCsClient.createContact).mock.calls.map(([d]) => d);

it('응답을 못 받으면 글을 두고 다시 눌러도 같은 요청 id 로 보낸다', async () => {
  jest
    .mocked(orderCsClient.createContact)
    .mockRejectedValueOnce(new Error('Network Error'));
  jest.mocked(orderCsClient.createContact).mockResolvedValueOnce();
  show();
  fireEvent.click(screen.getByRole('button', { name: '통화함' }));
  fireEvent.change(screen.getByLabelText('연락 내용'), {
    target: { value: ' 동의 ' },
  });
  save();
  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('한 번만 남아요')
    )
  );
  expect(screen.getByLabelText<HTMLInputElement>('연락 내용').value).toBe(
    ' 동의 '
  );
  save();
  await waitFor(() => expect(sent()).toHaveLength(2));
  expect(sent()[0]).toMatchObject({
    salesOrderId: 'o1',
    outcome: 'reached',
    body: '동의',
    followUpOn: null,
  });
  expect(sent()[1].id).toBe(sent()[0].id);
  // 저장되면 비우고 다음 글은 새 id 다
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLInputElement>('연락 내용').value).toBe('')
  );
  fireEvent.click(screen.getByRole('button', { name: '부재' }));
  save();
  await waitFor(() => expect(sent()).toHaveLength(3));
  expect(sent()[2].id).not.toBe(sent()[0].id);
});

it('실패한 뒤 내용을 고치면 다른 요청이다', async () => {
  jest.mocked(orderCsClient.createContact).mockRejectedValue(new Error('x'));
  show();
  fireEvent.click(screen.getByRole('button', { name: '통화함' }));
  save();
  await waitFor(() => expect(sent()).toHaveLength(1));
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('연락 내용'), {
    target: { value: '고침' },
  });
  save();
  await waitFor(() => expect(sent()).toHaveLength(2));
  expect(sent()[1].id).not.toBe(sent()[0].id);
});

it('결과를 고르지 않으면 남길 수 없다', async () => {
  show();
  expect(
    screen.getByRole<HTMLButtonElement>('button', { name: '남기기' }).disabled
  ).toBe(true);
  await screen.findByText('아직 연락하지 않았어요.');
});

it('못 읽으면 «없음»이 아니라 못 읽었다고 하고 다시 읽는다', async () => {
  jest.mocked(orderCsClient.contacts).mockRejectedValueOnce(new Error('x'));
  show();
  await screen.findByText('연락 기록을 불러오지 못했어요.');
  expect(screen.queryByText('아직 연락하지 않았어요.')).toBeNull();
  jest.mocked(orderCsClient.contacts).mockResolvedValue([
    {
      id: '1',
      outcome: 'no_answer',
      authorId: 'a',
      at: '2026-11-24T00:00:00Z',
      followUpOn: '2000-01-01',
      body: '',
    },
    {
      id: '2',
      outcome: 'reached',
      authorId: 'a',
      at: '2026-11-23T00:00:00Z',
      followUpOn: '2000-01-02',
      body: '둘째',
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await screen.findByText('둘째');
  // 다시 연락할 날은 가장 최근 기록 것만
  expect(screen.getByText('01-01 다시 연락 — 지남')).toBeTruthy();
  expect(screen.queryByText(/01-02/)).toBeNull();
});
