import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
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
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SkuDetailScreen } from './SkuDetailScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const DETAIL = { id: 'sku-1', code: 'CT-001', name: '코튼셔츠', optionKey: 'M / 흰색', safetyStock: 5, barcodes: [] };
const SUMMARY = {
  skuId: 'sku-1',
  skuName: '코튼셔츠',
  skuCode: 'CT-001',
  totalRealQuantity: 15,
  totalReservedQuantity: 3,
  totalAvailableQuantity: 12,
  warehouseStocks: [
    { warehouseId: 'w-1', warehouseName: '본창고', realQuantity: 15, reservedQuantity: 3, availableQuantity: 12 },
  ],
};
const WAREHOUSE_STOCK = {
  summary: { currentQuantity: 15, availableQuantity: 12, reservedQuantity: 3 },
  details: [
    { locationId: 'l-1', locationCode: 'A-01-02', stockState: 'ON_HAND', quantity: 12 },
    { locationId: 'l-1', locationCode: 'A-01-02', stockState: 'DEFECTIVE', quantity: 3 },
    { locationId: 'l-2', locationCode: 'A-02-01', stockState: 'ON_HAND', quantity: 0 },
  ],
};

function routeFor(path: string) {
  return (client: ApiClient, warehouse?: { id: string; name: string }) => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const prefs = createMemoryPrefs(
      warehouse ? { 'almondwms.warehouse': JSON.stringify(warehouse) } : {}
    );
    const rootRoute = createRootRoute({ component: Outlet });
    const index = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => <SkuDetailScreen skuId="sku-1" />,
    });
    const adjust = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inventory/$sku/adjust',
      component: () => <div>조정화면</div>,
    });
    const inventory = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inventory',
      component: () => <div>목록</div>,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([index, adjust, inventory]),
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    const wrap = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={qc}>
          <ApiClientProvider client={client}>
            <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    return render(<RouterProvider router={router as never} />, { wrapper: wrap });
  };
}

const renderScreen = routeFor('/');

function clientFor(overrides: Record<string, unknown> = {}): ApiClient {
  const table: Record<string, unknown> = {
    '/inventory/skus/sku-1': DETAIL,
    '/inventory/skus/sku-1/stock-summary': SUMMARY,
    '/inventory/stocks/sku/sku-1/warehouse/w-1': WAREHOUSE_STOCK,
    ...overrides,
  };
  return {
    request: (async (opts: { path: string }) => {
      if (!(opts.path in table)) throw new Error(`GET ${opts.path} → 404`);
      return table[opts.path];
    }) as unknown as ApiClient['request'],
  };
}

describe('SkuDetailScreen', () => {
  it('상품명·코드와 합계를 보여준다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByRole('heading', { name: /코튼셔츠/ })).toBeInTheDocument();
    expect(screen.getByText('CT-001')).toBeInTheDocument();
    expect(await screen.findByTestId('total-real')).toHaveTextContent('15');
    expect(screen.getByTestId('total-available')).toHaveTextContent('12');
  });

  it('위치별 행을 보여주고 수량 0 행은 감춘다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    // A-01-02 는 상태(ON_HAND/DEFECTIVE)별로 행이 나뉘어 두 번 나타난다 — 아래 테스트가 검증.
    expect(await screen.findAllByText('A-01-02')).toHaveLength(2);
    expect(screen.queryByText('A-02-01')).not.toBeInTheDocument();
  });

  it('같은 로케이션의 상태별 행을 각각 보여준다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByText('ON_HAND')).toBeInTheDocument();
    expect(screen.getByText('DEFECTIVE')).toBeInTheDocument();
  });

  it('창고 미설정이면 위치별 대신 창고 선택을 보여준다', async () => {
    renderScreen(clientFor());
    expect(await screen.findByText(/창고를 먼저 선택/)).toBeInTheDocument();
    expect(screen.queryByText('A-01-02')).not.toBeInTheDocument();
  });

  it('SKU 조회 실패는 에러 문구를 보여준다', async () => {
    const failing: ApiClient = {
      request: (async () => {
        throw new Error('GET /inventory/skus/sku-1 → 500');
      }) as unknown as ApiClient['request'],
    };
    renderScreen(failing, { id: 'w-1', name: '본창고' });
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 문제가 있어요');
  });
});
