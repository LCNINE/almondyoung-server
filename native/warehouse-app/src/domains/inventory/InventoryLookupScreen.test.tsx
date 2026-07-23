import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
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
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import { InventoryLookupScreen } from './InventoryLookupScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

function renderWith(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <InventoryLookupScreen />,
  });
  const detail = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inventory/$sku',
    component: () => <div>상세화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, detail]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('InventoryLookupScreen', () => {
  it('searches and shows results with stock in a table', async () => {
    const client: ApiClient = {
      // vi.fn 반환 타입은 ApiClient.request의 제네릭 <T>를 만족 못 하므로 캐스트(httpClient.test.ts의 `doFetch as never`와 같은 패턴).
      request: vi.fn(async () => ({
        items: [
          { id: '1', code: 'SKU-8891', name: '코튼 티', optionKey: '흰색 / M', currentStock: 5, safetyStock: 10 },
        ],
        total: 1,
      })) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    // TanStack Router 의 초기 매치는 비동기다 — render() 직후 동기 getBy 는
    // 아직 라우트가 마운트되기 전이라 실패할 수 있어 findBy 로 기다린다.
    await user.type(await screen.findByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByText('코튼 티')).toBeInTheDocument();
    expect(screen.getByText('SKU-8891')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('부족')).toBeInTheDocument(); // 5 <= safetyStock 10
  });

  it('shows the empty message when there are no results', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => ({ items: [], total: 0 })) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(await screen.findByPlaceholderText(/검색/), '없는상품');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByText('결과가 없어요.')).toBeInTheDocument();
  });

  it('shows a friendly message on error', async () => {
    const client: ApiClient = {
      request: vi.fn(async () => {
        throw new Error('GET /inventory/skus/search/advanced → 500');
      }) as ApiClient['request'],
    };
    const user = userEvent.setup();
    renderWith(client);
    await user.type(await screen.findByPlaceholderText(/검색/), '코튼');
    await user.click(screen.getByRole('button', { name: '검색' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/서버/);
    expect(screen.queryByText('결과가 없어요.')).toBeNull();
  });
});

describe('InventoryLookupScreen — 스캔 진입', () => {
  function Emitter() {
    const bus = useScanBus();
    return (
      <button onClick={() => bus.emit({ code: '8801234567890', source: 'hid', at: 1 })}>
        스캔발사
      </button>
    );
  }

  function renderWithScan(client: ApiClient) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute({ component: Outlet });
    const index = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <>
          <InventoryLookupScreen />
          <Emitter />
        </>
      ),
    });
    const detail = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inventory/$sku',
      component: () => <div>상세화면</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([index, detail]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const wrap = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    return render(<RouterProvider router={router as never} />, { wrapper: wrap });
  }

  it('스캔 결과가 1건이면 상세로 이동한다', async () => {
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) {
          return [{ id: 'sku-1', code: 'CT-001', name: '코튼셔츠', currentStock: 1, safetyStock: 0 }];
        }
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client);

    await userEvent.click(await screen.findByRole('button', { name: '스캔발사' }));

    expect(await screen.findByText('상세화면')).toBeInTheDocument();
  });

  it('스캔 결과가 0건이면 미등록 바코드로 안내한다', async () => {
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) return [];
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client);

    await userEvent.click(await screen.findByRole('button', { name: '스캔발사' }));

    expect(await screen.findByRole('status')).toHaveTextContent('등록되지 않은 바코드예요');
  });

  it('스캔 결과가 여러 건이면 목록으로 보여준다', async () => {
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) {
          return [
            { id: 'sku-1', code: 'CT-001', name: '코튼셔츠', currentStock: 1, safetyStock: 0 },
            { id: 'sku-2', code: 'CT-002', name: '코튼셔츠 L', currentStock: 2, safetyStock: 0 },
          ];
        }
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client);

    await userEvent.click(await screen.findByRole('button', { name: '스캔발사' }));

    expect(await screen.findByText('코튼셔츠 L')).toBeInTheDocument();
  });
});
