import { expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRouter,
  createRootRoute,
  createRoute,
  createMemoryHistory,
  RouterProvider,
  Outlet,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import { InboundHistoryScreen } from './InboundHistoryScreen';
const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};
type Call = { path: string; method?: string; body?: unknown };
function mount(request: ApiClient['request']) {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: InboundHistoryScreen,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const prefs = {
    get: () => JSON.stringify({ id: 'w', name: '시험창고' }),
    set: () => {},
    remove: () => {},
  };
  render(
    <SessionProvider session={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiClientProvider client={{ request }}>
          <WarehouseProvider prefs={prefs}>
            <RouterProvider router={router} />
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
const line = (
  id: string,
  source: 'direct' | 'purchase_order',
  canceled = false
) => ({
  id,
  skuId: id,
  skuName: id === 'd' ? '직접상품' : '발주상품',
  skuCode: id,
  quantity: 4,
  source,
  originLocationCode: 'INBOUND',
  canceledQty: canceled ? 4 : 0,
  returnedQty: 0,
  putawayFromOriginQty: 0,
  canCancel: !canceled,
  cancelBlockReason: canceled ? 'ALREADY_CANCELED' : null,
});
const receipt = (
  id: string,
  source: 'direct' | 'purchase_order',
  canceled = false
) => ({
  id,
  warehouseId: 'w',
  method: 'simple',
  occurredAt: new Date().toISOString(),
  status: canceled ? 'voided' : 'posted',
  totalQuantity: 4,
  lines: [line(id, source, canceled)],
});
it('직접/발주 입고 취소는 각 출처 API를 쓰고 취소 이력을 남긴다', async () => {
  const calls: Call[] = [];
  const canceled = new Set<string>();
  mount((async (opts: Call) => {
    calls.push(opts);
    if (opts.path.startsWith('/inbound/receipts?')) {
      const id = new URL(opts.path, 'https://local').searchParams.get(
        'receiptId'
      );
      const items = [
        receipt('d', 'direct', canceled.has('d')),
        receipt('p', 'purchase_order', canceled.has('p')),
      ].filter((item) => !id || item.id === id);
      return {
        items,
        total: items.length,
        serverTime: new Date().toISOString(),
      };
    }
    if (opts.path === '/inbound/cancel') {
      canceled.add('d');
      return { success: true };
    }
    if (opts.path === '/purchase-orders/receipt-lines/p/cancel') {
      canceled.add('p');
      return { receiptLineId: 'p', poId: 'po', skuId: 'p', quantity: 4 };
    }
    return {};
  }) as ApiClient['request']);
  await userEvent.click(
    await screen.findByRole('button', { name: '직접상품 입고 취소' })
  );
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '전량 취소',
    })
  );
  await waitFor(() =>
    expect(calls.find((c) => c.path === '/inbound/cancel')?.body).toMatchObject(
      { lineId: 'd', quantity: 4 }
    )
  );
  await userEvent.click(
    await screen.findByRole('button', { name: '발주상품 입고 취소' })
  );
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '발주 미입고 수량이 복원'
  );
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '전량 취소',
    })
  );
  await waitFor(() =>
    expect(
      calls.some((c) => c.path === '/purchase-orders/receipt-lines/p/cancel')
    ).toBe(true)
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: '발주상품 입고 취소' })
    ).not.toBeInTheDocument()
  );
  expect(screen.getAllByText('취소됨').length).toBeGreaterThan(0);
});
it('조회 오류를 빈 이력으로 표시하지 않는다', async () => {
  mount((async () => {
    throw new Error('입고내역 연결 실패');
  }) as ApiClient['request']);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '입고내역을 불러오지 못했어요.'
  );
  expect(screen.queryByText('입고내역이 없어요.')).not.toBeInTheDocument();
});
