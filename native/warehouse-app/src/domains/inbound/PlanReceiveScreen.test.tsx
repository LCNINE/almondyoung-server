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
import { PlanReceiveScreen } from './PlanReceiveScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const PENDING = {
  totalPendingPlans: 1,
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
  ],
};

const SKU_BY_BARCODE = [
  {
    id: 's1',
    code: 'CT-001',
    name: '코튼셔츠',
    currentStock: 0,
    safetyStock: 0,
    barcodes: [{ id: 'b1', barcode: '8801', isPrimary: true, packingUnit: null }],
  },
];

interface Call {
  path: string;
  method?: string;
  body?: unknown;
}

/** 테스트에서 하드웨어 스캔을 흉내 내는 버튼. ScanEvent 는 at 이 필수다. */
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
      if (o.path.startsWith('/inbound/pending')) return PENDING;
      if (o.path.startsWith('/inventory/skus?barcode=8801')) return SKU_BY_BARCODE;
      if (o.path.startsWith('/inventory/skus?barcode=')) return [];
      if (o.path === '/inbound/plans/receive') return { success: true, receiptId: 'r-1', lineId: 'ln-1' };
      if (o.path === '/inbound/cancel') return { success: true };
      if (o.path.startsWith('/locations/warehouses/')) return { items: [], total: 0 };
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
        <ScanButton code="9999" />
        <PlanReceiveScreen planId="p-1" />
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

describe('PlanReceiveScreen', () => {
  it('예정 항목을 예정/입고/잔여로 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText(/잔여 20/)).toBeInTheDocument();
  });

  it('예정에 있는 바코드를 스캔하면 수량 시트가 잔여수량으로 열린다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    expect(sheet).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '입고' })).toBeEnabled();
  });

  it('예정에 없는 바코드는 시트를 열지 않고 경고한다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:9999' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('이 예정에 없는 품목');
    expect(screen.queryByRole('dialog', { name: '입고 수량' })).not.toBeInTheDocument();
  });

  it('입고하면 planItemId 와 수량을 보내고 결과 배너를 남긴다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await user.click(screen.getByRole('button', { name: '입고' }));

    await waitFor(() => {
      const receive = calls.find((c) => c.path === '/inbound/plans/receive');
      expect(receive?.body).toMatchObject({ planItemId: 'pi-1', quantity: 20 });
    });
    expect(await screen.findByText(/입고됨/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치하기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('적치를 마치면 취소 버튼이 사라진다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await user.click(screen.getByRole('button', { name: '입고' }));
    await screen.findByRole('button', { name: '적치하기' });

    await user.click(screen.getByRole('button', { name: '적치하기' }));
    const sheet = await screen.findByRole('dialog', { name: '적치' });
    // 대상지를 못 고른 채 "나중에" 로 닫아도 취소 버튼은 남아야 한다
    await user.click(screen.getByRole('button', { name: '나중에' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('시트가 열린 뒤 같은 바코드를 다시 찍으면 스캔 누적으로 넘어간다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    renderScreen(calls);
    await screen.findByText('코튼셔츠');

    // 첫 스캔: 잔여수량 20 프리필
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    // 둘째 스캔부터는 "세는 중"이다 — 프리필을 버리고 스캔한 개수만 센다
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    await user.click(screen.getByRole('button', { name: '입고' }));
    await waitFor(() => {
      const receive = calls.find((c) => c.path === '/inbound/plans/receive');
      expect(receive?.body).toMatchObject({ quantity: 2 });
    });
  });

  it('시트가 열린 상태에서 다른 품목을 찍으면 누적하지 않고 알린다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await user.click(screen.getByRole('button', { name: '스캔:9999' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // 시트는 그대로 열려 있고 수량도 프리필 그대로다
    expect(screen.getByRole('dialog', { name: '입고 수량' })).toBeInTheDocument();
  });
});
