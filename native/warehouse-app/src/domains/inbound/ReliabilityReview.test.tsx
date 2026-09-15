import 'fake-indexeddb/auto';
import { createOperationRunner } from '../../core/operations/operationRunner';
import {
  createOperationStore,
  type OperationStore,
} from '../../core/operations/operationStore';
import { OperationContext } from '../../core/operations/OperationContext';
import { it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { QuickInboundScreen } from './QuickInboundScreen';
import { PurchaseOrderReceiveScreen } from './PurchaseOrderReceiveScreen';

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
    <button
      type="button"
      onClick={() => bus.emit({ code, source: 'hid', at: 1 })}
    >
      스캔:{code}
    </button>
  );
}

function renderScreen(
  calls: Call[],
  gate?: Promise<void>,
  database?: string,
  mode: 'quick' | 'po' = 'quick',
  configureStore?: (store: OperationStore) => void,
  receiptCanceled = false
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/inbound/receipts?'))
        return {
          serverTime: new Date().toISOString(),
          total: 1,
          items: [
            {
              id: 'r-1',
              warehouseId: 'w-1',
              method: 'simple',
              occurredAt: new Date().toISOString(),
              status: receiptCanceled ? 'voided' : 'posted',
              totalQuantity: 20,
              lines: [
                {
                  id: 'ln-1',
                  skuId: 's1',
                  skuCode: 'CT-001',
                  skuName: '코튼셔츠',
                  quantity: 20,
                  source: 'direct',
                  originLocationCode: 'INBOUND',
                  canCancel: !receiptCanceled,
                  cancelBlockReason: receiptCanceled
                    ? 'ALREADY_CANCELED'
                    : null,
                  canceledQty: receiptCanceled ? 20 : 0,
                  returnedQty: 0,
                  putawayFromOriginQty: 0,
                },
              ],
            },
          ],
        };
      if (o.path.startsWith('/inventory/expected-arrivals'))
        return { arrivals: [] };
      if (o.path.startsWith('/inventory/skus?barcode=880')) {
        if (gate) await gate;
        return BOX_SKU;
      }
      if (o.path.startsWith('/inventory/skus?barcode=')) return [];
      if (o.path === '/inbound/simple') {
        return {
          id: 'r-1',
          lines: [{ id: 'ln-1', skuId: 's1', quantity: 20 }],
        };
      }
      if (o.path === '/inbound/putaway') return { success: true };
      if (o.path.startsWith('/locations/warehouses/')) {
        // 검색어가 한글이면 URLSearchParams 가 percent-encode 한다 — 디코드해서 비교한다.
        const path = decodeURIComponent(o.path);
        if (path.includes('B-05')) {
          return {
            items: [{ id: 'l-dst', code: 'B-05-03', displayName: 'B-05-03' }],
            total: 1,
          };
        }
        return { items: [], total: 0 };
      }
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const store = createOperationStore(database ?? crypto.randomUUID());
  configureStore?.(store);
  const runtime = database
    ? {
        store,
        getScope: async () => 'actor|local',
        runner: createOperationRunner({
          api: client,
          store,
          getScope: async () => 'actor|local',
          wait: async () => {},
        }),
      }
    : null;
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
        {/* 미등록 바코드 — 등록 후 재스캔이 가드를 뚫는지 확인하는 테스트 전용 */}
        <ScanButton code="9999" />
        {mode === 'quick' ? (
          <QuickInboundScreen />
        ) : (
          <PurchaseOrderReceiveScreen poId="po-1" />
        )}
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
        <ApiClientProvider client={runtime?.runner ?? client}>
          <OperationContext.Provider value={runtime}>
            <WarehouseProvider prefs={prefs}>
              <ScanProvider>{children}</ScanProvider>
            </WarehouseProvider>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router} />, { wrapper });
}

