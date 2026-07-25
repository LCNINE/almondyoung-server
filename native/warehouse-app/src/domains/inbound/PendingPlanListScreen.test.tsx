import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
import { PendingPlanListScreen } from './PendingPlanListScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const PENDING = {
  totalPendingPlans: 2,
  totalPendingQuantity: 20,
  pendingPlans: [
    {
      planId: 'p-1',
      warehouseId: 'w-1',
      expectedDate: '2026-07-28T00:00:00.000Z',
      purchaseOrder: { id: 'po-1', type: 'domestic', supplier: { id: 'sup-1', name: '르아리컴퍼니' } },
      items: [
        {
          planItemId: 'pi-1',
          skuId: 's1',
          skuName: '코튼셔츠',
          skuCode: 'CT-001',
          expectedQty: 20,
          receivedQty: 0,
          pendingQty: 20,
        },
      ],
      totalQuantity: 20,
      totalPendingQuantity: 20,
    },
    // 전량 입고된 예정: 서버가 plan.status 를 안 닫아서 items 가 빈 채로 계속 내려온다
    {
      planId: 'p-done',
      warehouseId: 'w-1',
      expectedDate: '2026-07-20T00:00:00.000Z',
      purchaseOrder: { id: 'po-2', type: 'domestic', supplier: { id: 'sup-2', name: '다른업체' } },
      items: [],
      totalQuantity: 0,
      totalPendingQuantity: 0,
    },
  ],
};

function renderScreen(prefsSeed?: Record<string, string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      if (o.path.startsWith('/inbound/pending')) return PENDING;
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs(prefsSeed);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: PendingPlanListScreen,
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

describe('PendingPlanListScreen', () => {
  it('창고가 없으면 창고 선택을 요구한다', async () => {
    renderScreen();
    expect(await screen.findByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('예정을 발주처와 잔여수량으로 보여준다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByText('르아리컴퍼니')).toBeInTheDocument();
    expect(screen.getByText('잔여 20')).toBeInTheDocument();
  });

  it('잔여 항목이 없는 예정은 감춘다', async () => {
    renderScreen(SELECTED);
    await waitFor(() => expect(screen.getByText('르아리컴퍼니')).toBeInTheDocument());
    expect(screen.queryByText('다른업체')).not.toBeInTheDocument();
  });

  it('간편입고 진입점을 제공한다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByRole('link', { name: '간편입고' })).toBeInTheDocument();
  });
});
