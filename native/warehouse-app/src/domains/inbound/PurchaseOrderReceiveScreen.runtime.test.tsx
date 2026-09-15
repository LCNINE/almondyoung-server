import { InboundHistoryScreen } from './InboundHistoryScreen';
import { PutawaySheet } from './PutawaySheet';
import 'fake-indexeddb/auto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
import type { SkuSearchItem } from '../inventory/types';

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
const skuA: SkuSearchItem = {
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
  quantity?: {
    text: string;
    source: 'suggested' | 'manual' | 'scanned';
  } | null;
  seen: string[];
  fresh: import('./types').FreshLine | null;
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
  let draftWriteGate: Promise<void> | undefined;
  let scanWriteGate: Promise<void> | undefined;
  let draftWriteFailures = 0;
  let scanWriteCount = 0;
  store.draft = (async (id: string, update?: (value: unknown) => unknown) => {
    if (update && id === 'scope:draft:po-inbound:w-1:po-1') {
      const gate = draftWriteGate;
      draftWriteGate = undefined;
      if (gate) await gate;
      if (draftWriteFailures > 0) {
        draftWriteFailures -= 1;
        throw new Error('receipt draft storage unavailable');
      }
    }
    if (update && id === 'scope:scan:po-inbound:w-1:po-1') {
      scanWriteCount += 1;
      const gate = scanWriteGate;
      scanWriteGate = undefined;
      if (gate) await gate;
    }
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
  let receiptState = {
    lineId: 'receipt-line-1',
    receiptId: 'receipt-1',
    warehouseId: 'w-1',
    source: 'purchase_order',
    receiptStatus: 'posted',
    skuId: 'sku-a',
    skuCode: 'ALMOND-A',
    skuName: '아몬드 셔츠',
    originLocationId: 'origin-1',
    originLocationCode: '입고기본존',
    quantity: 3,
    pendingQty: 3,
    putawayFromOriginQty: 0,
    returnedQty: 0,
    canceledQty: 0,
    canPutaway: true,
    putawayBlockReason: null as string | null,
    canCancel: true,
    cancelBlockReason: null as string | null,
  };
  const requests: Parameters<ApiClient['request']>[0][] = [];
  const api: ApiClient = {
    request: async <T,>(request: Parameters<ApiClient['request']>[0]) => {
      requests.push(request);
      if (request.path.startsWith('/inbound/lines/')) return receiptState as T;
      if (request.path.startsWith('/inbound/receipts?'))
        return {
          serverTime: new Date().toISOString(),
          total: 1,
          items: [
            {
              id: 'receipt-1',
              warehouseId: 'w-1',
              method: 'simple',
              occurredAt: new Date().toISOString(),
              status: receiptState.receiptStatus,
              totalQuantity: 3,
              lines: [{ ...receiptState, id: receiptState.lineId }],
            },
          ],
        } as T;
      if (
        request.path === '/purchase-orders/receipt-lines/receipt-line-1/cancel'
      ) {
        receiptState = {
          ...receiptState,
          receiptStatus: 'voided',
          pendingQty: 0,
          canceledQty: 3,
          canPutaway: false,
          putawayBlockReason: 'CANCELED',
          canCancel: false,
          cancelBlockReason: 'CANCELED',
        };
        return {
          receiptLineId: 'receipt-line-1',
          poId: 'po-1',
          skuId: 'sku-a',
          quantity: 3,
        } as T;
      }
      if (request.path === '/inbound/putaway') {
        const qty = (request.body as { quantity: number }).quantity;
        receiptState = {
          ...receiptState,
          pendingQty: receiptState.pendingQty - qty,
          putawayFromOriginQty: receiptState.putawayFromOriginQty + qty,
          canCancel: false,
          cancelBlockReason: 'ALREADY_PUTAWAY',
          canPutaway: receiptState.pendingQty > qty,
          putawayBlockReason:
            receiptState.pendingQty > qty ? null : 'NOTHING_PENDING',
        };
        return { success: true } as T;
      }
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
        receiptState = {
          ...receiptState,
          quantity: body.lines[0].quantity,
          pendingQty: body.lines[0].quantity,
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
    getCapabilities: async () => ({ inboundWorkflowConsistency: true }),
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
  const mountView = (
    warehouseId = 'w-1',
    poId = 'po-1',
    content?: React.ReactNode
  ) => {
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
      component: () => content ?? <PurchaseOrderReceiveScreen poId={poId} />,
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
    setReceiptState: (change: Partial<typeof receiptState>) => {
      receiptState = { ...receiptState, ...change };
    },
    queryClient,
    lookupCodes,
    requests,
    runner,
    reopen: mountView,
    firstArrivals,
    answerNextArrivals(
      value: ExpectedArrivalsResult | Promise<ExpectedArrivalsResult>
    ) {
      arrivalReaders.set('w-1', async () => value);
    },
    answerArrivalsFor(warehouseId: string, value: ExpectedArrivalsResult) {
      arrivalReaders.set(warehouseId, async () => value);
    },
    answerLookupFor(code: string, read: () => Promise<(typeof skuA)[]>) {
      lookupReaders.set(code, read);
    },
    deferNextDraftWrite() {
      const gate = deferred<void>();
      draftWriteGate = gate.promise;
      return gate;
    },
    deferNextScanWrite() {
      const gate = deferred<void>();
      scanWriteGate = gate.promise;
      return gate;
    },
    scanWriteCount: () => scanWriteCount,
    failNextDraftWrite() {
      draftWriteFailures += 1;
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

const emptyDraft: Draft = {
  active: null,
  scanBump: 0,
  seen: [],
  fresh: null,
  submitted: null,
};
const largeArrivals: ExpectedArrivalsResult = {
  ...arrivals,
  arrivals: [
    {
      ...arrivals.arrivals[0],
      lines: [{ ...lineA, orderedQty: 200, outstandingQty: 200 }, lineB],
    },
  ],
};

it('adds one physical scan to the saved manual quantity and submits eleven', async () => {
  const f = await fixture(emptyDraft, [
    { id: 'first-a', data: '880000000001' },
  ]);
  await act(async () => f.firstArrivals.resolve(largeArrivals));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: '10' } });
  act(() => emitScan('880000000001'));
  await waitFor(() => expect(input).toHaveValue('11'));
  await waitFor(async () =>
    expect((await f.draft())?.quantity).toEqual({
      text: '11',
      source: 'scanned',
    })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
  );
  await userEvent.click(screen.getByRole('button', { name: '입고' }));
  await screen.findByText('아몬드 셔츠 11개 입고됨');
  expect(
    f.requests
      .filter((r) => r.path === '/purchase-orders/po-1/receipts')
      .map((r) => r.body)
  ).toEqual([
    expect.objectContaining({
      warehouseId: 'w-1',
      lines: [{ skuId: 'sku-a', quantity: 11 }],
    }),
  ]);
});

it('restores a manually entered quantity from the same durable draft key', async () => {
  const f = await fixture({ ...emptyDraft, active: lineA, scanBump: 1 });
  await act(async () => f.firstArrivals.resolve(arrivals));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: '10' } });
  await waitFor(async () =>
    expect((await f.draft())?.quantity).toEqual({
      text: '10',
      source: 'manual',
    })
  );
  f.unmount();
  f.reopen();
  expect(await screen.findByLabelText(/입고 수량 직접 입력/)).toHaveValue('10');
});

async function readyQuantityFixture() {
  const f = await fixture({
    ...emptyDraft,
    active: { ...lineA, orderedQty: 200, outstandingQty: 200 },
    scanBump: 1,
  });
  await act(async () => f.firstArrivals.resolve(largeArrivals));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await waitFor(() => expect(input).toBeEnabled());
  return { ...f, input };
}

it('keeps the newest typing visible while deferred writes serialize before a scan', async () => {
  const f = await readyQuantityFixture();
  const gate = f.deferNextDraftWrite();
  act(() => {
    fireEvent.change(f.input, { target: { value: '1' } });
    fireEvent.change(f.input, { target: { value: '10' } });
  });
  expect(f.input).toHaveValue('10');
  expect(screen.getByRole('button', { name: '입고' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '취소' })).toBeDisabled();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  act(() => emitScan('880000000001'));
  await waitFor(async () => expect(await f.savedScans()).toHaveLength(1));
  expect(f.input).toHaveValue('10');
  expect((await f.draft())?.scanBump).toBe(1);
  await act(async () => gate.resolve());
  await waitFor(() => expect(f.input).toHaveValue('11'));
  await waitFor(async () =>
    expect((await f.draft())?.quantity?.text).toBe('11')
  );
});

it('retains failed manual input and a following scan until saving is retried', async () => {
  const f = await readyQuantityFixture();
  f.failNextDraftWrite();
  fireEvent.change(f.input, { target: { value: '10' } });
  const sheet = screen.getByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByRole('button', { name: '저장 다시 시도' });
  expect(f.input).toHaveValue('10');
  expect(f.input).toBeDisabled();
  act(() => emitScan('880000000001'));
  await waitFor(async () => expect(await f.savedScans()).toHaveLength(1));
  expect((await f.draft())?.quantity?.text).not.toBe('11');
  expect(
    within(sheet).queryByRole('button', { name: '이 스캔 제외' })
  ).not.toBeInTheDocument();
  await userEvent.click(
    within(sheet).getByRole('button', { name: '저장 다시 시도' })
  );
  await waitFor(() => expect(f.input).toHaveValue('11'));
  await waitFor(() =>
    expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled()
  );
});

it('lets an empty quantity be corrected before replaying the retained scan once', async () => {
  const f = await readyQuantityFixture();
  fireEvent.change(f.input, { target: { value: '' } });
  act(() => emitScan('880000000001'));
  const sheet = screen.getByRole('dialog', { name: '입고 수량' });
  await within(sheet).findByText(/수량을 수정한 뒤 다시 확인/);
  expect(f.input).toHaveValue('');
  expect(f.input).toBeEnabled();
  expect(
    within(sheet).queryByRole('button', { name: '이 스캔 제외' })
  ).not.toBeInTheDocument();
  fireEvent.change(f.input, { target: { value: '4' } });
  await userEvent.click(
    within(sheet).getByRole('button', { name: '다시 확인' })
  );
  await waitFor(() => expect(f.input).toHaveValue('5'));
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  expect((await f.draft())?.seen).toHaveLength(1);
});

it('uses the latest accepted keypad text for clicks before a render or save', async () => {
  const f = await readyQuantityFixture();
  const gate = f.deferNextDraftWrite();
  act(() => {
    fireEvent.change(f.input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '0' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
  });
  expect(f.input).toHaveValue('10');
  await act(async () => gate.resolve());
  await waitFor(async () =>
    expect((await f.draft())?.quantity?.text).toBe('10')
  );
  fireEvent.keyDown(f.input, { key: 'Enter' });
  expect(
    f.requests.filter((r) => r.path === '/purchase-orders/po-1/receipts')
  ).toHaveLength(0);
});

it('preserves a packaging increment over the outstanding quantity and blocks submit', async () => {
  const f = await fixture({ ...emptyDraft, active: lineA, scanBump: 1 });
  f.answerLookupFor('box-a', async () => [
    {
      ...skuA,
      barcodes: [
        { id: 'box', barcode: 'box-a', isPrimary: false, packingUnit: 20 },
      ],
    },
  ]);
  await act(async () => f.firstArrivals.resolve(arrivals));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: '10' } });
  act(() => emitScan('box-a'));
  await waitFor(() => expect(input).toHaveValue('30'));
  expect(screen.getByRole('button', { name: '입고' })).toBeDisabled();
  await waitFor(async () =>
    expect((await f.draft())?.quantity?.text).toBe('30')
  );
});

