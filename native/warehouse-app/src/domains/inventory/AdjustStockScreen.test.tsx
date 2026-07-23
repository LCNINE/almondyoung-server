import { describe, it, expect, vi, afterEach } from 'vitest';
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
import { useWarehouse } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { AdjustStockScreen } from './AdjustStockScreen';

// 실제 이동을 검증하는 테스트가 하나 있고(브리프의 나머지 테스트는 전부 실이동
// 없이 통과해야 한다), 그와 별개로 "같은 마운트에서 두 번째 제출"을 타이밍에
// 기대지 않고 확정적으로 재현해야 하는 테스트가 하나 있다. useNavigate 를
// 실제 구현으로 위임하는 래퍼로 감싸고, navigateOverride 가 세팅된 동안만
// 가로챈다 — 이동을 막아 언마운트를 피하려는 그 테스트에서만 쓴다.
const { navigateOverride } = vi.hoisted(() => ({
  navigateOverride: { current: null as null | ((...args: never[]) => unknown) },
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: (opts?: Parameters<typeof actual.useNavigate>[0]) => {
      const real = actual.useNavigate(opts);
      return navigateOverride.current ?? real;
    },
  };
});

afterEach(() => {
  navigateOverride.current = null;
});

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const TABLE: Record<string, unknown> = {
  '/inventory/skus/sku-1': {
    id: 'sku-1',
    code: 'CT-001',
    name: '코튼셔츠',
    safetyStock: 0,
    barcodes: [],
  },
  '/inventory/stocks/sku/sku-1/warehouse/w-1': {
    summary: { currentQuantity: 12, availableQuantity: 12, reservedQuantity: 0 },
    details: [{ locationId: 'l-1', locationCode: 'A-01-02', stockState: 'ON_HAND', quantity: 12 }],
  },
};

