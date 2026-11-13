import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { routeTree } from '../../app/routeTree';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import type { Session } from '../../core/auth/session';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { STOCK_ADJUST_PERMISSION_MESSAGE } from '../../core/data/errorMessage';
import { NetworkError, type ApiClient } from '../../core/data/httpClient';
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import { ManufactureSelectScreen } from './ManufactureSelectScreen';
import type { SkuSearchItem } from './types';

vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => 'windows' }));

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const barcode = '8801234567890';
const firstSku: SkuSearchItem = {
  id: 'sku-1',
  code: 'CT-001',
  name: '코튼셔츠',
  currentStock: 1,
  safetyStock: 0,
};
const secondSku: SkuSearchItem = {
  ...firstSku,
  id: 'sku-2',
  code: 'CT-002',
  name: '코튼바지',
};

function makeClient(
  lookup: () => Promise<SkuSearchItem[]>,
  stockAdjust = true
) {
  const request = vi.fn(async ({ path }: { path: string }) => {
    if (path.startsWith('/inventory/skus?barcode=')) {
      return lookup();
    }

    if (path === '/inventory/work-context') {
      return { permissions: { stockAdjust } };
    }

    if (path === '/inventory/warehouses') {
      return [];
    }

    return { items: [firstSku], total: 1 };
  });

  return { request: request as ApiClient['request'] };
}

function Emitter() {
  const bus = useScanBus();

  return (
    <button
      onClick={() => bus.emit({ code: barcode, source: 'hid', at: Date.now() })}
    >
      스캔발사
    </button>
  );
}

function renderScreen(
  client: ApiClient,
  { warehouseSet = true, appRoutes = false } = {}
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs(
    warehouseSet
      ? { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }) }
      : {}
  );
  const root = createRootRoute({ component: Outlet });
  const select = createRoute({
    getParentRoute: () => root,
    path: '/inventory/manufacture',
    component: ManufactureSelectScreen,
  });
  const adjust = createRoute({
    getParentRoute: () => root,
    path: '/inventory/manufacture/$sku',
    component: () => <div>제조 수량 입력</div>,
  });
  const router = createRouter({
    routeTree: appRoutes ? routeTree : root.addChildren([select, adjust]),
    history: createMemoryHistory({
      initialEntries: [appRoutes ? '/inventory' : '/inventory/manufacture'],
    }),
    context: { session },
  });

  render(
    <SessionProvider session={session}>
      <QueryClientProvider client={qc}>
        <ApiClientProvider client={client}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>
              <RouterProvider router={router as never} />
              <Emitter />
            </ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );

  return { router, qc };
}

async function scan() {
  await screen.findByRole('heading', { name: '제조 완료 등록' });
  await userEvent.click(screen.getByRole('button', { name: '스캔발사' }));
}

