import { describe, it, expect, vi, afterEach } from 'vitest';

const platformMock = vi.hoisted(() => ({ value: 'windows' }));
vi.mock('@tauri-apps/plugin-os', () => ({ platform: () => platformMock.value }));
vi.mock('../../app/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../app/config')>()),
  filePublicBaseUrl: 'https://file.tenant-2.example',
}));
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
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
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { InventoryLookupScreen } from './InventoryLookupScreen';

afterEach(() => {
  platformMock.value = 'windows';
});

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const ITEMS = [
  { id: 'sku-1', code: 'CT-001', name: '코튼셔츠', optionKey: 'M / 흰색', currentStock: 15, safetyStock: 0, imageFileIds: ['file-1'] },
  { id: 'sku-2', code: 'CT-002', name: '린넨셔츠', optionKey: null, currentStock: 0, safetyStock: 0 },
];

const TABLE: Record<string, unknown> = {
  '/inventory/skus/sku-1': {
    id: 'sku-1',
    code: 'CT-001',
    name: '코튼셔츠',
    optionKey: 'M / 흰색',
    safetyStock: 0,
    barcodes: [{ id: 'b-1', barcode: '8801234567890', isPrimary: true }],
    imageFileIds: ['file-1'],
  },
  '/inventory/skus/sku-1/stock-summary': {
    skuId: 'sku-1',
    skuName: '코튼셔츠',
    skuCode: 'CT-001',
    totalRealQuantity: 15,
    totalReservedQuantity: 3,
    totalAvailableQuantity: 12,
    warehouseStocks: [
      { warehouseId: 'w-1', warehouseName: '본창고', realQuantity: 15, reservedQuantity: 3, availableQuantity: 12 },
    ],
  },
  '/inventory/stocks/sku/sku-1/warehouse/w-1': {
    summary: { currentQuantity: 15, availableQuantity: 12, reservedQuantity: 3 },
    details: [
      { locationId: 'l-1', locationCode: 'A-01-02', stockState: 'ON_HAND', quantity: 12 },
      { locationId: 'l-2', locationCode: 'zone-inbound-default', locationName: '입고 기본존', stockState: 'ON_HAND', quantity: 3 },
      { locationId: 'l-1', locationCode: 'A-01-02', stockState: 'DEFECTIVE', quantity: 2 },
    ],
  },
  '/locations/warehouses/w-1?isSystem=true&limit=100': {
    items: [
      { id: 'l-2', code: 'zone-inbound-default', displayName: '입고 기본존', systemRole: 'inbound_default' },
      { id: 'l-9', code: 'zone-return-default', displayName: '반품 기본존', systemRole: 'return_default' },
    ],
    total: 2,
  },
};

const HISTORY = [
  {
    id: 'e-1',
    transitionType: 'RECEIVE',
    fromWarehouseId: null,
    fromLocationId: null,
    fromState: null,
    toWarehouseId: 'w-1',
    toLocationId: 'l-2',
    toState: 'ON_HAND',
    quantity: 15,
    occurredAt: '2026-11-20T01:00:00.000Z',
  },
  {
    id: 'e-2',
    transitionType: 'MOVE',
    fromWarehouseId: 'w-1',
    fromLocationId: 'l-2',
    fromState: 'ON_HAND',
    toWarehouseId: 'w-1',
    toLocationId: 'l-1',
    toState: 'ON_HAND',
    quantity: 12,
    occurredAt: '2026-11-21T01:00:00.000Z',
  },
  {
    id: 'e-3',
    transitionType: 'ADJUST_DOWN',
    fromWarehouseId: 'w-1',
    fromLocationId: 'l-1',
    fromState: 'ON_HAND',
    toWarehouseId: null,
    toLocationId: null,
    toState: null,
    quantity: 1,
    occurredAt: '2026-11-22T01:00:00.000Z',
  },
];

const HISTORY_PATH = '/inventory/stocks/history?skuId=sku-1&warehouseId=w-1';

const SYSTEM_PATH = '/locations/warehouses/w-1?isSystem=true&limit=100';

function clientFor(
  items: unknown[] = ITEMS,
  history: () => Promise<unknown> = async () => HISTORY,
  systemLocations: () => Promise<unknown> = async () => TABLE[SYSTEM_PATH]
): ApiClient {
  return {
    request: (async (opts: { path: string }) => {
      if (opts.path.startsWith('/inventory/skus?barcode=')) return [];
      if (opts.path === HISTORY_PATH) return history();
      if (opts.path === SYSTEM_PATH) return systemLocations();
      if (opts.path.startsWith('/inventory/skus/search/advanced')) return { items, total: items.length };
      if (!(opts.path in TABLE)) throw new Error(`GET ${opts.path} → 404`);

      return TABLE[opts.path];
    }) as unknown as ApiClient['request'],
  };
}

