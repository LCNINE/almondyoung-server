import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { QuickInboundScreen } from './QuickInboundScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BOX_SKU = [
  {
    id: 's1',
    code: 'CT-001',
    name: '코튼셔츠',
    currentStock: 0,
    safetyStock: 0,
    barcodes: [
      { id: 'b1', barcode: '8801', isPrimary: true, packingUnit: null },
      { id: 'b2', barcode: '8802', isPrimary: false, packingUnit: 20 },
    ],
  },
];

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

/** ScanEvent 는 at 이 필수다. */
function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      스캔:{code}
    </button>
  );
}

function renderScreen(calls: Call[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/inventory/skus?barcode=880')) return BOX_SKU;
      if (o.path.startsWith('/inventory/skus?barcode=')) return [];
      if (o.path === '/inbound/simple') {
        return { id: 'r-1', lines: [{ id: 'ln-1', skuId: 's1', quantity: 20 }] };
      }
      if (o.path.startsWith('/locations/warehouses/')) return { items: [], total: 0 };
      if (o.path.startsWith('/inbound/pending')) return { totalPendingPlans: 0, totalPendingQuantity: 0, pendingPlans: [] };
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
  });
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="8801" />
        <ScanButton code="8802" />
        <QuickInboundScreen />
      </>
    ),
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

describe('QuickInboundScreen', () => {
  it('스캔하면 카트에 담긴다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    // 라우터 초기 매치가 커밋되기 전에 동기 getByRole 로 스캔 버튼을 찾으면
    // 아직 빈 문서라 실패한다 — 헤더 제목으로 초기 렌더 완료를 기다린다.
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
  });

  it('같은 SKU 를 다시 스캔하면 포장단위만큼 더한다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('코튼셔츠');
    // 박스 바코드(20개입)를 찍으면 1 → 21
    await user.click(screen.getByRole('button', { name: '스캔:8802' }));

    await waitFor(() => expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('21'));
  });

  it('등록하면 카트가 적치 대기 목록으로 바뀐다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8802' }));
    await screen.findByText('코튼셔츠');
    await user.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() => {
      const simple = calls.find((c) => c.path === '/inbound/simple');
      expect(simple?.body).toMatchObject({
        warehouseId: 'w-1',
        items: [{ skuId: 's1', quantity: 20 }],
      });
    });
    expect(await screen.findByText('적치 대기')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치' })).toBeInTheDocument();
  });

  it('빈 카트로는 등록할 수 없다', async () => {
    renderScreen([]);
    expect(await screen.findByRole('button', { name: '등록' })).toBeDisabled();
  });
});
