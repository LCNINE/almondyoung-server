import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
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
import { expect, it } from 'vitest';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import {
  OperationContext,
  type WorkRuntime,
} from '../../core/operations/OperationContext';
import { createOperationRunner } from '../../core/operations/operationRunner';
import { createOperationStore } from '../../core/operations/operationStore';
import { WorkBoundary } from '../../core/operations/WorkBoundary';
import { PurchaseOrderReceiveScreen } from './PurchaseOrderReceiveScreen';
import type { ExpectedArrivalLine, ExpectedArrivalsResult } from './types';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'token',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

let emitScan: (code: string) => void;
function ScanProbe() {
  const bus = useScanBus();
  emitScan = (code) => bus.emit({ code, source: 'hid', at: Date.now() });
  return null;
}

const lineA: ExpectedArrivalLine = {
  skuId: 'sku-a',
  skuName: '아몬드 셔츠',
  skuCode: 'ALMOND-A',
  orderedQty: 10,
  receivedQty: 0,
  outstandingQty: 10,
  expectedArrival: '2026-09-20',
};
const lineB: ExpectedArrivalLine = {
  skuId: 'sku-b',
  skuName: '아몬드 팬츠',
  skuCode: 'ALMOND-B',
  orderedQty: 8,
  receivedQty: 1,
  outstandingQty: 7,
  expectedArrival: '2026-09-21',
};
const arrivals: ExpectedArrivalsResult = {
  warehouseId: 'w-1',
  totalDocuments: 1,
  totalOutstandingQuantity: 17,
  arrivals: [
    {
      source: 'purchase_order',
      documentId: 'po-1',
      type: 'domestic',
      supplier: { id: 'supplier-1', name: '아몬드 공급사' },
      expectedDate: '2026-09-20',
      totalOutstandingQuantity: 17,
      lines: [lineA, lineB],
    },
  ],
};
const skuA = {
  id: 'sku-a',
  code: 'ALMOND-A',
  name: '아몬드 셔츠',
  currentStock: 4,
  safetyStock: 2,
  barcodes: [
    {
      id: 'barcode-a',
      barcode: '880000000001',
      isPrimary: true,
      packingUnit: null,
    },
  ],
};
const skuB = {
  id: 'sku-b',
  code: 'ALMOND-B',
  name: '아몬드 팬츠',
  currentStock: 3,
  safetyStock: 1,
  barcodes: [
    {
      id: 'barcode-b',
      barcode: '880000000002',
      isPrimary: true,
      packingUnit: null,
    },
  ],
};
const skuOutsideOrder = {
  id: 'sku-c',
  code: 'ALMOND-C',
  name: '아몬드 재킷',
  currentStock: 2,
  safetyStock: 1,
  barcodes: [
    {
      id: 'barcode-c',
      barcode: '880000000003',
      isPrimary: true,
      packingUnit: null,
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Draft = {
  active: ExpectedArrivalLine | null;
  scanBump: number;
  seen: string[];
  fresh: null;
  submitted: null | {
    target: ExpectedArrivalLine;
    quantity: number;
    key: string;
  };
};

async function fixture(
  savedDraft: Draft,
  savedScans: Array<{ id: string; data: string }> = [],
  setupStore?: (store: ReturnType<typeof createOperationStore>) => Promise<void>
) {
  const store = createOperationStore(crypto.randomUUID());
  await store.draft('scope:draft:po-inbound:w-1:po-1', () => savedDraft);
  await store.draft('scope:scan:po-inbound:w-1:po-1', () => savedScans);
  await setupStore?.(store);
  const persistedDraft = store.draft.bind(store);
  let scanWriteFailures = 0;
  store.draft = ((id: string, update?: (value: unknown) => unknown) => {
    if (
      scanWriteFailures > 0 &&
      id === 'scope:scan:po-inbound:w-1:po-1' &&
      update
    ) {
      scanWriteFailures -= 1;
      return Promise.reject(new Error('scan storage unavailable'));
    }
    return persistedDraft(id, update);
  }) as typeof store.draft;
  const firstArrivals = deferred<ExpectedArrivalsResult>();
  const arrivalReaders = new Map<string, () => Promise<ExpectedArrivalsResult>>(
    [['w-1', () => firstArrivals.promise]]
  );
  const lookupCodes: string[] = [];
  const lookupReaders = new Map<string, () => Promise<(typeof skuA)[]>>([
    ['880000000001', async () => [skuA]],
    ['880000000002', async () => [skuB]],
    ['880000000003', async () => [skuOutsideOrder]],
  ]);
  const requests: Parameters<ApiClient['request']>[0][] = [];
  const api: ApiClient = {
    request: async <T,>(request: Parameters<ApiClient['request']>[0]) => {
      requests.push(request);
      if (request.path.startsWith('/inventory/expected-arrivals')) {
        const warehouseId = new URLSearchParams(request.path.split('?')[1]).get(
          'warehouseId'
        );
        const read = warehouseId ? arrivalReaders.get(warehouseId) : undefined;
        if (!read) throw new Error(`Unexpected warehouse ${warehouseId}`);
        return (await read()) as T;
      }
      if (request.path.startsWith('/inventory/skus?barcode=')) {
        const code = decodeURIComponent(request.path.split('barcode=')[1]);
        lookupCodes.push(code);
        return ((await lookupReaders.get(code)?.()) ?? []) as T;
      }
      if (request.path === '/purchase-orders/po-1/receipts') {
        const body = request.body as {
          lines: Array<{ skuId: string; quantity: number }>;
        };
        return {
          receiptId: 'receipt-1',
          poId: 'po-1',
          lines: body.lines.map((line, index) => ({
            receiptLineId: `receipt-line-${index + 1}`,
            skuId: line.skuId,
            quantity: line.quantity,
          })),
        } as T;
      }
      throw new Error(
        `Unexpected request ${request.method ?? 'GET'} ${request.path}`
      );
    },
  };
  const runner = createOperationRunner({
    api,
    store,
    getScope: async () => 'scope',
    wait: async () => {},
  });
  const runtime: WorkRuntime = {
    store,
    runner,
    getScope: async () => 'scope',
  };
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const mountView = (warehouseId = 'w-1', poId = 'po-1') => {
    const prefs = createMemoryPrefs({
      'almondwms.warehouse': JSON.stringify({
        id: warehouseId,
        name: '시험창고',
      }),
    });
    const root = createRootRoute({ component: Outlet });
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <PurchaseOrderReceiveScreen poId={poId} />,
    });
    const router = createRouter({
      routeTree: root.addChildren([index]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    return render(
      <SessionProvider session={session}>
        <QueryClientProvider client={queryClient}>
          <ApiClientProvider client={runner}>
            <WarehouseProvider prefs={prefs}>
              <OperationContext.Provider value={runtime}>
                <ScanProvider>
                  <ScanProbe />
                  <WorkBoundary>
                    <RouterProvider router={router} />
                  </WorkBoundary>
                </ScanProvider>
              </OperationContext.Provider>
            </WarehouseProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </SessionProvider>
    );
  };
  const view = mountView();
  return {
    ...view,
    store,
    queryClient,
    lookupCodes,
    requests,
    runner,
    reopen: mountView,
    firstArrivals,
    answerNextArrivals(value: ExpectedArrivalsResult) {
      arrivalReaders.set('w-1', async () => value);
    },
    answerArrivalsFor(warehouseId: string, value: ExpectedArrivalsResult) {
      arrivalReaders.set(warehouseId, async () => value);
    },
    answerLookupFor(code: string, read: () => Promise<(typeof skuA)[]>) {
      lookupReaders.set(code, read);
    },
    failNextScanWrite() {
      scanWriteFailures += 1;
    },
    draft: (warehouseId = 'w-1', poId = 'po-1') =>
      store.draft<Draft>(`scope:draft:po-inbound:${warehouseId}:${poId}`),
    savedScans: () =>
      store.draft<Array<{ id: string; data: string }>>(
        'scope:scan:po-inbound:w-1:po-1'
      ),
  };
}

it('excludes a different purchase-order SKU inside the open sheet and continues the current SKU', async () => {
  const f = await fixture(
    {
      active: null,
      scanBump: 0,
      seen: [],
      fresh: null,
      submitted: null,
    },
    [{ id: 'scan-a-1', data: '880000000001' }]
  );
  await act(async () => f.firstArrivals.resolve(arrivals));

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await waitFor(() =>
    expect(
      within(sheet).getByText('1', { selector: 'div' })
    ).toBeInTheDocument()
  );

  act(() => emitScan('880000000002'));
  expect(
    await within(sheet).findByText(
      '다른 상품을 찍었어요. 현재 상품 수량은 유지됩니다.'
    )
  ).toBeInTheDocument();
  const exclude = within(sheet).getByRole('button', {
    name: '이 스캔 제외',
  });
  expect(exclude).toBeEnabled();
  expect(within(sheet).getByRole('button', { name: '입고' })).toBeDisabled();

  await userEvent.click(exclude);
  await waitFor(() =>
    expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled()
  );
  expect(await f.draft()).toMatchObject({
    active: lineA,
    scanBump: 1,
  });
  expect(
    f.requests.filter(
      (request) => request.path === '/purchase-orders/po-1/receipts'
    )
  ).toHaveLength(0);

  act(() => emitScan('880000000001'));
  await waitFor(() =>
    expect(
      within(sheet).getByText('2', { selector: 'div' })
    ).toBeInTheDocument()
  );
  await userEvent.click(within(sheet).getByRole('button', { name: '입고' }));
  await screen.findByText('아몬드 셔츠 2개 입고됨');
  const receiptRequests = f.requests.filter(
    (request) => request.path === '/purchase-orders/po-1/receipts'
  );
  expect(receiptRequests).toHaveLength(1);
  expect(receiptRequests[0].body).toMatchObject({
    lines: [{ skuId: 'sku-a', quantity: 2 }],
  });
});

it('retries a barcode lookup failure inside the sheet and applies the scan once', async () => {
  const f = await fixture(
    {
      active: lineA,
      scanBump: 1,
      seen: ['scan-a-1'],
      fresh: null,
      submitted: null,
    },
    [{ id: 'scan-a-2', data: '880000000001' }]
  );
  let lookupAttempts = 0;
  f.answerLookupFor('880000000001', async () => {
    lookupAttempts += 1;
    if (lookupAttempts === 1) throw new Error('lookup unavailable');
    return [skuA];
  });
  await act(async () => f.firstArrivals.resolve(arrivals));

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByText(
    '상품을 확인하지 못했어요. 다시 확인해 주세요.'
  );
  expect(
    within(sheet).queryByRole('button', { name: '이 스캔 제외' })
  ).not.toBeInTheDocument();

  const retriedLookup = deferred<(typeof skuA)[]>();
  f.answerLookupFor('880000000001', () => retriedLookup.promise);
  const retry = within(sheet).getByRole('button', { name: '다시 확인' });
  await userEvent.click(retry);
  expect(retry).toBeDisabled();
  expect(await f.savedScans()).toEqual([
    { id: 'scan-a-2', data: '880000000001' },
  ]);

  await act(async () => retriedLookup.resolve([skuA]));
  await waitFor(() =>
    expect(
      within(sheet).getByText('2', { selector: 'div' })
    ).toBeInTheDocument()
  );
  expect(await f.savedScans()).toEqual([]);
  expect((await f.draft())?.seen).toEqual(['scan-a-1', 'scan-a-2']);
});

it('retries a failed scan save without allowing the unsaved event to be excluded', async () => {
  const f = await fixture(
    {
      active: lineA,
      scanBump: 1,
      seen: ['scan-a-1'],
      fresh: null,
      submitted: null,
    },
    []
  );
  await act(async () => f.firstArrivals.resolve(arrivals));
  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await waitFor(() =>
    expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled()
  );

  f.failNextScanWrite();
  act(() => emitScan('880000000001'));
  await within(sheet).findByText(/스캔을 저장하지 못했어요/);
  expect(
    within(sheet).queryByRole('button', { name: '이 스캔 제외' })
  ).not.toBeInTheDocument();
  expect(within(sheet).getByRole('button', { name: '입고' })).toBeDisabled();

  f.failNextScanWrite();
  await userEvent.click(
    within(sheet).getByRole('button', { name: '다시 확인' })
  );
  expect(within(sheet).getByRole('alert')).toHaveTextContent(
    '스캔을 저장하지 못했어요.'
  );

  await userEvent.click(
    within(sheet).getByRole('button', { name: '다시 확인' })
  );
  await waitFor(() =>
    expect(
      within(sheet).getByText('2', { selector: 'div' })
    ).toBeInTheDocument()
  );
  expect((await f.draft())?.seen).toHaveLength(2);
});

it('retains a confirmed-unapplied head when excluding it cannot be saved', async () => {
  const f = await fixture(
    {
      active: lineA,
      scanBump: 1,
      seen: ['scan-a-1'],
      fresh: null,
      submitted: null,
    },
    [{ id: 'scan-b-1', data: '880000000002' }]
  );
  await act(async () => f.firstArrivals.resolve(arrivals));

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  const exclude = await within(sheet).findByRole('button', {
    name: '이 스캔 제외',
  });
  f.failNextScanWrite();
  await userEvent.click(exclude);

  await within(sheet).findByText(
    '이 스캔을 제외하지 못했어요. 저장 공간을 확인한 뒤 다시 시도해 주세요.'
  );
  expect(await f.savedScans()).toEqual([
    { id: 'scan-b-1', data: '880000000002' },
  ]);
  expect(exclude).toBeEnabled();
  expect(within(sheet).getByRole('button', { name: '입고' })).toBeDisabled();

  await userEvent.click(exclude);
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled();
  expect(await f.draft()).toMatchObject({ scanBump: 1 });
});

it('identifies an unregistered barcode inside the open sheet before exclusion', async () => {
  const f = await fixture(
    {
      active: lineA,
      scanBump: 1,
      seen: ['scan-a-1'],
      fresh: null,
      submitted: null,
    },
    [{ id: 'scan-unknown', data: '999999999999' }]
  );
  await act(async () => f.firstArrivals.resolve(arrivals));

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByText(
    '등록되지 않은 바코드예요. 현재 상품 수량은 유지됩니다.'
  );
  expect(
    within(sheet).getByRole('button', { name: '이 스캔 제외' })
  ).toBeEnabled();
  expect(
    within(sheet).queryByRole('button', { name: '다시 확인' })
  ).not.toBeInTheDocument();
  expect(await f.draft()).toMatchObject({ scanBump: 1 });
});

it('identifies a registered SKU outside this purchase order before exclusion', async () => {
  const f = await fixture(
    {
      active: lineA,
      scanBump: 1,
      seen: ['scan-a-1'],
      fresh: null,
      submitted: null,
    },
    [{ id: 'scan-c-1', data: '880000000003' }]
  );
  await act(async () => f.firstArrivals.resolve(arrivals));

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByText(
    '이 발주에 없는 상품이에요. 현재 상품 수량은 유지됩니다.'
  );
  expect(
    within(sheet).getByRole('button', { name: '이 스캔 제외' })
  ).toBeEnabled();
  expect(await f.savedScans()).toEqual([
    { id: 'scan-c-1', data: '880000000003' },
  ]);
  expect(await f.draft()).toMatchObject({ scanBump: 1 });
});

it('does not allow excluding a scan while the receipt request is unresolved', async () => {
  const submitted = { target: lineA, quantity: 1, key: 'receive-key' };
  const f = await fixture(
    {
      active: lineA,
      scanBump: 1,
      seen: ['scan-a-1'],
      fresh: null,
      submitted,
    },
    [{ id: 'scan-b-1', data: '880000000002' }]
  );
  await act(async () => f.firstArrivals.resolve(arrivals));

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByText(
    '다른 상품을 찍었어요. 현재 상품 수량은 유지됩니다.'
  );
  expect(
    within(sheet).queryByRole('button', { name: '이 스캔 제외' })
  ).not.toBeInTheDocument();
  expect(await f.savedScans()).toEqual([
    { id: 'scan-b-1', data: '880000000002' },
  ]);
  expect(await f.draft()).toMatchObject({ submitted, scanBump: 1 });
});

it('preserves the restored quantity while the purchase-order list is still loading', async () => {
  const f = await fixture({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
    fresh: null,
    submitted: null,
  });

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  expect(
    await within(sheet).findByText('발주 정보를 확인하고 있어요.')
  ).toBeInTheDocument();
  expect((await f.draft())?.scanBump).toBe(3);

  await act(async () => f.firstArrivals.resolve(arrivals));
  expect(
    await within(sheet).findByText('3', { selector: 'div' })
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled()
  );
  expect((await f.draft())?.scanBump).toBe(3);
  await userEvent.click(within(sheet).getByRole('button', { name: '입고' }));
  expect(await screen.findByText('아몬드 셔츠 3개 입고됨')).toBeInTheDocument();
  const receive = f.requests.find(
    (request) => request.path === '/purchase-orders/po-1/receipts'
  );
  expect(receive?.body).toMatchObject({
    warehouseId: 'w-1',
    lines: [{ skuId: 'sku-a', quantity: 3 }],
  });
  expect(receive?.idempotencyKey).toBeTruthy();
});

it('retains restored scans across a list failure and applies each once after retry', async () => {
  const restored = await fixture(
    {
      active: lineA,
      scanBump: 3,
      seen: ['a1', 'a2', 'a3'],
      fresh: null,
      submitted: null,
    },
    [
      { id: 'scan-4', data: '880000000001' },
      { id: 'scan-5', data: '880000000001' },
    ]
  );

  const firstSheet = await screen.findByRole('dialog', {
    name: '입고 수량',
  });
  await within(firstSheet).findByText('발주 정보를 확인하고 있어요.');
  expect(await restored.savedScans()).toHaveLength(2);
  restored.unmount();
  restored.reopen();

  await act(async () =>
    restored.firstArrivals.reject(new Error('network unavailable'))
  );
  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByRole('button', { name: '다시 확인' });
  expect(await restored.savedScans()).toEqual([
    { id: 'scan-4', data: '880000000001' },
    { id: 'scan-5', data: '880000000001' },
  ]);
  expect(restored.lookupCodes).toEqual([]);

  restored.answerNextArrivals(arrivals);
  await userEvent.click(
    within(sheet).getByRole('button', { name: '다시 확인' })
  );
  await waitFor(async () => expect(await restored.savedScans()).toEqual([]));
  expect(
    await within(sheet).findByText('5', { selector: 'div' })
  ).toBeInTheDocument();
  expect(restored.lookupCodes).toEqual(['880000000001', '880000000001']);
  expect((await restored.draft())?.seen).toEqual([
    'a1',
    'a2',
    'a3',
    'scan-4',
    'scan-5',
  ]);
});

it('persists new scans in order while the list is loading and prevents discarding them', async () => {
  const f = await fixture({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
    fresh: null,
    submitted: null,
  });
  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByText('발주 정보를 확인하고 있어요.');

  act(() => {
    emitScan('880000000001');
    emitScan('880000000001');
  });
  await waitFor(async () => expect(await f.savedScans()).toHaveLength(2));
  expect(
    within(sheet).queryByRole('button', { name: '입력 취소' })
  ).not.toBeInTheDocument();
  expect(f.lookupCodes).toEqual([]);

  await act(async () => f.firstArrivals.resolve(arrivals));
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  expect(
    await within(sheet).findByText('5', { selector: 'div' })
  ).toBeInTheDocument();
  expect(f.lookupCodes).toEqual(['880000000001', '880000000001']);
});

it('turns a queued scan into a recoverable unapplied error when the restored line changed', async () => {
  const f = await fixture(
    {
      active: lineA,
      scanBump: 3,
      seen: ['a1', 'a2', 'a3'],
      fresh: null,
      submitted: null,
    },
    [{ id: 'scan-4', data: '880000000001' }]
  );
  const reduced = {
    ...arrivals,
    totalOutstandingQuantity: 9,
    arrivals: [
      {
        ...arrivals.arrivals[0],
        totalOutstandingQuantity: 9,
        lines: [{ ...lineA, receivedQty: 8, outstandingQty: 2 }, lineB],
      },
    ],
  };

  await act(async () => f.firstArrivals.resolve(reduced));
  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByText(
    '발주 상태가 바뀌어 이 스캔을 반영하지 못했어요. 입고내역을 확인해 주세요.'
  );
  expect(f.lookupCodes).toEqual([]);
  expect(await f.savedScans()).toEqual([
    { id: 'scan-4', data: '880000000001' },
  ]);
  expect(
    within(sheet).getByRole('button', { name: '이 스캔 제외' })
  ).toBeInTheDocument();
  expect(
    within(sheet).getAllByRole('button', { name: '다시 확인' })
  ).toHaveLength(2);
  expect(await f.draft()).toMatchObject({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
  });

  f.answerNextArrivals(arrivals);
  await userEvent.click(
    within(sheet).getAllByRole('button', { name: '다시 확인' })[0]
  );
  await waitFor(() =>
    expect(
      within(sheet).queryByText('발주 상태가 바뀌었어요.')
    ).not.toBeInTheDocument()
  );
  await userEvent.click(
    within(sheet).getByRole('button', { name: '다시 확인' })
  );
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  expect(
    await within(sheet).findByText('4', { selector: 'div' })
  ).toBeInTheDocument();
  expect((await f.draft())?.seen).toEqual(['a1', 'a2', 'a3', 'scan-4']);
});

it('removes an already-applied queue record even when the authoritative line later changed', async () => {
  const f = await fixture(
    {
      active: lineA,
      scanBump: 4,
      seen: ['a1', 'a2', 'a3', 'scan-4'],
      fresh: null,
      submitted: null,
    },
    [{ id: 'scan-4', data: '880000000001' }]
  );
  const reduced = {
    ...arrivals,
    totalOutstandingQuantity: 9,
    arrivals: [
      {
        ...arrivals.arrivals[0],
        totalOutstandingQuantity: 9,
        lines: [{ ...lineA, receivedQty: 8, outstandingQty: 2 }, lineB],
      },
    ],
  };

  await act(async () => f.firstArrivals.resolve(reduced));
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  expect(f.lookupCodes).toEqual([]);
  expect(
    screen.queryByText('상품을 확인하지 못했어요.')
  ).not.toBeInTheDocument();
  expect(await f.draft()).toMatchObject({
    active: lineA,
    scanBump: 4,
    seen: ['a1', 'a2', 'a3', 'scan-4'],
  });
});

it('keeps a submitted draft when the line disappears without confirmation of its original key', async () => {
  const submitted = { target: lineA, quantity: 3, key: 'receive-key' };
  const f = await fixture({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
    fresh: null,
    submitted,
  });
  const response = {
    ...arrivals,
    totalOutstandingQuantity: 7,
    arrivals: [
      {
        ...arrivals.arrivals[0],
        totalOutstandingQuantity: 7,
        lines: [lineB],
      },
    ],
  };

  await act(async () => f.firstArrivals.resolve(response));
  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  expect(within(sheet).getByRole('alert')).toHaveTextContent(
    '발주 상태가 바뀌었어요.'
  );
  expect(
    within(sheet).queryByRole('button', { name: '입력 취소' })
  ).not.toBeInTheDocument();
  expect(await f.draft()).toMatchObject({
    active: lineA,
    scanBump: 3,
    submitted,
  });
});

it('locks edits and cancellation but retries an unresolved submission with its original body and key', async () => {
  const submitted = { target: lineA, quantity: 3, key: 'receive-key' };
  const f = await fixture({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
    fresh: null,
    submitted,
  });

  await act(async () => f.firstArrivals.resolve(arrivals));
  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  const retry = within(sheet).getByRole('button', { name: '입고' });
  await waitFor(() => expect(retry).toBeEnabled());
  expect(
    within(sheet).getByLabelText('입고 수량 직접 입력 (낱개)')
  ).toBeDisabled();
  expect(within(sheet).getByRole('button', { name: '1' })).toBeDisabled();
  expect(within(sheet).getByRole('button', { name: '취소' })).toBeDisabled();

  await userEvent.click(retry);
  expect(await screen.findByText('아몬드 셔츠 3개 입고됨')).toBeInTheDocument();
  const calls = f.requests.filter(
    (request) => request.path === '/purchase-orders/po-1/receipts'
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].idempotencyKey).toBe('receive-key');
  expect(calls[0].body).toEqual({
    warehouseId: 'w-1',
    lines: [{ skuId: 'sku-a', quantity: 3 }],
    contractVersion: 2,
    idempotencyKey: 'receive-key',
  });
});

it('releases a rejected submission across remount and corrects it with a fresh key', async () => {
  const submitted = { target: lineA, quantity: 3, key: 'receive-key' };
  const originalBody = {
    warehouseId: 'w-1',
    lines: [{ skuId: 'sku-a', quantity: 3 }],
    contractVersion: 2,
    idempotencyKey: 'receive-key',
  };
  const f = await fixture(
    {
      active: lineA,
      scanBump: 3,
      seen: ['a1', 'a2', 'a3'],
      fresh: null,
      submitted,
    },
    [],
    async (store) => {
      await store.begin({
        id: 'receive-key',
        scope: 'scope',
        resource: '/purchase-orders/po-1',
        path: '/purchase-orders/po-1/receipts',
        method: 'POST',
        bodyJson: JSON.stringify(originalBody),
        createdAt: Date.now(),
      });
      await store.finish(
        'receive-key',
        'rejected',
        undefined,
        'INVALID_RECEIPT_QUANTITY'
      );
    }
  );

  await act(async () => f.firstArrivals.resolve(arrivals));
  await waitFor(async () =>
    expect(await f.draft()).toMatchObject({
      active: lineA,
      scanBump: 3,
      seen: ['a1', 'a2', 'a3'],
      submitted: null,
    })
  );
  f.unmount();
  f.reopen();

  const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
  const input = within(sheet).getByLabelText('입고 수량 직접 입력 (낱개)');
  await waitFor(() => expect(input).toBeEnabled());
  expect(within(sheet).getByRole('button', { name: '취소' })).toBeEnabled();
  expect(await f.draft()).toMatchObject({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
    submitted: null,
  });

  await userEvent.clear(input);
  await userEvent.type(input, '4');
  await userEvent.click(within(sheet).getByRole('button', { name: '입고' }));

  expect(await screen.findByText('아몬드 셔츠 4개 입고됨')).toBeInTheDocument();
  const calls = f.requests.filter(
    (request) => request.path === '/purchase-orders/po-1/receipts'
  );
  expect(calls).toHaveLength(1);
  expect(calls[0].idempotencyKey).not.toBe('receive-key');
  expect(calls[0].body).toEqual({
    warehouseId: 'w-1',
    lines: [{ skuId: 'sku-a', quantity: 4 }],
    contractVersion: 2,
    idempotencyKey: calls[0].idempotencyKey,
  });
  expect(await f.store.get(calls[0].idempotencyKey!)).toMatchObject({
    status: 'confirmed',
  });
});

it('moves a submitted draft to putaway only when its original operation key is confirmed', async () => {
  const submitted = { target: lineA, quantity: 3, key: 'receive-key' };
  const f = await fixture(
    {
      active: lineA,
      scanBump: 3,
      seen: ['a1', 'a2', 'a3'],
      fresh: null,
      submitted,
    },
    [],
    async (store) => {
      await store.begin({
        id: 'receive-key',
        scope: 'scope',
        resource: '/purchase-orders/po-1',
        path: '/purchase-orders/po-1/receipts',
        method: 'POST',
        bodyJson: JSON.stringify({
          warehouseId: 'w-1',
          lines: [{ skuId: 'sku-a', quantity: 3 }],
          contractVersion: 2,
          idempotencyKey: 'receive-key',
        }),
        createdAt: Date.now(),
      });
      await store.finish('receive-key', 'confirmed', {
        receiptId: 'receipt-1',
        poId: 'po-1',
        lines: [
          {
            receiptLineId: 'receipt-line-1',
            skuId: 'sku-a',
            quantity: 3,
          },
        ],
      });
    }
  );

  expect(await screen.findByText('아몬드 셔츠 3개 입고됨')).toBeInTheDocument();
  expect(await f.draft()).toMatchObject({
    active: null,
    scanBump: 0,
    submitted: null,
    fresh: {
      lineId: 'receipt-line-1',
      skuId: 'sku-a',
      quantity: 3,
      putawayDoneQty: 0,
    },
  });
});

it('reconciles a response-lost operation through the runner with its saved body and key', async () => {
  const submitted = { target: lineA, quantity: 3, key: 'receive-key' };
  const body = {
    warehouseId: 'w-1',
    lines: [{ skuId: 'sku-a', quantity: 3 }],
    contractVersion: 2,
    idempotencyKey: 'receive-key',
  };
  const f = await fixture(
    {
      active: lineA,
      scanBump: 3,
      seen: ['a1', 'a2', 'a3'],
      fresh: null,
      submitted,
    },
    [],
    async (store) => {
      await store.begin({
        id: 'receive-key',
        scope: 'scope',
        resource: '/purchase-orders/po-1',
        path: '/purchase-orders/po-1/receipts',
        method: 'POST',
        bodyJson: JSON.stringify(body),
        createdAt: Date.now(),
      });
      await store.finish('receive-key', 'sending');
      await store.finish('receive-key', 'uncertain');
    }
  );

  await act(async () => f.firstArrivals.resolve(arrivals));
  await waitFor(() =>
    expect(f.runner.getSnapshot().map((operation) => operation.id)).toContain(
      'receive-key'
    )
  );
  await act(async () => f.runner.retryPending());

  expect(await screen.findByText('아몬드 셔츠 3개 입고됨')).toBeInTheDocument();
  const calls = f.requests.filter(
    (request) => request.path === '/purchase-orders/po-1/receipts'
  );
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    method: 'POST',
    idempotencyKey: 'receive-key',
    body,
    bodyJson: JSON.stringify(body),
  });
  expect(await f.store.get('receive-key')).toMatchObject({
    status: 'confirmed',
    bodyJson: JSON.stringify(body),
  });
});

it('does not let a late response from the previous warehouse change the current draft', async () => {
  const f = await fixture({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
    fresh: null,
    submitted: null,
  });
  await screen.findByText('발주 정보를 확인하고 있어요.');
  f.unmount();

  const currentDraft: Draft = {
    active: lineB,
    scanBump: 2,
    seen: ['b1', 'b2'],
    fresh: null,
    submitted: null,
  };
  await f.store.draft('scope:draft:po-inbound:w-2:po-2', () => currentDraft);
  f.answerArrivalsFor('w-2', {
    warehouseId: 'w-2',
    totalDocuments: 1,
    totalOutstandingQuantity: 7,
    arrivals: [
      {
        ...arrivals.arrivals[0],
        documentId: 'po-2',
        totalOutstandingQuantity: 7,
        lines: [lineB],
      },
    ],
  });
  f.reopen('w-2', 'po-2');
  const currentSheet = await screen.findByRole('dialog', {
    name: '입고 수량',
  });
  expect(
    await within(currentSheet).findByText('2', { selector: 'div' })
  ).toBeInTheDocument();

  await act(async () => f.firstArrivals.resolve(arrivals));
  await waitFor(async () =>
    expect(await f.draft('w-2', 'po-2')).toEqual(currentDraft)
  );
  expect(within(currentSheet).getByText('아몬드 팬츠')).toBeInTheDocument();
});

it.each([
  {
    name: 'the restored line is missing',
    response: {
      ...arrivals,
      totalOutstandingQuantity: 7,
      arrivals: [
        {
          ...arrivals.arrivals[0],
          totalOutstandingQuantity: 7,
          lines: [lineB],
        },
      ],
    },
  },
  {
    name: 'its outstanding quantity decreased',
    response: {
      ...arrivals,
      totalOutstandingQuantity: 9,
      arrivals: [
        {
          ...arrivals.arrivals[0],
          totalOutstandingQuantity: 9,
          lines: [{ ...lineA, receivedQty: 8, outstandingQty: 2 }, lineB],
        },
      ],
    },
  },
])(
  'keeps pending input for an explicit decision when $name',
  async ({ response }) => {
    const f = await fixture({
      active: lineA,
      scanBump: 3,
      seen: ['a1', 'a2', 'a3'],
      fresh: null,
      submitted: null,
    });

    await act(async () => f.firstArrivals.resolve(response));
    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    expect(within(sheet).getByRole('alert')).toHaveTextContent(
      '발주 상태가 바뀌었어요. 입고내역을 확인해 주세요.'
    );
    expect(within(sheet).getByRole('button', { name: '입고' })).toBeDisabled();
    expect((await f.draft())?.scanBump).toBe(3);
    expect((await f.draft())?.active).toEqual(lineA);

    await userEvent.click(
      within(sheet).getByRole('button', { name: '입력 취소' })
    );
    await waitFor(async () => expect((await f.draft())?.active).toBeNull());
  }
);
