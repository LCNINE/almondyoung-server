import { describe, it, expect, vi } from 'vitest';

const platformMock = vi.hoisted(() => ({ value: 'windows' }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => platformMock.value }));
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
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
const TWO_WAREHOUSES = {
  ...SUMMARY,
  totalRealQuantity: 55,
  totalReservedQuantity: 8,
  totalAvailableQuantity: 47,
  warehouseStocks: [
    { warehouseId: 'w-1', warehouseName: '본창고', realQuantity: 15, reservedQuantity: 3, availableQuantity: 12 },
    { warehouseId: 'w-2', warehouseName: '보조창고', realQuantity: 40, reservedQuantity: 5, availableQuantity: 35 },
    { warehouseId: 'w-3', warehouseName: '빈창고', realQuantity: 0, reservedQuantity: 0, availableQuantity: 0 },
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
    '/locations/warehouses/w-1?isSystem=true&limit=100': { items: [], total: 0 },
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
  it('상품명·코드와 선택한 창고의 재고를 창고 이름과 함께 보여준다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByRole('heading', { name: /코튼셔츠/ })).toBeInTheDocument();
    expect(screen.getByText('CT-001')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: '본창고 재고' })).toBeInTheDocument();
    expect(screen.getByTestId('stock-real')).toHaveTextContent('15');
    expect(screen.getByTestId('stock-reserved')).toHaveTextContent('3');
    expect(screen.getByTestId('stock-available')).toHaveTextContent('12');
    expect(screen.getByText('다른 창고에는 재고가 없어요.')).toBeInTheDocument();
  });

  it('라벨 프린터 설정이 있는 스테이션에서만 라벨 출력 패널을 보인다', async () => {
    platformMock.value = 'windows';
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByRole('region', { name: '라벨 출력' })).toBeInTheDocument();
  });

  it('핸드헬드에는 라벨 출력 패널이 없다', async () => {
    platformMock.value = 'android';
    try {
      renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
      await screen.findByRole('heading', { name: /코튼셔츠/ });
      expect(screen.queryByRole('region', { name: '라벨 출력' })).not.toBeInTheDocument();
    } finally {
      platformMock.value = 'windows';
    }
  });

  it('다른 창고 재고와 전체 합계를 선택한 창고와 따로 보여준다', async () => {
    renderScreen(clientFor({ '/inventory/skus/sku-1/stock-summary': TWO_WAREHOUSES }), {
      id: 'w-1',
      name: '본창고',
    });
    expect(await screen.findByTestId('stock-real')).toHaveTextContent('15');
    expect(screen.getByTestId('stock-available')).toHaveTextContent('12');
    const others = screen.getByRole('region', { name: '다른 창고' });
    expect(within(others).getByText('보조창고')).toBeInTheDocument();
    expect(within(others).getByText('실재고 40 · 예약 5 · 가용 35')).toBeInTheDocument();
    expect(within(others).queryByText('빈창고')).not.toBeInTheDocument();
    expect(within(others).getByText('전체 창고 합계 실재고 55 · 예약 8 · 가용 47')).toBeInTheDocument();
  });

  it('다른 창고에만 재고가 있으면 이 창고는 0 으로 보이고 재고가 있는 창고를 알려 준다', async () => {
    renderScreen(
      clientFor({
        '/inventory/skus/sku-1/stock-summary': {
          ...SUMMARY,
          totalRealQuantity: 40,
          totalReservedQuantity: 5,
          totalAvailableQuantity: 35,
          warehouseStocks: [
            { warehouseId: 'w-2', warehouseName: '보조창고', realQuantity: 40, reservedQuantity: 5, availableQuantity: 35 },
          ],
        },
        '/inventory/stocks/sku/sku-1/warehouse/w-1': { summary: null, details: [] },
      }),
      { id: 'w-1', name: '본창고' }
    );
    expect(await screen.findByText('보조창고')).toBeInTheDocument();
    expect(screen.getByTestId('stock-real')).toHaveTextContent('0');
    expect(screen.getByTestId('stock-reserved')).toHaveTextContent('0');
    expect(screen.getByTestId('stock-available')).toHaveTextContent('0');
    expect(await screen.findByText('이 창고에는 재고가 없어요.')).toBeInTheDocument();
    expect(screen.getByText('전체 창고 합계 실재고 40 · 예약 5 · 가용 35')).toBeInTheDocument();
  });

  it('창고 이름은 기기에 저장된 이름보다 서버가 준 지금 이름을 쓴다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '예전이름' });
    expect(await screen.findByRole('heading', { name: '본창고 재고' })).toBeInTheDocument();
  });

  it('창고를 고르지 않았으면 전체 창고 합계라고 밝히고 보여준다', async () => {
    renderScreen(clientFor({ '/inventory/skus/sku-1/stock-summary': TWO_WAREHOUSES }));
    expect(await screen.findByRole('heading', { name: '전체 창고 합계' })).toBeInTheDocument();
    expect(screen.getByTestId('stock-real')).toHaveTextContent('55');
    expect(screen.getByTestId('stock-available')).toHaveTextContent('47');
    expect(screen.queryByRole('region', { name: '다른 창고' })).not.toBeInTheDocument();
  });

  it('위치별 행을 보여주고 수량 0 행은 감춘다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    // A-01-02 는 상태(ON_HAND/DEFECTIVE)별로 행이 나뉘어 두 번 나타난다 — 아래 테스트가 검증.
    expect(await screen.findAllByText('A-01-02')).toHaveLength(2);
    expect(screen.queryByText('A-02-01')).not.toBeInTheDocument();
  });

  it('같은 로케이션의 상태별 행을 각각 보여준다', async () => {
    renderScreen(clientFor(), { id: 'w-1', name: '본창고' });
    expect(await screen.findByText('보관 위치')).toBeInTheDocument();
    expect(screen.getByText('보관 위치 · 불량')).toBeInTheDocument();
    expect(screen.queryByText('ON_HAND')).not.toBeInTheDocument();
    expect(screen.queryByText('DEFECTIVE')).not.toBeInTheDocument();
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

it('권한이 없으면 상품과 위치별 조정 진입을 모두 막는다', async () => {
  renderScreen(
    clientFor({
      '/inventory/work-context': { permissions: { stockAdjust: false } },
    }),
    { id: 'w-1', name: '본창고' }
  );

  expect(await screen.findByText('재고 조정 권한이 없어요. 관리자에게 요청해 주세요.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '재고 조정' })).toBeDisabled();
  for (const button of await screen.findAllByRole('button', { name: '조정' })) {
    expect(button).toBeDisabled();
    expect(button.closest('a')).not.toHaveAttribute('href');
  }
});
