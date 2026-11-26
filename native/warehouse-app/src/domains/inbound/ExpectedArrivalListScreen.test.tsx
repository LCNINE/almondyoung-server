import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import type { ExpectedArrivalsResult } from './types';
import { ExpectedArrivalListScreen } from './ExpectedArrivalListScreen';

const station = vi.hoisted(() => ({ on: false }));
vi.mock('../../app/station', () => ({ isStationDevice: () => station.on }));

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const BASE: ExpectedArrivalsResult = {
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

const paths: string[] = [];
let ARRIVALS: ExpectedArrivalsResult = BASE;

function withShipment(expectedDate: string | null): ExpectedArrivalsResult {
  return {
    ...BASE,
    arrivals: [
      ...BASE.arrivals,
      {
        source: 'inbound_shipment',
        documentId: 'sh-1',
        name: '11월 1차 선적',
        expectedDate,
        totalOutstandingQuantity: 340,
        receivedBoxes: 2,
        stockBoxes: 5,
      },
    ],
  };
}

function renderScreen(prefsSeed?: Record<string, string>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      if (o.path.startsWith('/inventory/expected-arrivals')) {
        paths.push(o.path);
        return ARRIVALS;
      }
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

const SELECTED = {
  'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
};

describe('ExpectedArrivalListScreen', () => {
  it('창고가 없으면 창고 선택을 요구한다', async () => {
    renderScreen();
    expect(
      await screen.findByText('창고를 먼저 선택해 주세요.')
    ).toBeInTheDocument();
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
    expect(
      await screen.findByRole('link', { name: '간편입고' })
    ).toBeInTheDocument();
  });

  it('세그먼트로 간편입고·입고내역에 가고, 발주 입고 칸이 지금 화면이다 — 스테이션 홈이 사라져도 닿는 유일한 길(U3)', async () => {
    renderScreen(SELECTED);
    const segment = await screen.findByRole('navigation', { name: '입고 화면' });
    expect(within(segment).getByRole('link', { name: '간편입고' })).toHaveAttribute('href', '/inbound/quick');
    expect(within(segment).getByRole('link', { name: '입고내역' })).toHaveAttribute('href', '/inbound/history');
    expect(within(segment).getByRole('link', { name: '발주 입고' })).toHaveAttribute('aria-current', 'page');
  });

  it('창고를 고르기 전에도 세그먼트로 간편입고에 갈 수 있다', async () => {
    renderScreen();
    await screen.findByText('창고를 먼저 선택해 주세요.');
    expect(screen.getByRole('link', { name: '간편입고' })).toHaveAttribute('href', '/inbound/quick');
  });

  it('스테이션에서만 «선적 상자 입고» 링크가 /inbound/boxes 로 간다', async () => {
    station.on = true;
    renderScreen(SELECTED);
    const link = await screen.findByRole('link', { name: '선적 상자 입고' });
    expect(link).toHaveAttribute('href', '/inbound/boxes');
    station.on = false;
  });

  it('핸드헬드에는 «선적 상자 입고» 링크가 없다', async () => {
    station.on = false;
    renderScreen(SELECTED);
    await screen.findByText('알몬드상사');
    expect(screen.queryByRole('link', { name: '선적 상자 입고' })).toBeNull();
  });

  describe('선적 줄', () => {
    beforeEach(() => {
      paths.length = 0;
      station.on = false;
    });
    afterEach(() => {
      ARRIVALS = BASE;
      station.on = false;
    });

    it('include=inbound_shipment 로 요청한다', async () => {
      renderScreen(SELECTED);
      await screen.findByText('알몬드상사');
      expect(paths[0]).toContain('include=inbound_shipment');
    });

    it('선적 줄에 이름·날짜·상자·남은 수량을 그린다', async () => {
      ARRIVALS = withShipment('2999-12-31');
      renderScreen(SELECTED);
      expect(await screen.findByText('11월 1차 선적')).toBeInTheDocument();
      expect(screen.getByText(/12\/31 · 상자 2\/5/)).toBeInTheDocument();
      expect(screen.getByText('남은 340')).toBeInTheDocument();
    });

    it('스테이션에서는 /inbound/boxes 링크다', async () => {
      station.on = true;
      ARRIVALS = withShipment('2999-12-31');
      renderScreen(SELECTED);
      const link = await screen.findByRole('link', { name: /11월 1차 선적/ });
      expect(link).toHaveAttribute('href', '/inbound/boxes');
    });

    it('핸드헬드에서는 링크가 아니고 «스테이션 작업» 을 보인다', async () => {
      ARRIVALS = withShipment('2999-12-31');
      renderScreen(SELECTED);
      await screen.findByText('11월 1차 선적');
      expect(screen.queryByRole('link', { name: /11월 1차 선적/ })).toBeNull();
      expect(screen.getByText('스테이션 작업')).toBeInTheDocument();
    });

    it('지난 날짜는 «예정일 지남», 날짜 없으면 «예정일 미정»', async () => {
      ARRIVALS = withShipment('2000-01-01');
      renderScreen(SELECTED);
      expect(await screen.findByText(/예정일 지남/)).toBeInTheDocument();
    });

    it('날짜가 없으면 «예정일 미정»', async () => {
      ARRIVALS = withShipment(null);
      renderScreen(SELECTED);
      await screen.findByText('11월 1차 선적');
      expect(screen.getByText(/예정일 미정 · 상자/)).toBeInTheDocument();
    });

    it('빈 목록 문구에 간편입고 안내가 없다', async () => {
      ARRIVALS = { ...BASE, arrivals: [] };
      renderScreen(SELECTED);
      expect(
        await screen.findByText('입고 예정이 없어요.')
      ).toBeInTheDocument();
    });
  });
});