it('keeps one hundred same-code scan events distinct after restarting from a suggestion', async () => {
  const f = await fixture({
    ...emptyDraft,
    active: { ...lineA, orderedQty: 200, outstandingQty: 200 },
  });
  await act(async () => f.firstArrivals.resolve(largeArrivals));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue('200');
  act(() => {
    for (let i = 0; i < 100; i++) emitScan('880000000001');
  });
  await waitFor(() => expect(input).toHaveValue('100'), { timeout: 10000 });
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  const saved = await f.draft();
  expect(saved?.quantity?.text).toBe('100');
  expect(new Set(saved?.seen).size).toBe(100);
});

it('locks duplicate exclusion clicks synchronously while the removal write is deferred', async () => {
  const f = await readyQuantityFixture();
  act(() => emitScan('880000000002'));
  const exclude = await screen.findByRole('button', { name: '이 스캔 제외' });
  const count = f.scanWriteCount();
  const gate = f.deferNextScanWrite();
  act(() => {
    fireEvent.click(exclude);
    fireEvent.click(exclude);
  });
  expect(exclude).toBeDisabled();
  await waitFor(() => expect(f.scanWriteCount()).toBe(count + 1));
  expect(await f.savedScans()).toHaveLength(1);
  await act(async () => gate.resolve());
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  expect(f.input).toHaveValue('1');
  expect(f.scanWriteCount()).toBe(count + 1);
});

