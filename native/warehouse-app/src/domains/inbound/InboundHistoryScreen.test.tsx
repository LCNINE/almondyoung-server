import {
  createTestWorkRuntime,
  TestWorkProvider,
  receiptFixture,
} from './__fixtures__/workRuntime';
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
async function mount(request: ApiClient['request']) {
  const runtime = createTestWorkRuntime({
    request: async (r) => {
      if (!r.path.startsWith('/inbound/lines/')) return request(r);
      const id = r.path.split('/')[3];
      const history = await request<{ items: ReturnType<typeof receipt>[] }>({
        path: `/inbound/receipts?warehouseId=w&receiptId=${id}&status=all&limit=1&offset=0`,
      });
      const item = history.items.find((item) => item.id === id);
      if (!item) throw new Error('입고내역을 확인해 주세요.');
      const line = item.lines[0];
      return receiptFixture({
        ...line,
        lineId: id,
        receiptId: id,
        warehouseId: 'w',
        receiptStatus: item.status as 'posted' | 'voided',
        cancelBlockReason: line.canCancel ? null : 'CANCELED',
        pendingQty: line.canceledQty ? 0 : line.quantity,
        canPutaway: !line.canceledQty,
        putawayBlockReason: line.canceledQty ? 'CANCELED' : null,
      }) as never;
    },
  });
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
        <TestWorkProvider runtime={runtime}>
          <WarehouseProvider prefs={prefs}>
            <RouterProvider router={router} />
          </WarehouseProvider>
        </TestWorkProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  await waitFor(() =>
    expect(
      screen.queryByText('앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.')
    ).not.toBeInTheDocument()
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
  await mount((async (opts: Call) => {
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
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '전량 취소',
      })
    ).toBeEnabled()
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
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '발주상품 입고 취소' })
    ).toBeEnabled()
  );
  await userEvent.click(
    await screen.findByRole('button', { name: '발주상품 입고 취소' })
  );
  expect(screen.getByRole('dialog')).toHaveTextContent(
    '발주 미입고 수량이 복원'
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '전량 취소',
      })
    ).toBeEnabled()
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
  await mount((async () => {
    throw new Error('입고내역 연결 실패');
  }) as ApiClient['request']);
  expect(
    await screen.findByText(/입고내역을 불러오지 못했어요/)
  ).toBeInTheDocument();
  expect(screen.queryByText('입고내역이 없어요.')).not.toBeInTheDocument();
});
it('다음 페이지 조회 실패 시 이전 이력을 유지하고 취소는 잠근다', async () => {
  await mount((async (opts: Call) => {
    if (opts.path.includes('offset=20')) throw new Error('offline');
    return {
      items: [receipt('d', 'direct')],
      total: 21,
      serverTime: new Date().toISOString(),
    };
  }) as ApiClient['request']);
  await screen.findByRole('button', { name: '직접상품 입고 취소' });
  await userEvent.click(screen.getByRole('button', { name: '다음' }));
  expect(
    await screen.findByText(/입고내역을 불러오지 못했어요/)
  ).toBeInTheDocument();
  expect(screen.getByText('직접상품')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '직접상품 입고 취소' })
  ).not.toBeInTheDocument();
  expect(screen.getByText(/1페이지/)).toBeInTheDocument();
});

it('keeps invalid diagnostic rows visible and valid neighboring actions available', async () => {
  const bad = receipt('bad', 'direct');
  const good = receipt('d', 'direct');
  bad.lines[0] = {
    ...bad.lines[0],
    skuName: '확인필요상품',
    putawayFromOriginQty: -1,
    canCancel: false,
    cancelBlockReason: 'INSUFFICIENT_ORIGIN_STOCK',
    pendingQty: 5,
    canPutaway: false,
    putawayBlockReason: 'ORIGIN_STOCK_INCONSISTENT',
  } as (typeof bad.lines)[0];
  const calls: Call[] = [];
  await mount((async (opts: Call) => {
    calls.push(opts);
    return {
      items: [bad, good],
      total: 2,
      serverTime: new Date().toISOString(),
    };
  }) as ApiClient['request']);
  expect(await screen.findByText('확인필요상품')).toBeInTheDocument();
  expect(screen.getByText('직접상품')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /입고 취소/ })).toHaveLength(1);
  expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(
    true
  );
});
