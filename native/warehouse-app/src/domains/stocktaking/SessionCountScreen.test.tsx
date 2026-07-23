import { describe, it, expect } from 'vitest';
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
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SessionCountScreen } from './SessionCountScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

type Call = { path: string; method?: string; body?: unknown };

const DETAIL = {
  id: 's-1',
  warehouseId: 'w-1',
  sessionName: '2026-07-23 실사',
  status: 'in_progress',
  notes: null,
  createdAt: '2026-07-23T00:00:00Z',
  startedAt: '2026-07-23T01:00:00Z',
  completedAt: null,
  progress: { total: 3, counted: 1 },
  lines: [],
};

const SCAN_LOCATION = {
  locationId: 'l-1',
  locationCode: 'A-01-02',
  expectedItems: [
    {
      lineId: 'line-1',
      skuId: 'sku-1',
      skuName: '코튼셔츠',
      skuCode: 'CT-001',
      barcode: '8801',
      expectedQuantity: 6,
      countedQuantity: null,
      status: 'pending',
    },
    {
      lineId: 'line-2',
      skuId: 'sku-2',
      skuName: '리넨셔츠',
      skuCode: 'LN-002',
      barcode: '8802',
      expectedQuantity: 2,
      countedQuantity: 2,
      status: 'counted',
    },
  ],
};

function Emitter({ code }: { code: string }) {
  const bus = useScanBus();
  return <button onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>스캔:{code}</button>;
}

function renderScreen(calls: Call[]) {
  const client: ApiClient = {
    request: (async (opts: Call) => {
      calls.push(opts);
      if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
      if (opts.path === '/stocktaking/scan-location') return SCAN_LOCATION;
      if (opts.path === '/stocktaking/scan-product') {
        return { lineId: 'line-1', skuId: 'sku-1', countedQuantity: 5, expectedQuantity: 6, variance: -1 };
      }
      if (opts.path === '/stocktaking/lines/line-1/count') {
        const body = opts.body as { countedQuantity: number };
        return {
          lineId: 'line-1',
          skuId: 'sku-1',
          countedQuantity: body.countedQuantity,
          expectedQuantity: 6,
          variance: body.countedQuantity - 6,
        };
      }
      return {};
    }) as unknown as ApiClient['request'],
  };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <SessionCountScreen sessionId="s-1" />
        <Emitter code="A-01-02" />
        <Emitter code="8801" />
      </>
    ),
  });
  const variances = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking/$sessionId/variances',
    component: () => <div>차이화면</div>,
  });
  const list = createRoute({
    getParentRoute: () => rootRoute,
    path: '/stocktaking',
    component: () => <div>세션목록</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, variances, list]),
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

describe('SessionCountScreen', () => {
  it('로케이션 대기 모드로 시작하고 진행률을 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText(/로케이션 바코드를 스캔/)).toBeInTheDocument();
    expect(await screen.findByTestId('progress')).toHaveTextContent('1 / 3');
  });

  it('로케이션 스캔이 그 위치의 라인을 띄운다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);

    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));

    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText('리넨셔츠')).toBeInTheDocument();
    const scan = calls.find((c) => c.path === '/stocktaking/scan-location');
    expect(scan?.body).toMatchObject({ sessionId: 's-1', locationBarcode: 'A-01-02' });
  });

  it('이미 센 라인은 저장된 카운트를 그대로 보여준다 (이어하기)', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));
    expect(await screen.findByTestId('count-line-2')).toHaveTextContent('2');
    expect(screen.getByTestId('count-line-1')).toHaveTextContent('—');
  });

  it('상품 스캔은 응답의 절대 카운트로 라인을 덮어쓴다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));

    await userEvent.click(await screen.findByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByTestId('count-line-1')).toHaveTextContent('5');
    const scan = calls.find((c) => c.path === '/stocktaking/scan-product');
    expect(scan?.body).toMatchObject({
      sessionId: 's-1',
      locationId: 'l-1',
      productBarcode: '8801',
      quantity: 1,
    });
  });

  it('수량 직접 입력은 updateCount 로 절대값을 세팅한다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));

    await userEvent.click(await screen.findByRole('button', { name: '코튼셔츠 수량 입력' }));
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    const update = calls.find((c) => c.path === '/stocktaking/lines/line-1/count');
    expect(update?.method).toBe('PUT');
    expect(update?.body).toMatchObject({ countedQuantity: 12 });
    expect(await screen.findByTestId('count-line-1')).toHaveTextContent('12');
  });

  it('수량 입력 다이얼로그가 열려 있으면 스캔을 무시한다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));
    await userEvent.click(await screen.findByRole('button', { name: '코튼셔츠 수량 입력' }));

    await userEvent.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(calls.filter((c) => c.path === '/stocktaking/scan-product')).toHaveLength(0);
  });

  it('다른 로케이션 버튼이 대기 모드로 되돌린다', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: '스캔:A-01-02' }));
    await userEvent.click(await screen.findByRole('button', { name: '다른 로케이션' }));
    expect(await screen.findByText(/로케이션 바코드를 스캔/)).toBeInTheDocument();
  });

  it('차이 확인으로 이동한다', async () => {
    renderScreen([]);
    await userEvent.click(await screen.findByRole('button', { name: /차이 확인/ }));
    expect(await screen.findByText('차이화면')).toBeInTheDocument();
  });
});