it('retries a failed draft scan application without excluding or double-applying the event', async () => {
  const f = await readyQuantityFixture();
  f.failNextDraftWrite();
  act(() => emitScan('880000000001'));
  const sheet = screen.getByRole('dialog', { name: '입고 수량' });
  const retry = await within(sheet).findByRole('button', { name: '다시 확인' });
  expect(f.input).toHaveValue('1');
  expect(f.input).toBeDisabled();
  expect(
    within(sheet).queryByRole('button', { name: '이 스캔 제외' })
  ).not.toBeInTheDocument();
  const saved = await f.savedScans();
  expect(saved).toHaveLength(1);
  await userEvent.click(retry);
  await waitFor(() => expect(f.input).toHaveValue('2'));
  await waitFor(async () => expect(await f.savedScans()).toEqual([]));
  expect((await f.draft())?.seen).toEqual([saved![0].id]);
});

it('replays an already-applied new-format scan record without increasing the manual correction', async () => {
  const f = await fixture(
    {
      ...emptyDraft,
      active: lineA,
      scanBump: 3,
      seen: ['already-applied'],
      quantity: { text: '2', source: 'manual' },
    },
    [{ id: 'already-applied', data: '880000000001' }]
  );
  await act(async () => f.firstArrivals.resolve(arrivals));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue('2');
  expect(await f.savedScans()).toEqual([]);
  act(() => emitScan('880000000001'));
  await waitFor(() => expect(input).toHaveValue('3'));
  await waitFor(async () =>
    expect((await f.draft())?.quantity?.text).toBe('3')
  );
});