it('keeps registration blocked after a scan cannot be saved, then recovers that scan without rescanning', async () => {
  let diskFull = false;
  const calls: Call[] = [];
  renderScreen(calls, undefined, crypto.randomUUID(), 'quick', (store) => {
    const draft = store.draft;
    vi.spyOn(store, 'draft').mockImplementation(async (id, update) => {
      if (diskFull && id.includes(':scan:') && update)
        throw new DOMException('disk full', 'QuotaExceededError');
      return draft(id, update);
    });
  });
  const user = userEvent.setup();
  await screen.findByText('간편입고');
  await waitFor(() =>
    expect(
      screen.queryByText('작업을 불러오고 있어요.')
    ).not.toBeInTheDocument()
  );
  await waitFor(() =>
    expect(screen.getByLabelText('바코드 입력')).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
  );
  diskFull = true;
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await screen.findByRole('button', { name: '다시 확인' });
  expect(screen.getByRole('alert')).toHaveTextContent(
    /화면을 유지.*저장 공간.*다시 찍지 마세요/
  );
  expect(screen.getByRole('button', { name: '등록' })).toBeDisabled();
  expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('1');
  expect(calls.filter((c) => c.path === '/inbound/simple')).toHaveLength(0);

  diskFull = false;
  await user.click(screen.getByRole('button', { name: '다시 확인' }));
  await waitFor(() =>
    expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('2')
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
  );
  await user.click(screen.getByRole('button', { name: '등록' }));
  await waitFor(() =>
    expect(calls.find((c) => c.path === '/inbound/simple')?.body).toMatchObject(
      {
        items: [{ skuId: 's1', quantity: 2 }],
      }
    )
  );
});

it('REVIEW: two physical scans while lookup is pending must count twice', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const calls: Call[] = [];
  renderScreen(calls, gate);
  await screen.findByText('간편입고');
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await waitFor(() =>
    expect(calls.filter((c) => c.path.includes('barcode=8801'))).toHaveLength(1)
  );
  await act(async () => {
    release();
    await gate;
  });
  await screen.findByText('코튼셔츠');
  await waitFor(() =>
    expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('2')
  );
  expect(calls.filter((c) => c.path.includes('barcode=8801'))).toHaveLength(2);
});

it('does not register a restored partial cart while saved scans cannot be read', async () => {
  const database = crypto.randomUUID();
  const store = createOperationStore(database);
  await store.draft('actor|local:draft:quick-inbound:w-1', () => ({
    cart: [
      { skuId: 's1', skuCode: 'CT-001', skuName: '코튼셔츠', quantity: 1 },
    ],
    staged: [],
    seen: ['first-scan'],
    key: 'restored-receipt',
  }));
  await store.draft('actor|local:scan:quick-inbound:w-1', () => [
    { id: 'second-scan', data: '8801' },
  ]);
  let unavailable = true;
  let cartReconciled = false;
  renderScreen([], undefined, database, 'quick', (store) => {
    const draft = store.draft;
    vi.spyOn(store, 'draft').mockImplementation(async (id, update) => {
      if (unavailable && id.includes(':scan:') && !update)
        throw new DOMException('storage unavailable', 'UnknownError');
      const value = await draft(id, update);
      if (id.includes(':draft:') && update) cartReconciled = true;
      return value;
    });
  });
  const user = userEvent.setup();
  await screen.findByRole('button', { name: '다시 확인' });
  await screen.findByLabelText('코튼셔츠 수량');
  await waitFor(() => expect(cartReconciled).toBe(true));
  expect(screen.getByRole('button', { name: '등록' })).toBeDisabled();
  unavailable = false;
  await user.click(screen.getByRole('button', { name: '다시 확인' }));
  await waitFor(() =>
    expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('2')
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '등록' })).toBeEnabled()
  );
});

it('restores accepted scan counts after remount without sending inventory again', async () => {
  const database = crypto.randomUUID(),
    calls: Call[] = [];
  const first = renderScreen(calls, undefined, database);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '스캔:8801' })).toBeEnabled()
  );
  // Initial IndexedDB load must finish before the screen accepts physical input.
  await waitFor(() =>
    expect(
      screen.queryByText('작업을 불러오고 있어요.')
    ).not.toBeInTheDocument()
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await waitFor(() =>
    expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('2')
  );
  first.unmount();
  renderScreen(calls, undefined, database);
  await waitFor(() =>
    expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('2')
  );
  expect(calls.filter((c) => c.path === '/inbound/simple')).toHaveLength(0);
});

