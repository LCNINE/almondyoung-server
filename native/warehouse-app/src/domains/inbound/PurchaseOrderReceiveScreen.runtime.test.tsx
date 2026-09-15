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
  const firstArrivals = deferred<ExpectedArrivalsResult>();
  const arrivalReaders = new Map<string, () => Promise<ExpectedArrivalsResult>>(
    [['w-1', () => firstArrivals.promise]]
  );
  const lookupCodes: string[] = [];
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
        if (code === '880000000001') return [skuA] as T;
        if (code === '880000000002') return [skuB] as T;
        return [] as T;
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
    draft: (warehouseId = 'w-1', poId = 'po-1') =>
      store.draft<Draft>(`scope:draft:po-inbound:${warehouseId}:${poId}`),
    savedScans: () =>
      store.draft<Array<{ id: string; data: string }>>(
        'scope:scan:po-inbound:w-1:po-1'
      ),
  };
}

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
  await screen.findByText('상품을 확인하지 못했어요.');
  expect(f.lookupCodes).toEqual([]);
  expect(await f.savedScans()).toEqual([
    { id: 'scan-4', data: '880000000001' },
  ]);
  expect(
    screen.getByRole('button', { name: '이 스캔 제외' })
  ).toBeInTheDocument();
  expect(await f.draft()).toMatchObject({
    active: lineA,
    scanBump: 3,
    seen: ['a1', 'a2', 'a3'],
  });

  f.answerNextArrivals(arrivals);
  await userEvent.click(
    within(sheet).getByRole('button', { name: '다시 확인' })
  );
  await waitFor(() =>
    expect(
      within(sheet).queryByText('발주 상태가 바뀌었어요.')
    ).not.toBeInTheDocument()
  );
  await userEvent.click(screen.getByRole('button', { name: '다시 확인' }));
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