function renderLookup(client: ApiClient) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '본창고' }) });
  const rootRoute = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <InventoryLookupScreen />,
  });
  const adjust = createRoute({
    getParentRoute: () => rootRoute,
    path: '/inventory/$sku/adjust',
    component: () => <div>조정화면</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([index, adjust]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrap = ({ children }: { children: ReactNode }) => (
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

  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

async function searchFor(term: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByRole('textbox', { name: '상품명 · 코드 · 바코드 검색' }), term);
  await user.click(screen.getByRole('button', { name: '검색' }));

  return user;
}

describe('InventoryLookupScreen 목록과 상세 카드', () => {
  it('제목과 설명, 상품 목록의 결과 수와 사진·옵션·코드·재고를 보인다', async () => {
    renderLookup(clientFor());
    expect(await screen.findByRole('heading', { name: '재고 조회' })).toBeInTheDocument();
    expect(screen.getByText('상품을 찾고, 위치와 수량을 확인하세요.')).toBeInTheDocument();
    await searchFor('셔츠');

    const list = await screen.findByRole('region', { name: '상품 목록' });
    expect(await within(list).findByText('2개 결과')).toBeInTheDocument();
    expect(within(list).getByRole('columnheader', { name: /상품 \/ 옵션/ })).toBeInTheDocument();
    expect(within(list).getByRole('columnheader', { name: /코드/ })).toBeInTheDocument();
    expect(within(list).getByRole('columnheader', { name: '재고' })).toBeInTheDocument();
    const row = within(list).getByRole('button', { name: '코튼셔츠 재고 상세' }).closest('tr')!;
    expect(within(row).getByText('M / 흰색')).toBeInTheDocument();
    expect(within(row).getByText('CT-001')).toBeInTheDocument();
    expect(within(row).getByText('15')).toBeInTheDocument();
    expect(row.querySelector('img')).not.toBeNull();
    expect(within(list).getByText('품절')).toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '상품 재고' })).not.toBeInTheDocument();
  });

  it('행을 고르면 오른쪽 카드에 전체·가용·예약 수량과 위치별 재고를 보인다', async () => {
    renderLookup(clientFor());
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));

    expect(screen.getByRole('button', { name: '코튼셔츠 재고 상세' })).toHaveAttribute('aria-pressed', 'true');
    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    expect(await within(card).findByRole('heading', { name: '코튼셔츠' })).toBeInTheDocument();
    expect(within(card).getByText('M / 흰색')).toBeInTheDocument();
    expect(within(card).getByText('CT-001')).toBeInTheDocument();
    expect(card.querySelector('img')).toHaveAttribute('src', expect.stringContaining('file-1'));
    expect(await within(card).findByTestId('stock-real')).toHaveTextContent('15');
    expect(within(card).getByTestId('stock-available')).toHaveTextContent('12');
    expect(within(card).getByTestId('stock-reserved')).toHaveTextContent('3');
    expect(within(card).getByText('전체 재고')).toBeInTheDocument();
    expect(within(card).getByText('가용 수량')).toBeInTheDocument();
    expect(within(card).getByText('예약 수량')).toBeInTheDocument();
    expect(within(card).getByRole('heading', { name: '위치별 재고' })).toBeInTheDocument();
    expect(await within(card).findAllByText('A-01-02')).toHaveLength(2);
    expect(within(card).getByText('12개')).toBeInTheDocument();
    expect(within(card).getByText('입고 기본존')).toBeInTheDocument();
    expect(within(card).getByText('3개')).toBeInTheDocument();
    const inbound = within(card).getByText('입고 기본존').closest('li')!;
    expect(await within(inbound).findByText('적치 대기')).toBeInTheDocument();
    const shelf = within(card).getByText('12개').closest('li')!;
    expect(within(shelf).getByText('보관 위치')).toBeInTheDocument();
    const defective = within(card).getByText('2개').closest('li')!;
    expect(within(defective).getByText('보관 위치 · 불량')).toBeInTheDocument();
    expect(within(card).queryByText(/ON_HAND|DEFECTIVE/)).not.toBeInTheDocument();
  });

  it('검색 결과가 없으면 일치하는 상품이 없다고 알린다', async () => {
    renderLookup(clientFor([]));
    await searchFor('없는상품');

    const list = await screen.findByRole('region', { name: '상품 목록' });
    expect(await within(list).findByText('일치하는 상품이 없어요.')).toBeInTheDocument();
    expect(within(list).getByText('0개 결과')).toBeInTheDocument();
  });

  it('스테이션에서 고른 상품의 라벨 출력과 SKU 라벨로 라벨 패널을 열고 재고 조정으로 들어간다', async () => {
    renderLookup(clientFor());
    expect(await screen.findByRole('button', { name: '라벨 출력' })).toBeDisabled();
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));

    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    expect(within(card).queryByRole('region', { name: '라벨 출력' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '라벨 출력' }));
    expect(await within(card).findByRole('region', { name: '라벨 출력' })).toBeInTheDocument();

    const skuLabel = within(card).getByRole('button', { name: 'SKU 라벨' });
    expect(skuLabel).toHaveAttribute('aria-expanded', 'true');
    await user.click(skuLabel);
    expect(within(card).queryByRole('region', { name: '라벨 출력' })).not.toBeInTheDocument();
    await user.click(skuLabel);
    expect(await within(card).findByRole('region', { name: '라벨 출력' })).toBeInTheDocument();

    await user.click(within(card).getByRole('button', { name: '재고 조정' }));
    expect(await screen.findByText('조정화면')).toBeInTheDocument();
  });

  it('핸드헬드에는 라벨 버튼이 없다', async () => {
    platformMock.value = 'android';
    renderLookup(clientFor());
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));

    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    await within(card).findByTestId('stock-real');
    expect(screen.queryByRole('button', { name: '라벨 출력' })).not.toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: 'SKU 라벨' })).not.toBeInTheDocument();
    expect(within(card).getByRole('button', { name: '재고 조정' })).toBeInTheDocument();
  });

  it('수불 이력을 누르면 고른 상품의 이 창고 이력을 최근 것부터 한국어 구분·위치·수량으로 보인다', async () => {
    renderLookup(clientFor());
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));

    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    await within(card).findAllByText('A-01-02');
    const toggle = within(card).getByRole('button', { name: '수불 이력' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    const panel = await within(card).findByRole('region', { name: '수불 이력' });
    const rows = await within(panel).findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('재고 조정 감소');
    expect(rows[0]).toHaveTextContent('A-01-02');
    expect(rows[0]).toHaveTextContent('-1');
    expect(rows[1]).toHaveTextContent('이동');
    expect(rows[1]).toHaveTextContent('입고 기본존 → A-01-02');
    expect(rows[1]).toHaveTextContent('12');
    expect(rows[1]).not.toHaveTextContent('+12');
    expect(rows[2]).toHaveTextContent('입고');
    expect(rows[2]).toHaveTextContent('+15');
    expect(within(rows[2]).getByText(/11/).tagName).toBe('TIME');
    expect(within(panel).queryByText(/RECEIVE|MOVE|ADJUST_DOWN/)).not.toBeInTheDocument();

    await user.click(toggle);
    expect(within(card).queryByRole('region', { name: '수불 이력' })).not.toBeInTheDocument();
  });

  it('수불 이력이 비면 없다고 알리고, 못 불러오면 다시 확인할 수 있다', async () => {
    let down = true;
    renderLookup(
      clientFor(ITEMS, async () => {
        if (down) throw new Error(`GET ${HISTORY_PATH} → 500`);

        return [];
      })
    );
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));
    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    await user.click(within(card).getByRole('button', { name: '수불 이력' }));

    const panel = await within(card).findByRole('region', { name: '수불 이력' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('수불 이력을 불러오지 못했어요.');
    down = false;
    await user.click(within(panel).getByRole('button', { name: '다시 확인' }));
    expect(await within(panel).findByText('이 창고의 수불 이력이 없어요.')).toBeInTheDocument();
  });

  it('시스템 위치를 불러오는 동안에는 적치 대기·보관 위치를 단정하지 않는다', async () => {
    renderLookup(clientFor(ITEMS, async () => HISTORY, () => new Promise(() => {})));
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));

    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    await within(card).findByText('3개');
    expect(within(card).queryByText(/보관 위치|적치 대기/)).not.toBeInTheDocument();
    const defective = within(card).getByText('2개').closest('li')!;
    expect(within(defective).getByText('불량')).toBeInTheDocument();
  });

  it('시스템 위치를 못 불러오면 위치 구분 없이 알리고 다시 확인하면 구분을 보인다', async () => {
    let down = true;
    renderLookup(
      clientFor(ITEMS, async () => HISTORY, async () => {
        if (down) throw new Error(`GET ${SYSTEM_PATH} → 500`);

        return TABLE[SYSTEM_PATH];
      })
    );
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));

    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    const alert = await within(card).findByRole('alert');
    expect(alert).toHaveTextContent('적치 대기 위치를 확인하지 못했어요.');
    await within(card).findByText('3개');
    for (const row of within(card).getAllByRole('listitem')) {
      expect(row).not.toHaveTextContent(/보관 위치|적치 대기/);
    }

    down = false;
    await user.click(within(alert).getByRole('button', { name: '다시 확인' }));
    const inbound = within(card).getByText('입고 기본존').closest('li')!;
    expect(await within(inbound).findByText('적치 대기')).toBeInTheDocument();
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('수불 이력을 다시 열면 이력을 새로 불러온다', async () => {
    let history: unknown[] = [HISTORY[0]];
    renderLookup(clientFor(ITEMS, async () => history));
    const user = await searchFor('셔츠');
    await user.click(await screen.findByRole('button', { name: '코튼셔츠 재고 상세' }));

    const card = await screen.findByRole('complementary', { name: '상품 재고' });
    const toggle = within(card).getByRole('button', { name: '수불 이력' });
    await user.click(toggle);
    let panel = await within(card).findByRole('region', { name: '수불 이력' });
    expect(await within(panel).findAllByRole('listitem')).toHaveLength(1);

    await user.click(toggle);
    history = HISTORY;
    await user.click(toggle);
    panel = await within(card).findByRole('region', { name: '수불 이력' });
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(3));
  });
});