for (const mode of ['quick', 'po'] as const) {
  it(`${mode}: restores confirmed partial putaway after crash before its completion callback`, async () => {
    const database = crypto.randomUUID();
    const store = createOperationStore(database);
    const line = {
      lineId: 'ln-1',
      skuId: 's1',
      skuCode: 'CT-001',
      skuName: '코튼셔츠',
      quantity: 10,
      putawayDoneQty: 0,
    };
    await store.draft(
      `actor|local:draft:${mode === 'quick' ? 'quick-inbound:w-1' : 'po-inbound:w-1:po-1'}`,
      () =>
        mode === 'quick'
          ? {
              cart: [],
              staged: [line],
              seen: [],
              key: 'receipt-key',
              receiptId: 'r-1',
            }
          : {
              active: null,
              scanBump: 0,
              seen: [],
              fresh: line,
              submitted: null,
            }
    );
    await store.begin({
      id: 'putaway-key',
      scope: 'actor|local',
      resource: 'receipt:ln-1',
      method: 'POST',
      path: '/inbound/putaway',
      bodyJson: JSON.stringify({
        lineId: 'ln-1',
        toLocationId: 'dst',
        quantity: 3,
      }),
      createdAt: Date.now(),
    });
    await store.finish('putaway-key', 'confirmed', { success: true });
    const calls: Call[] = [];
    const first = renderScreen(calls, undefined, database, mode);
    await screen.findByText(/잔여 7개 · 3개 적치됨/);
    first.unmount();
    renderScreen(calls, undefined, database, mode);
    await screen.findByText(/잔여 7개 · 3개 적치됨/);
    expect(calls.filter((c) => c.path === '/inbound/putaway')).toHaveLength(0);
  });
}

it('취소 후 재시작한 간편입고는 취소 이력을 확인하고 적치를 열지 않는다', async () => {
  const database = crypto.randomUUID();
  const store = createOperationStore(database);
  await store.draft('actor|local:draft:quick-inbound:w-1', () => ({
    cart: [],
    staged: [
      {
        lineId: 'ln-1',
        skuId: 's1',
        skuName: '코튼셔츠',
        skuCode: 'CT-001',
        quantity: 20,
        putawayDoneQty: 0,
      },
    ],
    seen: [],
    key: 'receipt-key',
    receiptId: 'r-1',
  }));
  const calls: Call[] = [];
  renderScreen(calls, undefined, database, 'quick', undefined, true);
  expect(await screen.findByText('취소됨')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '적치' })
  ).not.toBeInTheDocument();
  expect(
    calls.some(
      (c) =>
        c.path.includes('receiptId=r-1') &&
        c.path.includes('warehouseId=w-1') &&
        c.path.includes('status=all')
    )
  ).toBe(true);
});

it('keeps confirmed inbound cart locked until original key reconciliation completes', async () => {
  const database = crypto.randomUUID();
  const store = createOperationStore(database);
  await store.draft('actor|local:draft:quick-inbound:w-1', () => ({
    cart: [
      { skuId: 's1', skuCode: 'CT-001', skuName: '코튼셔츠', quantity: 20 },
    ],
    staged: [],
    seen: [],
    key: 'confirmed-receipt',
    receiptId: null,
  }));
  await store.begin({
    id: 'confirmed-receipt',
    scope: 'actor|local',
    resource: '/inbound/simple:w-1',
    method: 'POST',
    path: '/inbound/simple',
    bodyJson: '{}',
    createdAt: Date.now(),
  });
  await store.finish('confirmed-receipt', 'confirmed', {
    id: 'r-1',
    lines: [{ id: 'ln-1', skuId: 's1', quantity: 20 }],
  });
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const calls: Call[] = [];
  renderScreen(calls, undefined, database, 'quick', (localStore) => {
    const get = localStore.get;
    vi.spyOn(localStore, 'get').mockImplementation(async (id) => {
      if (id === 'confirmed-receipt') await gate;
      return get(id);
    });
  });
  const quantity = await screen.findByLabelText('코튼셔츠 수량');
  expect(quantity).toBeDisabled();
  expect(screen.getByLabelText('코튼셔츠 삭제')).toBeDisabled();
  expect(screen.getByLabelText('바코드 입력')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: '스캔:8801' }));
  await act(async () => {
    release();
    await gate;
  });
  await screen.findByText('적치 대기');
  expect(calls.filter((c) => c.path === '/inbound/simple')).toHaveLength(0);
  expect(
    (await store.draft<{ key: string }>('actor|local:draft:quick-inbound:w-1'))
      ?.key
  ).toBe('confirmed-receipt');
});
