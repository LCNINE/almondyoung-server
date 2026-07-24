import { describe, it, expect, vi, afterEach } from 'vitest';
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
  Link,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import { InventoryLookupScreen } from './InventoryLookupScreen';

// 스캔 진입 테스트들은 "이동이 몇 번 일어났는가"를 정확히 세야 한다(단순히
// "일어났다"가 아니라). useNavigate 는 기본적으로 실제 구현에 위임하되, 콜마다
// navigateSpy 에 기록한다 — AdjustStockScreen.test.tsx 와 같은 패턴.
const { navigateOverride, navigateSpy } = vi.hoisted(() => ({
  navigateOverride: { current: null as null | ((...args: never[]) => unknown) },
  navigateSpy: vi.fn(),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: (opts?: Parameters<typeof actual.useNavigate>[0]) => {
      const real = actual.useNavigate(opts);
      return (navOpts: never) => {
        navigateSpy(navOpts);
        return (navigateOverride.current ?? real)(navOpts);
      };
    },
  };
});

afterEach(() => {
  navigateOverride.current = null;
  navigateSpy.mockClear();
});

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
  const HIT_BARCODE = '8801234567890';
  const OTHER_BARCODE = '9990000000000';

  function Emitter({ code = HIT_BARCODE, label = '스캔발사' }: { code?: string; label?: string }) {
    const bus = useScanBus();
    return (
      <button onClick={() => bus.emit({ code, source: 'hid', at: Date.now() })}>{label}</button>
    );
  }

  function renderWithScan(client: ApiClient, qc?: QueryClient) {
    const queryClient = qc ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute({ component: Outlet });
    const index = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => (
        <>
          <InventoryLookupScreen />
          <Emitter />
          <Emitter code={OTHER_BARCODE} label="스캔발사(다른코드)" />
        </>
      ),
    });
    const detail = createRoute({
      getParentRoute: () => rootRoute,
      path: '/inventory/$sku',
      component: () => (
        <div>
          상세화면
          <Link to="/">목록으로</Link>
        </div>
      ),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([index, detail]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    const wrap = ({ children }: { children: ReactNode }) => (
      <SessionProvider session={session}>
        <QueryClientProvider client={queryClient}>
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

  // --- 리뷰 후 보강된 5개 결정적 테스트 ---

  it('[1] 등록되지 않은 바코드를 두 번 연속 스캔하면 두 번 다 안내를 보여준다', async () => {
    // 프로덕션 queryClient.ts 와 동일한 staleTime(10_000)으로 재현한다. 캐시
    // 기반(useQuery + dataUpdatedAt 가드) 설계였을 때는 첫 스캔 이후 10초 안에는
    // 재조회 자체가 일어나지 않아 두 번째 스캔의 안내가 영영 뜨지 않았다
    // (Critical). 지금 구현은 스캔마다 독립적으로 요청하므로 staleTime 과 무관하다.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) return [];
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client, qc);

    await userEvent.click(await screen.findByRole('button', { name: '스캔발사' }));
    expect(await screen.findByRole('status')).toHaveTextContent('등록되지 않은 바코드예요');

    await userEvent.click(screen.getByRole('button', { name: '스캔발사' }));
    expect(await screen.findByRole('status')).toHaveTextContent('등록되지 않은 바코드예요');
  });

  it('[2] 한 건 일치하는 바코드를 스캔하면 정확히 한 번만 이동한다', async () => {
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
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  it('[3] 상세로 이동했다가 목록으로 돌아와 같은 바코드를 다시 스캔해도 정상 동작한다', async () => {
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

    await userEvent.click(screen.getByRole('link', { name: '목록으로' }));
    await userEvent.click(await screen.findByRole('button', { name: '스캔발사' }));

    expect(await screen.findByText('상세화면')).toBeInTheDocument();
    expect(navigateSpy).toHaveBeenCalledTimes(2);
  });

  it('[4] 0건 스캔 후 다른 바코드를 스캔하면 래치 없이 정상 이동한다', async () => {
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path === `/inventory/skus?barcode=${HIT_BARCODE}`) return [];
        if (opts.path === `/inventory/skus?barcode=${OTHER_BARCODE}`) {
          return [{ id: 'sku-9', code: 'CT-009', name: '기타상품', currentStock: 3, safetyStock: 0 }];
        }
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client);

    await userEvent.click(await screen.findByRole('button', { name: '스캔발사' }));
    expect(await screen.findByRole('status')).toHaveTextContent('등록되지 않은 바코드예요');

    await userEvent.click(screen.getByRole('button', { name: '스캔발사(다른코드)' }));
    expect(await screen.findByText('상세화면')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('[5] 다건 목록에서 항목을 클릭하면 그 상품 상세로 이동한다', async () => {
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

    await userEvent.click(screen.getByText('코튼셔츠 L'));

    expect(await screen.findByText('상세화면')).toBeInTheDocument();
    expect(navigateSpy).toHaveBeenCalledTimes(1);
  });

  // --- 추가 회귀 테스트: "Important" 발견에 대한 직접 증거 ---
  // 실제 라우트 전환은 navigateOverride 로 no-op 처리해 화면을 마운트된 채로
  // 유지한다(전환 타이밍에 기대지 않기 위함) — 같은 마운트에서 동일한 한 건
  // 일치 바코드를 두 번 스캔하면, 두 스캔 모두 독립적으로 처리되어 두 번
  // 이동해야 한다. dataUpdatedAt 가드 버전은 staleTime:10_000 에서 두 번째
  // 스캔의 응답을 "이미 처리했다"고 잘못 판단해 조용히 무시했다(1회만 이동).
  it('[회귀] 같은 마운트에서 동일 바코드를 다시 스캔해도 응답이 유실되지 않는다', async () => {
    navigateOverride.current = ((opts: never) => Promise.resolve(opts)) as never;
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 10_000 } } });
    const client: ApiClient = {
      request: (async (opts: { path: string }) => {
        if (opts.path.startsWith('/inventory/skus?barcode=')) {
          return [{ id: 'sku-1', code: 'CT-001', name: '코튼셔츠', currentStock: 1, safetyStock: 0 }];
        }
        return { items: [], total: 0 };
      }) as unknown as ApiClient['request'],
    };
    renderWithScan(client, qc);

    await userEvent.click(await screen.findByRole('button', { name: '스캔발사' }));
    await userEvent.click(screen.getByRole('button', { name: '스캔발사' }));

    expect(navigateSpy).toHaveBeenCalledTimes(2);
  });
});
