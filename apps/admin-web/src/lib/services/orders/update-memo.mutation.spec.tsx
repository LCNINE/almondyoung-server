/**
 * @jest-environment jsdom
 */
import type { ReactNode } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

jest.mock('@/lib/api/domains', () => ({
  orders: {
    salesOrders: { updateSalesOrder: jest.fn() },
    picking: {},
  },
}));
jest.mock('@/lib/api/domains/orders/daily-status.shape', () => ({}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { orders } from '@/lib/api/domains';
import { useUpdateSalesOrderMemo } from './mutations';

const detailsKey = ['sales-orders', 'details', ['o-1', 'o-2']];
const page = (memo: string | null) => [
  { id: 'o-1', memo },
  { id: 'o-2', memo: null },
];

function setup(readDetails: () => Promise<unknown>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // 이미 불러온 페이지 — 관찰자를 붙여도 새로 읽지 않는다
  client.setQueryData(detailsKey, page(null));
  // 목록 화면처럼 상세 조회를 보고 있는 관찰자를 붙인다 — 무효화는 보고 있는 조회만 다시 읽는다
  const observer = new QueryObserver(client, {
    queryKey: detailsKey,
    queryFn: readDetails,
    staleTime: 30_000,
  });
  const unsubscribe = observer.subscribe(() => {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdateSalesOrderMemo(), { wrapper });
  return { client, result, unsubscribe };
}

beforeEach(() => {
  jest
    .mocked(orders.salesOrders.updateSalesOrder)
    .mockReset()
    .mockResolvedValue({ id: 'o-1', status: 'pending' });
});

it('shows the saved memo on that order right away and reads the page again', async () => {
  let reads = 0;
  const { client, result, unsubscribe } = setup(async () => {
    reads += 1;
    return page('새 메모');
  });

  await result.current.mutateAsync({ id: 'o-1', memo: '새 메모' });

  expect(orders.salesOrders.updateSalesOrder).toHaveBeenCalledWith('o-1', {
    memo: '새 메모',
  });
  expect(client.getQueryData(detailsKey)).toEqual(page('새 메모'));
  await waitFor(() => expect(reads).toBe(1));
  unsubscribe();
});

it('does not wait for the page to be read again', async () => {
  const { client, result, unsubscribe } = setup(() => new Promise(() => {}));

  await result.current.mutateAsync({ id: 'o-1', memo: '새 메모' });

  expect(client.getQueryData(detailsKey)).toEqual(page('새 메모'));
  unsubscribe();
});

it('does not let a read started before the save put the old memo back', async () => {
  let releaseOld: (rows: unknown) => void = () => {};
  let reads = 0;
  const { client, result, unsubscribe } = setup(() => {
    reads += 1;
    if (reads === 1) {
      return new Promise((resolve) => {
        releaseOld = resolve;
      });
    }
    return Promise.resolve(page('새 메모'));
  });
  void client.refetchQueries({ queryKey: detailsKey });

  await result.current.mutateAsync({ id: 'o-1', memo: '새 메모' });
  releaseOld(page(null));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(client.getQueryData(detailsKey)).toEqual(page('새 메모'));
  unsubscribe();
});

it('does not let the first read of a page started before the save show the old memo', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  let releaseOld: (rows: unknown) => void = () => {};
  let reads = 0;
  const observer = new QueryObserver(client, {
    queryKey: detailsKey,
    queryFn: () => {
      reads += 1;
      if (reads === 1) {
        return new Promise((resolve) => {
          releaseOld = resolve;
        });
      }
      return Promise.resolve(page('새 메모'));
    },
  });
  const unsubscribe = observer.subscribe(() => {});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(() => useUpdateSalesOrderMemo(), { wrapper });

  await result.current.mutateAsync({ id: 'o-1', memo: '새 메모' });
  releaseOld(page(null));

  await waitFor(() =>
    expect(client.getQueryData(detailsKey)).toEqual(page('새 메모'))
  );
  unsubscribe();
});

it('leaves an order whose detail could not be read unknown', async () => {
  const { client, result, unsubscribe } = setup(() => new Promise(() => {}));
  client.setQueryData(detailsKey, [null, { id: 'o-2', memo: null }]);

  await result.current.mutateAsync({ id: 'o-1', memo: '새 메모' });

  expect(client.getQueryData(detailsKey)).toEqual([
    null,
    { id: 'o-2', memo: null },
  ]);
  unsubscribe();
});

it('drops order details cached for other pages so they are read again before editing', async () => {
  const { client, result, unsubscribe } = setup(async () => page('새 메모'));
  const otherPage = ['sales-orders', 'details', ['o-1', 'o-3']];
  client.setQueryData(otherPage, [{ id: 'o-1', memo: null }]);

  await result.current.mutateAsync({ id: 'o-1', memo: '새 메모' });

  expect(client.getQueryData(otherPage)).toBeUndefined();
  expect(client.getQueryData(detailsKey)).toEqual(page('새 메모'));
  unsubscribe();
});

it('needs the order write and personal data permissions to save', () => {
  expect(useUpdateSalesOrderMemo.permission).toEqual({
    allOf: [['order.order.write'], ['customer.pii.read']],
  });
});