describe('ManufactureSelectScreen', () => {
  it('실제 라우터에서 제조 경로는 SKU 상세 대신 선택 화면을 연다', async () => {
    const client = makeClient(async () => []);
    const { router } = renderScreen(client, { appRoutes: true });

    await screen.findByRole('heading', { name: '재고조회' });
    await act(async () => {
      await router.navigate({ to: '/inventory/manufacture' });
    });

    expect(
      await screen.findByRole('heading', { name: '제조 완료 등록' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('만든 상품의 바코드를 스캔하세요.')
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute(
      'href',
      '/inventory'
    );
    expect(client.request).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: '/inventory/skus/manufacture' })
    );
  });

  it('스캔 결과가 한 건이면 제조 모드로 조정 화면을 연다', async () => {
    const { router } = renderScreen(makeClient(async () => [firstSku]));

    await scan();

    expect(await screen.findByText('제조 수량 입력')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventory/manufacture/sku-1');
  });

  it('스캔 결과가 없으면 바코드와 미등록 안내를 보여준다', async () => {
    renderScreen(makeClient(async () => []));

    await scan();

    expect(
      await screen.findByText(`등록되지 않은 바코드예요: ${barcode}`)
    ).toBeInTheDocument();
  });

  it('여러 상품이 나오면 선택한 상품의 제조 모드로 이동한다', async () => {
    const { router } = renderScreen(
      makeClient(async () => [firstSku, secondSku])
    );

    await scan();

    expect(
      await screen.findByRole('button', { name: /코튼셔츠\s*CT-001/ })
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: /코튼바지\s*CT-002/ })
    );

    expect(await screen.findByText('제조 수량 입력')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventory/manufacture/sku-2');
  });

  it('상품명·코드 검색으로 선택해도 제조 모드로 이동한다', async () => {
    const { router } = renderScreen(makeClient(async () => []));

    await userEvent.type(
      await screen.findByLabelText('상품명·코드 검색'),
      '코튼{Enter}'
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '코튼셔츠 선택' })
    );

    expect(await screen.findByText('제조 수량 입력')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventory/manufacture/sku-1');
  });

  it('권한이 없으면 검색을 막고 스캔해도 조회하거나 이동하지 않는다', async () => {
    const lookup = vi.fn(async () => [firstSku]);
    const { router } = renderScreen(makeClient(lookup, false));

    expect(
      await screen.findByText(STOCK_ADJUST_PERMISSION_MESSAGE)
    ).toBeInTheDocument();
    expect(screen.getByLabelText('상품명·코드 검색')).toBeDisabled();
    await scan();

    expect(lookup).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe('/inventory/manufacture');
  });

  it('창고가 없으면 창고 선택을 안내하고 스캔 조회를 막는다', async () => {
    const lookup = vi.fn(async () => [firstSku]);
    renderScreen(makeClient(lookup), { warehouseSet: false });

    expect(
      await screen.findByText('창고를 먼저 선택해 주세요.')
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('상품명·코드 검색')).not.toBeInTheDocument();
    await scan();

    expect(lookup).not.toHaveBeenCalled();
  });

  it('조회 실패를 미등록으로 안내하지 않고 같은 바코드로 재시도한다', async () => {
    const lookup = vi
      .fn<() => Promise<SkuSearchItem[]>>()
      .mockRejectedValueOnce(new NetworkError(new Error('offline')))
      .mockResolvedValueOnce([firstSku]);
    const client = makeClient(lookup);
    const { router } = renderScreen(client);

    await scan();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `바코드를 확인하지 못했어요: ${barcode}.`
    );
    expect(screen.queryByText(/등록되지 않은 바코드/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '다시 확인' }));

    expect(await screen.findByText('제조 수량 입력')).toBeInTheDocument();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(client.request).toHaveBeenLastCalledWith({
      path: `/inventory/skus?barcode=${barcode}`,
    });
    expect(router.state.location.pathname).toBe('/inventory/manufacture/sku-1');
  });

  it('조회 중인 스캔은 무시한다', async () => {
    let resolveLookup: (hits: SkuSearchItem[]) => void = () => {};
    const lookup = vi.fn(
      () =>
        new Promise<SkuSearchItem[]>((resolve) => {
          resolveLookup = resolve;
        })
    );
    renderScreen(makeClient(lookup));

    await scan();
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    await scan();

    expect(lookup).toHaveBeenCalledTimes(1);
    await act(async () => resolveLookup([]));
    expect(
      await screen.findByText(`등록되지 않은 바코드예요: ${barcode}`)
    ).toBeInTheDocument();
  });

  it('조회 중 권한이 거부되면 늦게 온 결과로 이동하지 않는다', async () => {
    let resolveLookup: (hits: SkuSearchItem[]) => void = () => {};
    const lookup = vi.fn(
      () =>
        new Promise<SkuSearchItem[]>((resolve) => {
          resolveLookup = resolve;
        })
    );
    const { router, qc } = renderScreen(makeClient(lookup));

    await scan();
    await waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    await act(async () => {
      qc.setQueryData(['work-permissions'], { stockAdjust: false });
    });
    await screen.findByText(STOCK_ADJUST_PERMISSION_MESSAGE);
    await act(async () => resolveLookup([firstSku]));

    expect(router.state.location.pathname).toBe('/inventory/manufacture');
    expect(screen.getByLabelText('상품명·코드 검색')).toBeDisabled();
  });
});