it('keeps later accepted typing behind a failed earlier write until the whole sequence is saved', async () => {
  const f = await readyQuantityFixture();
  const gate = f.deferNextDraftWrite();
  f.failNextDraftWrite();
  act(() => {
    fireEvent.change(f.input, { target: { value: '1' } });
    fireEvent.change(f.input, { target: { value: '10' } });
    emitScan('880000000001');
  });
  await act(async () => gate.resolve());
  const retry = await screen.findByRole('button', { name: '저장 다시 시도' });
  expect(f.input).toHaveValue('10');
  expect((await f.draft())?.quantity).toBeUndefined();
  const retryGate = f.deferNextDraftWrite();
  act(() => {
    fireEvent.click(retry);
    fireEvent.click(retry);
  });
  await act(async () => retryGate.resolve());
  await waitFor(() => expect(f.input).toHaveValue('11'));
  await waitFor(async () =>
    expect((await f.draft())?.quantity?.text).toBe('11')
  );
  expect((await f.draft())?.seen).toHaveLength(1);
});

it('lets the keypad correct an above-limit integer using the latest accepted text', async () => {
  const f = await readyQuantityFixture();
  act(() => {
    fireEvent.change(f.input, { target: { value: '2147483648' } });
    fireEvent.click(screen.getByRole('button', { name: '지우기' }));
  });
  expect(f.input).toHaveValue('214748364');
  await waitFor(async () =>
    expect((await f.draft())?.quantity?.text).toBe('214748364')
  );
});

it('receives HID-shaped keydown after Enter completes manual entry without submitting', async () => {
  const f = await readyQuantityFixture();
  await userEvent.click(f.input);
  fireEvent.change(f.input, { target: { value: '10' } });
  fireEvent.keyDown(f.input, { key: 'Enter' });
  expect(f.input).not.toHaveFocus();
  act(() => {
    for (const key of [...'880000000001', 'Enter'])
      fireEvent.keyDown(document.activeElement!, { key });
  });
  await waitFor(() => expect(f.input).toHaveValue('11'));
  await waitFor(async () =>
    expect((await f.draft())?.quantity?.text).toBe('11')
  );
  expect(
    f.requests.filter((r) => r.path === '/purchase-orders/po-1/receipts')
  ).toHaveLength(0);
});

it('retries a failed submission draft save inside the sheet before sending the saved quantity', async () => {
  const f = await readyQuantityFixture();
  fireEvent.change(f.input, { target: { value: '10' } });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
  );
  f.failNextDraftWrite();
  await userEvent.click(screen.getByRole('button', { name: '입고' }));
  const retry = await within(
    screen.getByRole('dialog', { name: '입고 수량' })
  ).findByRole('button', { name: '입고 요청 저장 다시 시도' });
  expect(f.input).toHaveValue('10');
  expect(f.input).toBeDisabled();
  expect(
    f.requests.filter((r) => r.path === '/purchase-orders/po-1/receipts')
  ).toHaveLength(0);
  await userEvent.click(retry);
  await screen.findByText('아몬드 셔츠 10개 입고됨');
  const sent = f.requests.filter(
    (r) => r.path === '/purchase-orders/po-1/receipts'
  );
  expect(sent).toHaveLength(1);
  expect(sent[0].body).toMatchObject({
    lines: [{ skuId: 'sku-a', quantity: 10 }],
  });
});

