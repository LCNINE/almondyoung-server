import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
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
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { MovementScreen } from './MovementScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const CONTENTS = {
  locationId: 'l-src',
  locationCode: 'A-01-02',
  warehouseId: 'w-1',
  items: [
    { skuId: 's1', skuCode: 'CT-001', skuName: '코튼셔츠', stockState: 'ON_HAND', quantity: 12 },
    { skuId: 's2', skuCode: 'DF-002', skuName: '불량품', stockState: 'DEFECTIVE', quantity: 2 },
  ],
};

function makeClient(calls: Array<{ path: string; method?: string; body?: unknown }>): ApiClient {
  return {
    request: (async (opts: { path: string; method?: string; body?: unknown }) => {
      calls.push({ path: opts.path, method: opts.method, body: opts.body });
      if (opts.path.startsWith('/locations/warehouses/')) {
        if (opts.path.includes('A-01')) {
          return { items: [{ id: 'l-src', code: 'A-01-02', displayName: 'A-01-02' }], total: 1 };
        }
        if (opts.path.includes('B-05')) {
          return { items: [{ id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' }], total: 1 };
        }
        return { items: [], total: 0 };
      }
      if (opts.path === '/inventory/stocks/location/l-src') return CONTENTS;
      if (opts.path === '/movement/move') return {};
      throw new Error(`GET ${opts.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderScreen(client: ApiClient, withWarehouse = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs(
    withWarehouse ? { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }) } : {}
  );
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <MovementScreen />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <ScanProvider>
            <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
          </ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

// 출발지 A-01-02 를 골라 내용물 모드로 진입시키는 공통 절차.
async function pickSource() {
  await userEvent.type(await screen.findByLabelText('출발 로케이션 검색'), 'A-01');
  await userEvent.click(await screen.findByRole('button', { name: /A-01-02/ }));
}

describe('MovementScreen', () => {
  it('창고 미설정이면 창고 선택을 안내한다', async () => {
    renderScreen(makeClient([]), false);
    expect(await screen.findByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('출발지를 고르면 ON_HAND 품목만 보여준다(불량품 제외)', async () => {
    renderScreen(makeClient([]));
    await pickSource();
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.queryByText('불량품')).not.toBeInTheDocument();
  });

  it('품목·대상지·수량을 갖추면 확인 후 이동을 보낸다', async () => {
    const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
    renderScreen(makeClient(calls));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    // 대상지 선택
    await userEvent.type(await screen.findByLabelText('대상 로케이션 검색'), 'B-05');
    await userEvent.click(await screen.findByRole('button', { name: /B-05-03/ }));
    // 이동 실행
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    const dialog = await screen.findByRole('dialog', { name: '재고 이동' });
    await userEvent.click(within(dialog).getByRole('button', { name: '이동' }));

    const move = calls.find((c) => c.path === '/movement/move');
    expect(move?.method).toBe('POST');
    expect(move?.body).toMatchObject({
      warehouseId: 'w-1',
      lines: [{ skuId: 's1', fromLocationId: 'l-src', toLocationId: 'l-dst', quantity: 12 }],
    });
  });

  it('이동 성공 후 시트를 닫고 재오픈 시 직전 대상지 칩을 보여준다', async () => {
    renderScreen(makeClient([]));
    await pickSource();

    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    await userEvent.type(await screen.findByLabelText('대상 로케이션 검색'), 'B-05');
    await userEvent.click(await screen.findByRole('button', { name: /B-05-03/ }));
    await userEvent.click(screen.getByRole('button', { name: '이동하기' }));
    const dialog = await screen.findByRole('dialog', { name: '재고 이동' });
    await userEvent.click(within(dialog).getByRole('button', { name: '이동' }));

    // 시트가 닫힌다(품목 이동 다이얼로그 사라짐).
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: '품목 이동' })).not.toBeInTheDocument()
    );
    // 재오픈 → 직전 대상지 칩.
    await userEvent.click(await screen.findByRole('button', { name: '이동' }));
    expect(await screen.findByRole('button', { name: '직전 대상지 B-05-03 사용' })).toBeInTheDocument();
  });

  it('대상 로케이션 목록에서 출발지는 제외된다', async () => {
    renderScreen(makeClient([]));
    await pickSource();
    await userEvent.click(await screen.findByRole('button', { name: '이동' }));

    // 대상지 검색에 출발지 코드를 넣어도(같은 l-src) 목록에서 걸러진다.
    await userEvent.type(await screen.findByLabelText('대상 로케이션 검색'), 'A-01');
    await waitFor(() => {
      const sheet = screen.getByRole('dialog', { name: '품목 이동' });
      expect(within(sheet).queryByRole('button', { name: /A-01-02/ })).not.toBeInTheDocument();
    });
  });
});
