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
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import type { ExpectedArrivalsResult } from './types';
import { ExpectedArrivalListScreen } from './ExpectedArrivalListScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const ARRIVALS: ExpectedArrivalsResult = {
  warehouseId: 'w-1',
  totalDocuments: 1,
  totalOutstandingQuantity: 12,
  arrivals: [
    {
      source: 'purchase_order',
      documentId: 'po-1',
      type: 'domestic',
      supplier: { id: 's-1', name: '알몬드상사' },
      expectedDate: '2026-09-20',
      totalOutstandingQuantity: 12,
      lines: [
        {
          skuId: 'sku-1',
          skuName: '아몬드 1kg',
          skuCode: 'A-1',
          orderedQty: 20,
          receivedQty: 8,
          outstandingQty: 12,
          expectedArrival: '2026-09-20',
        },
      ],
    },
  ],
};

function renderScreen(prefsSeed?: Record<string, string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      if (o.path.startsWith('/inventory/expected-arrivals')) return ARRIVALS;
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs(prefsSeed);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: ExpectedArrivalListScreen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>{children}</ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

const SELECTED = { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }) };

describe('ExpectedArrivalListScreen', () => {
  it('창고가 없으면 창고 선택을 요구한다', async () => {
    renderScreen();
    expect(await screen.findByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('창고별 GET /inventory/expected-arrivals 를 부르고 발주 카드를 남은 수량과 함께 보여준다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByText('알몬드상사')).toBeInTheDocument();
    expect(screen.getByText('남은 12')).toBeInTheDocument();
  });

  it('카드는 /inbound/purchase-orders/$poId 로 간다', async () => {
    renderScreen(SELECTED);
    const card = await screen.findByRole('link', { name: /알몬드상사/ });
    expect(card).toHaveAttribute('href', '/inbound/purchase-orders/po-1');
  });

  it('간편입고 진입점을 제공한다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByRole('link', { name: '간편입고' })).toBeInTheDocument();
  });
});