it('does not turn a double-click on failed quantity saving into an automatic second retry', async () => {
  const f = await readyQuantityFixture();
  f.failNextDraftWrite();
  fireEvent.change(f.input, { target: { value: '10' } });
  const retry = await screen.findByRole('button', { name: '저장 다시 시도' });
  f.failNextDraftWrite();
  const gate = f.deferNextDraftWrite();
  act(() => {
    fireEvent.click(retry);
    fireEvent.click(retry);
  });
  await act(async () => gate.resolve());
  expect(
    await screen.findByRole('button', { name: '저장 다시 시도' })
  ).toBeEnabled();
  expect(f.input).toHaveValue('10');
  expect(f.input).toBeDisabled();
  expect((await f.draft())?.quantity).toBeUndefined();
});

it('retries a failed arrivals query on the page before a queued first scan opens a sheet', async () => {
  const queued = { id: 'first-scan-before-arrivals', data: '880000000001' };
  const f = await fixture(emptyDraft, [queued]);
  await screen.findByRole('heading', { name: '발주 품목' });
  expect(
    screen.queryByRole('dialog', { name: '입고 수량' })
  ).not.toBeInTheDocument();
  await act(async () =>
    f.firstArrivals.reject(new Error('arrivals unavailable'))
  );

  const retry = await screen.findByRole('button', { name: '다시 확인' });
  expect(retry).toBeEnabled();
  expect(
    screen.queryByRole('dialog', { name: '입고 수량' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '이 스캔 제외' })
  ).not.toBeInTheDocument();
  expect(await f.savedScans()).toEqual([queued]);
  expect((await f.draft())?.active).toBeNull();
  expect(f.lookupCodes).toEqual([]);

  const retriedArrivals = deferred<ExpectedArrivalsResult>();
  f.answerNextArrivals(retriedArrivals.promise);
  await userEvent.click(retry);
  expect(
    await screen.findByText('발주 정보를 확인하고 있어요.')
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '입력 취소' })
  ).not.toBeInTheDocument();
  expect(await f.savedScans()).toEqual([queued]);
  await act(async () => retriedArrivals.resolve(arrivals));
  const input = await screen.findByLabelText(/입고 수량 직접 입력/);
  await waitFor(() => expect(input).toBeEnabled());
  expect(input).toHaveValue('1');
  expect(await f.savedScans()).toEqual([]);
  expect(await f.draft()).toMatchObject({
    active: lineA,
    quantity: { text: '1', source: 'scanned' },
    seen: [queued.id],
  });
  expect(f.lookupCodes).toEqual(['880000000001']);
  expect(
    f.requests.filter((r) => r.path === '/purchase-orders/po-1/receipts')
  ).toHaveLength(0);
});

it('다른 화면에서 확정 취소한 원래 PO fresh 초안을 재개하면 현재 취소됨을 표시한다', async () => {
  const f = await fixture(
    {
      active: null,
      scanBump: 0,
      seen: [],
      submitted: null,
      fresh: {
        lineId: 'receipt-line-1',
        skuId: 'sku-a',
        skuCode: 'ALMOND-A',
        skuName: '아몬드 셔츠',
        quantity: 3,
        putawayDoneQty: 0,
      },
    },
    [],
    async (store) => {
      await store.begin({
        resource: 'inbound',
        id: 'original-cancel',
        scope: 'scope',
        path: '/purchase-orders/receipt-lines/receipt-line-1/cancel',
        method: 'POST',
        bodyJson: '{}',
        createdAt: Date.now(),
      });
      await store.finish('original-cancel', 'confirmed', {
        receiptLineId: 'receipt-line-1',
        quantity: 3,
      });
    }
  );
  f.setReceiptState({
    receiptStatus: 'voided',
    pendingQty: 0,
    canceledQty: 3,
    canPutaway: false,
    putawayBlockReason: 'CANCELED',
    canCancel: false,
    cancelBlockReason: 'CANCELED',
  });
  f.firstArrivals.resolve(arrivals);
  expect(await screen.findByText('취소됨')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '적치하기' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '취소' })
  ).not.toBeInTheDocument();
  expect(
    (await f.store.draft<Draft>('scope:draft:po-inbound:w-1:po-1'))?.fresh
      ?.lineId
  ).toBe('receipt-line-1');
});