function makeClient(calls: Array<{ path: string; body?: unknown; idempotencyKey?: string }>): ApiClient {
  return {
    request: (async (opts: { path: string; method?: string; body?: unknown; idempotencyKey?: string }) => {
      calls.push({ path: opts.path, body: opts.body, idempotencyKey: opts.idempotencyKey });
      if (opts.path.startsWith('/locations/warehouses/')) {
        return { items: [{ id: 'l-9', code: 'B-03-01', displayName: 'B-03-01' }], total: 1 };
      }
      if (opts.path === '/inventory/stocks/adjust') return {};
      if (opts.path in TABLE) return TABLE[opts.path];
      throw new Error(`GET ${opts.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
}

function renderScreen(client: ApiClient, initialLocationId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }),
  });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <AdjustStockScreen skuId="sku-1" initialLocationId={initialLocationId} />,
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
          <ScanProvider>
            <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
          </ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

describe('AdjustStockScreen', () => {
  it('로케이션 미선택이면 조정 버튼이 비활성이다', async () => {
    renderScreen(makeClient([]));
    expect(await screen.findByRole('button', { name: '조정하기' })).toBeDisabled();
  });

  it('프리필된 로케이션의 현재 수량을 보여준다', async () => {
    renderScreen(makeClient([]), 'l-1');
    expect(await screen.findByText('A-01-02')).toBeInTheDocument();
    expect(await screen.findByTestId('current-onhand')).toHaveTextContent('12');
  });

  it('delta 가 0 이면 조정 버튼이 비활성이다', async () => {
    renderScreen(makeClient([]), 'l-1');
    // 기본 delta 는 0
    expect(await screen.findByRole('button', { name: '조정하기' })).toBeDisabled();
  });

  it('사유를 고르지 않으면 조정 버튼이 비활성이다', async () => {
    renderScreen(makeClient([]), 'l-1');
    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    expect(screen.getByRole('button', { name: '조정하기' })).toBeDisabled();
  });

  it('로케이션·delta·사유가 갖춰지면 확인 후 조정을 보낸다', async () => {
    const calls: Array<{ path: string; body?: unknown; idempotencyKey?: string }> = [];
    renderScreen(makeClient(calls), 'l-1');

    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '부호' }));
    await userEvent.click(screen.getByRole('button', { name: '파손' }));
    await userEvent.click(screen.getByRole('button', { name: '조정하기' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '조정' }));

    const adjust = calls.find((c) => c.path === '/inventory/stocks/adjust');
    expect(adjust?.body).toMatchObject({
      skuId: 'sku-1',
      warehouseId: 'w-1',
      locationId: 'l-1',
      delta: -2,
      reason: '파손',
    });
    expect(adjust?.idempotencyKey).toEqual(expect.any(String));
  });

  it('기타 사유는 자유 입력을 요구한다', async () => {
    renderScreen(makeClient([]), 'l-1');
    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '기타' }));

    expect(screen.getByRole('button', { name: '조정하기' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('사유 직접 입력'), '창고 이관 누락');
    expect(screen.getByRole('button', { name: '조정하기' })).toBeEnabled();
  });

  it('검색으로 로케이션을 고를 수 있다', async () => {
    renderScreen(makeClient([]));
    // TanStack Router 의 초기 매치는 비동기다 — render() 직후 동기 getBy 는
    // 아직 라우트가 마운트되기 전이라 실패할 수 있어 findBy 로 기다린다.
    await userEvent.type(await screen.findByLabelText('로케이션 검색'), 'B-03');
    await userEvent.click(await screen.findByRole('button', { name: /B-03-01/ }));
    expect(await screen.findByText('B-03-01')).toBeInTheDocument();
  });

  it('창고를 바꾸면 새 창고 응답이 오기 전까지 이전 창고의 검색결과를 보여주지 않는다', async () => {
    // useLocationSearch 는 keepPreviousData 를 쓴다. 창고가 바뀌어도 새 요청이
    // 도는 동안 이전 창고의 목록이 placeholder 로 남을 수 있고, 그 행을 고르면
    // 다른 창고의 locationId 로 원장을 쓰게 된다 — 이 시나리오를 재현한다.
    let resolveW2: ((v: { items: unknown[]; total: number }) => void) | undefined;
    const w2Promise = new Promise<{ items: unknown[]; total: number }>((resolve) => {
      resolveW2 = resolve;
    });

    const client: ApiClient = {
      request: (async (opts: { path: string; method?: string; body?: unknown }) => {
        if (opts.path.startsWith('/locations/warehouses/w-1')) {
          return { items: [{ id: 'l-w1', code: 'W1-LOC-01', displayName: 'W1-LOC-01' }], total: 1 };
        }
        if (opts.path.startsWith('/locations/warehouses/w-2')) {
          return w2Promise;
        }
        if (opts.path === '/inventory/skus/sku-1') {
          return { id: 'sku-1', code: 'CT-001', name: '코튼셔츠', safetyStock: 0, barcodes: [] };
        }
        if (
          opts.path === '/inventory/stocks/sku/sku-1/warehouse/w-1' ||
          opts.path === '/inventory/stocks/sku/sku-1/warehouse/w-2'
        ) {
          return { summary: null, details: [] };
        }
        throw new Error(`GET ${opts.path} → 404`);
      }) as unknown as ApiClient['request'],
    };

    function SwitchWarehouseButton() {
      const { setWarehouse } = useWarehouse();
      return (
        <button type="button" onClick={() => setWarehouse({ id: 'w-2', name: '제2창고' })}>
          창고전환
        </button>
      );
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const prefs = createMemoryPrefs({
      'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }),
    });
    const rootRoute = createRootRoute({ component: Outlet });
    const index = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <>
          <SwitchWarehouseButton />
          <AdjustStockScreen skuId="sku-1" />
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
            <ScanProvider>
              <WarehouseProvider prefs={prefs}>{children}</WarehouseProvider>
            </ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
    render(<RouterProvider router={router as never} />, { wrapper: wrap });

    await userEvent.type(await screen.findByLabelText('로케이션 검색'), 'X');
    expect(await screen.findByRole('button', { name: /W1-LOC-01/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '창고전환' }));

    // 새 창고(w-2)의 응답이 아직 오지 않았다 — w-1 의 결과가 그대로 보이면 안 된다.
    expect(screen.queryByRole('button', { name: /W1-LOC-01/ })).not.toBeInTheDocument();
    expect(await screen.findByText('불러오는 중…')).toBeInTheDocument();

    resolveW2?.({ items: [{ id: 'l-w2', code: 'W2-LOC-01', displayName: 'W2-LOC-01' }], total: 1 });

    expect(await screen.findByRole('button', { name: /W2-LOC-01/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /W1-LOC-01/ })).not.toBeInTheDocument();
  });

  it('확인창이 열려 있는 동안 스캔이 들어와도 조정 대상 로케이션은 바뀌지 않는다', async () => {
    const calls: Array<{ path: string; body?: unknown; idempotencyKey?: string }> = [];
    renderScreen(makeClient(calls), 'l-1');

    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '부호' }));
    await userEvent.click(screen.getByRole('button', { name: '파손' }));
    await userEvent.click(screen.getByRole('button', { name: '조정하기' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // HID 스캐너가 확인창이 열려 있는 동안 (다른 로케이션의) 바코드를 스캔한다.
    for (const k of ['B', '-', '9', '9', 'Enter']) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
    }

    // 확인창은 여전히 최초 선택된 로케이션(A-01-02) 기준 메시지를 유지한다.
    expect(screen.getByRole('dialog')).toHaveTextContent('A-01-02');

    await userEvent.click(screen.getByRole('button', { name: '조정' }));

    const adjust = calls.find((c) => c.path === '/inventory/stocks/adjust');
    expect(adjust?.body).toMatchObject({
      skuId: 'sku-1',
      warehouseId: 'w-1',
      locationId: 'l-1',
      delta: -2,
      reason: '파손',
    });
  });

  it('기타 사유가 공백뿐이면 조정 버튼이 비활성 상태를 유지한다', async () => {
    renderScreen(makeClient([]), 'l-1');
    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '기타' }));

    expect(screen.getByRole('button', { name: '조정하기' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText('사유 직접 입력'), '   ');
    expect(screen.getByRole('button', { name: '조정하기' })).toBeDisabled();
  });

  it('조정을 확인하면 실제로 상세 화면으로 이동한다', async () => {
    renderScreen(makeClient([]), 'l-1');

    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '부호' }));
    await userEvent.click(screen.getByRole('button', { name: '파손' }));
    await userEvent.click(screen.getByRole('button', { name: '조정하기' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '조정' }));

    // 멱등키 회전이 "다음 화면에서 새로 마운트되면 새 키를 받는다"는 이 실제
    // 이동에 기대고 있다 — 그 이동 자체를 검증한다(가짜가 아닌 실제 useNavigate).
    expect(await screen.findByText('상세화면')).toBeInTheDocument();
  });

  it('같은 마운트에서 두 번 연속 성공하면 서로 다른 멱등키를 쓴다', async () => {
    // idempotencyKey 가 useRef 로 마운트당 한 번만 생성되면, 성공 후 이동이
    // 어떤 이유로든 스킵/실패할 때 같은 마운트에서의 다음(다른 선반·다른 delta)
    // 제출이 같은 키를 재사용해 백엔드가 조용히 no-op 한다 — 재고는 안 움직이는데
    // 화면은 성공을 보여준다. useNavigate 를 가로채 이동으로 인한 언마운트를
    // 막아, 이 위험을 타이밍에 기대지 않고 확정적으로 재현한다.
    const calls: Array<{ path: string; body?: unknown; idempotencyKey?: string }> = [];
    navigateOverride.current = vi.fn();

    renderScreen(makeClient(calls), 'l-1');

    await userEvent.click(await screen.findByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '부호' }));
    await userEvent.click(screen.getByRole('button', { name: '파손' }));
    await userEvent.click(screen.getByRole('button', { name: '조정하기' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '조정' }));

    await waitFor(() => {
      expect(calls.filter((c) => c.path === '/inventory/stocks/adjust')).toHaveLength(1);
    });

    // 화면은 이동하지 않았다(가짜 navigate) — 같은 마운트에서 두 번째 조정을 보낸다.
    // 폼 상태(수량·사유·로케이션)는 그대로 남아 있다.
    await userEvent.click(screen.getByRole('button', { name: '조정하기' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '조정' }));

    await waitFor(() => {
      expect(calls.filter((c) => c.path === '/inventory/stocks/adjust')).toHaveLength(2);
    });

    const [first, second] = calls.filter((c) => c.path === '/inventory/stocks/adjust');
    expect(first.idempotencyKey).toEqual(expect.any(String));
    expect(second.idempotencyKey).toEqual(expect.any(String));
    expect(second.idempotencyKey).not.toEqual(first.idempotencyKey);
  });
});