it('입고내역의 실제 취소 실행 후 이전 PO 초안을 재개하면 취소된 현재 상태를 읽는다', async () => {
  const f = await fixture({
    active: null,
    scanBump: 0,
    seen: [],
    submitted: null,
    fresh: {
      lineId: 'receipt-line-1',
      skuId: 'sku-a',
      skuCode: 'ALMOND-A',
      skuName: '아몬드 셔츠',
      quantity: 3,
      putawayDoneQty: 0,
    },
  });
  f.firstArrivals.resolve(arrivals);
  await screen.findByRole('button', { name: '적치하기' });
  f.unmount();
  const history = f.reopen('w-1', 'po-1', <InboundHistoryScreen />);
  await userEvent.click(
    await screen.findByRole('button', { name: '아몬드 셔츠 입고 취소' })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '전량 취소' })).toBeEnabled()
  );
  await userEvent.click(screen.getByRole('button', { name: '전량 취소' }));
  await screen.findByText('입고를 취소했어요.');
  history.unmount();
  f.reopen();
  expect(await screen.findByText('취소됨')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '적치하기' })
  ).not.toBeInTheDocument();
  const cancel = f.requests.filter(
    (r) => r.method === 'POST' && r.path.endsWith('/cancel')
  );
  expect(cancel).toHaveLength(1);
  expect((await f.store.get(cancel[0].idempotencyKey!))?.status).toBe(
    'confirmed'
  );
});
it('별도 적치 화면에서 처리한 후 PO를 재개하면 서버의 현재 적치 누계를 표시한다', async () => {
  const f = await fixture({
    active: null,
    scanBump: 0,
    seen: [],
    submitted: null,
    fresh: {
      lineId: 'receipt-line-1',
      skuId: 'sku-a',
      skuCode: 'ALMOND-A',
      skuName: '아몬드 셔츠',
      quantity: 3,
      putawayDoneQty: 0,
    },
  });
  f.firstArrivals.resolve(arrivals);
  await screen.findByRole('button', { name: '적치하기' });
  f.unmount();
  const putaway = f.reopen(
    'w-1',
    'po-1',
    <PutawaySheet
      target={{
        lineId: 'receipt-line-1',
        source: 'purchase_order',
        skuName: '아몬드 셔츠',
        skuCode: 'ALMOND-A',
        pendingQty: 3,
        originLocationId: 'origin-1',
        originLocationCode: '입고기본존',
      }}
      warehouseId="w-1"
      lastDest={{ id: 'dest-1', code: 'A-01' }}
      onDone={() => {}}
      onCancel={() => {}}
    />
  );
  await userEvent.click(
    await screen.findByRole('button', { name: '직전 대상지 A-01 사용' })
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
  );
  await userEvent.click(screen.getByRole('button', { name: '적치' }));
  await waitFor(() =>
    expect(
      f.requests.filter(
        (r) => r.method === 'POST' && r.path === '/inbound/putaway'
      )
    ).toHaveLength(1)
  );
  await waitFor(async () =>
    expect(await f.store.pending('scope')).toHaveLength(0)
  );
  putaway.unmount();
  f.reopen();
  await screen.findByText(/적치 완료/);
  expect(
    screen.queryByRole('button', { name: '적치하기' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '취소' })
  ).not.toBeInTheDocument();
});

it('전량 회송된 PO 입고를 적치 완료로 표시하지 않는다', async () => {
  const f = await fixture({
    active: null,
    scanBump: 0,
    seen: [],
    submitted: null,
    fresh: {
      lineId: 'receipt-line-1',
      skuId: 'sku-a',
      skuCode: 'ALMOND-A',
      skuName: '아몬드 셔츠',
      quantity: 3,
      putawayDoneQty: 0,
    },
  });
  f.setReceiptState({
    pendingQty: 0,
    returnedQty: 3,
    canPutaway: false,
    putawayBlockReason: 'NOTHING_PENDING',
    canCancel: false,
    cancelBlockReason: 'RETURN_EXISTS',
  });
  f.firstArrivals.resolve(arrivals);
  expect(await screen.findByText(/3개 회송됨/)).toBeInTheDocument();
  expect(screen.queryByText(/적치 완료/)).not.toBeInTheDocument();
});
