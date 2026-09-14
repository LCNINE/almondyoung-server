import 'fake-indexeddb/auto';
import { createOperationStore } from '../../core/operations/operationStore';
import { createOperationRunner } from '../../core/operations/operationRunner';
import {
  OperationContext,
  type WorkRuntime,
} from '../../core/operations/OperationContext';
import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import {
  act,
  render,
  screen,
  waitFor,
  fireEvent,
} from '@testing-library/react';
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
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
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
      lineRevision: 1,
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
      lineRevision: 1,
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
  return (
    <button onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      스캔:{code}
    </button>
  );
}

/** 실제 요청 로직만 테스트마다 다르게 넣을 수 있도록 라우터/프로바이더 배선을 분리한다. */
function mountScreen(
  request: ApiClient['request'],
  runtime: WorkRuntime | null = null
) {
  const client: ApiClient = { request };
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
          <OperationContext.Provider value={runtime}>
            <ScanProvider>{children}</ScanProvider>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  return render(<RouterProvider router={router as never} />, { wrapper: wrap });
}

function renderScreen(calls: Call[]) {
  return mountScreen((async (opts: Call) => {
    calls.push(opts);
    if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
    if (opts.path === '/stocktaking/scan-location') return SCAN_LOCATION;
    if (opts.path === '/stocktaking/scan-product') {
      return {
        lineId: 'line-1',
        lineRevision: 1,
        skuId: 'sku-1',
        countedQuantity: 5,
        expectedQuantity: 6,
        variance: -1,
      };
    }
    if (opts.path === '/stocktaking/lines/line-1/count') {
      const body = opts.body as { countedQuantity: number };
      return {
        lineId: 'line-1',
        lineRevision: 1,
        skuId: 'sku-1',
        countedQuantity: body.countedQuantity,
        expectedQuantity: 6,
        variance: body.countedQuantity - 6,
      };
    }
    return {};
  }) as unknown as ApiClient['request']);
}

describe('SessionCountScreen', () => {
  it('로케이션 대기 모드로 시작하고 진행률을 보여준다', async () => {
    renderScreen([]);
    expect(
      await screen.findByText(/로케이션 바코드를 스캔/)
    ).toBeInTheDocument();
    expect(await screen.findByTestId('progress')).toHaveTextContent('1 / 3');
  });

  it('로케이션 스캔이 그 위치의 라인을 띄운다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);

    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );

    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText('리넨셔츠')).toBeInTheDocument();
    const scan = calls.find((c) => c.path === '/stocktaking/scan-location');
    expect(scan?.body).toMatchObject({
      sessionId: 's-1',
      locationBarcode: 'A-01-02',
    });
  });

  it('이미 센 라인은 저장된 카운트를 그대로 보여준다 (이어하기)', async () => {
    renderScreen([]);
    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );
    expect(await screen.findByTestId('count-line-2')).toHaveTextContent('2');
    expect(screen.getByTestId('count-line-1')).toHaveTextContent('—');
  });

  it('상품 스캔은 응답의 절대 카운트로 라인을 덮어쓴다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );

    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:8801' })
    );

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
    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );

    await userEvent.click(
      await screen.findByRole('button', { name: '코튼셔츠 수량 입력' })
    );
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    const update = calls.find(
      (c) => c.path === '/stocktaking/lines/line-1/count'
    );
    expect(update?.method).toBe('PUT');
    expect(update?.body).toMatchObject({ countedQuantity: 12 });
    expect(await screen.findByTestId('count-line-1')).toHaveTextContent('12');
  });

  it('수량 입력 다이얼로그가 열려 있으면 스캔을 무시한다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '코튼셔츠 수량 입력' })
    );

    await userEvent.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(
      calls.filter((c) => c.path === '/stocktaking/scan-product')
    ).toHaveLength(0);
  });

  it('다른 로케이션 버튼이 대기 모드로 되돌린다', async () => {
    const calls: Call[] = [];
    renderScreen(calls);
    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '다른 로케이션' })
    );
    expect(
      await screen.findByText(/로케이션 바코드를 스캔/)
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '스캔:A-01-02' }));
    await screen.findByText('코튼셔츠');
    expect(
      calls.filter((call) => call.path === '/stocktaking/scan-location')
    ).toHaveLength(2);
    expect(
      calls.filter((call) => call.path === '/stocktaking/scan-product')
    ).toHaveLength(0);
  });

  it('차이 확인으로 이동한다', async () => {
    renderScreen([]);
    await userEvent.click(
      await screen.findByRole('button', { name: /차이 확인/ })
    );
    expect(await screen.findByText('차이화면')).toBeInTheDocument();
  });

  it('scan-product 응답에 없던 라인은 로케이션을 재조회해서 반영한다 (스캔 응답값을 직접 쓰지 않는다)', async () => {
    const calls: Call[] = [];
    let scanLocationCalls = 0;
    // 재조회 응답의 line-3 카운트(3)와 scan-product 응답의 line-3 카운트(9)를
    // 일부러 다르게 둔다 — 화면이 후자를 그대로 썼다면 3이 아니라 9가 보인다.
    const RESCANNED = {
      locationId: 'l-1',
      locationCode: 'A-01-02',
      expectedItems: [
        ...SCAN_LOCATION.expectedItems,
        {
          lineId: 'line-3',
          skuId: 'sku-3',
          skuName: '데님팬츠',
          skuCode: 'DM-003',
          barcode: '8803',
          expectedQuantity: 0,
          countedQuantity: 3,
          status: 'counted',
        },
      ],
    };

    mountScreen((async (opts: Call) => {
      calls.push(opts);
      if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
      if (opts.path === '/stocktaking/scan-location') {
        scanLocationCalls += 1;
        return scanLocationCalls === 1 ? SCAN_LOCATION : RESCANNED;
      }
      if (opts.path === '/stocktaking/scan-product') {
        return {
          lineId: 'line-3',
          skuId: 'sku-3',
          countedQuantity: 9,
          expectedQuantity: 0,
          variance: 9,
        };
      }
      return {};
    }) as unknown as ApiClient['request']);

    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:8801' })
    );

    expect(await screen.findByText('데님팬츠')).toBeInTheDocument();
    expect(await screen.findByTestId('count-line-3')).toHaveTextContent('3');

    const locationCalls = calls.filter(
      (c) => c.path === '/stocktaking/scan-location'
    );
    expect(locationCalls).toHaveLength(2);
    expect(locationCalls[1]?.body).toMatchObject({
      sessionId: 's-1',
      locationBarcode: 'A-01-02',
    });
  });

  it('연속으로 들어온 같은 바코드 스캔 두 건이 직렬로 처리되어 둘 다 반영된다', async () => {
    // HID 스캐너는 wifi 왕복시간을 쉽게 앞지른다 — await 없이 두 번 스캔해서
    // 재현한다. 직렬화가 없으면 두 scan-product 요청이 거의 동시에 나가고,
    // 서버가 unlocked read-modify-write 라면 한쪽 증가분이 사라진다(서버 스펙은
    // stocktaking-scan-product-concurrency.integration.spec.ts 가 따로 검증한다).
    // 여기서는 클라이언트가 "요청을 겹치게 보내지 않는다"는 절반만 검증한다.
    const calls: Call[] = [];
    let scanProductSends = 0;
    let resolveFirst: ((v: unknown) => void) | undefined;
    mountScreen((async (opts: Call) => {
      calls.push(opts);
      if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
      if (opts.path === '/stocktaking/scan-location') return SCAN_LOCATION;
      if (opts.path === '/stocktaking/scan-product') {
        scanProductSends += 1;
        if (scanProductSends === 1) {
          return new Promise((resolve) => {
            resolveFirst = resolve;
          });
        }
        // 두 번째 요청이 나갈 시점엔 첫 요청이 이미 반영된 뒤라고 가정한다
        // (서버가 올바르게 직렬화한다면 실제로 그렇다).
        return {
          lineId: 'line-1',
          lineRevision: 1,
          skuId: 'sku-1',
          countedQuantity: 2,
          expectedQuantity: 6,
          variance: -4,
        };
      }
      return {};
    }) as unknown as ApiClient['request']);

    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );

    const scanBtn = await screen.findByRole('button', { name: '스캔:8801' });
    // fireEvent 로 동기 발사한다 — userEvent.click 은 내부적으로 await 지점을
    // 끼워 넣어서 두 스캔 사이에 자연히 직렬화가 생겨버려 재현이 안 된다.
    fireEvent.click(scanBtn);
    fireEvent.click(scanBtn);

    // 직렬화돼 있다면, 첫 요청의 응답을 아직 안 줬을 때 두 번째 scan-product
    // 요청은 아직 서버로 나가지 않아야 한다(큐에서 대기 중).
    await waitFor(() => {
      expect(
        calls.filter((c) => c.path === '/stocktaking/scan-product')
      ).toHaveLength(1);
    });

    resolveFirst?.({
      lineId: 'line-1',
      lineRevision: 1,
      skuId: 'sku-1',
      countedQuantity: 1,
      expectedQuantity: 6,
      variance: -5,
    });

    await waitFor(() => {
      expect(
        calls.filter((c) => c.path === '/stocktaking/scan-product')
      ).toHaveLength(2);
    });
    expect(await screen.findByTestId('count-line-1')).toHaveTextContent('2');
  });

  it('수량 저장이 진행 중일 때는 다이얼로그를 유지하고 추가 스캔을 안내한다', async () => {
    // onSave 는 낙관적으로 setEditing(null) 부터 부른다(다이얼로그가 즉시 닫힘) —
    // 그래서 "다이얼로그가 열려 있는가" 만으로는 PUT 이 아직 진행 중인 창을
    // 못 막는다. updateCount.isPending 도 같이 봐야 한다.
    const calls: Call[] = [];
    let resolveUpdate: ((v: unknown) => void) | undefined;
    mountScreen((async (opts: Call) => {
      calls.push(opts);
      if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
      if (opts.path === '/stocktaking/scan-location') return SCAN_LOCATION;
      if (opts.path === '/stocktaking/lines/line-1/count') {
        return new Promise((resolve) => {
          resolveUpdate = resolve;
        });
      }
      if (opts.path === '/stocktaking/scan-product') {
        return {
          lineId: 'line-1',
          lineRevision: 1,
          skuId: 'sku-1',
          countedQuantity: 9,
          expectedQuantity: 6,
          variance: 3,
        };
      }
      return {};
    }) as unknown as ApiClient['request']);

    await userEvent.click(
      await screen.findByRole('button', { name: '스캔:A-01-02' })
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '코튼셔츠 수량 입력' })
    );
    await userEvent.click(screen.getByRole('button', { name: '1' }));
    await userEvent.click(screen.getByRole('button', { name: '2' }));
    await userEvent.click(screen.getByRole('button', { name: '저장' }));

    // 응답을 확인할 때까지 원래 수량을 유지한다.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();

    await userEvent.click(screen.getByRole('button', { name: '스캔:8801' }));
    expect(
      calls.filter((c) => c.path === '/stocktaking/scan-product')
    ).toHaveLength(0);

    resolveUpdate?.({
      lineId: 'line-1',
      lineRevision: 1,
      skuId: 'sku-1',
      countedQuantity: 12,
      expectedQuantity: 6,
      variance: 6,
    });
    await waitFor(() =>
      expect(screen.getByTestId('count-line-1')).toHaveTextContent('12')
    );
  });
  it('replays a restored location scan with its original meaning after the location draft was already saved', async () => {
    const calls: Call[] = [];
    const store = createOperationStore(crypto.randomUUID());
    const getScope = async () => 'actor|local';
    const raw: ApiClient = {
      request: (async (opts: Call) => {
        calls.push(opts);
        if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
        if (opts.path === '/stocktaking/scan-location') return SCAN_LOCATION;
        throw new Error(`Unexpected request ${opts.path}`);
      }) as ApiClient['request'],
    };
    const runner = createOperationRunner({ api: raw, store, getScope });
    const eventId = crypto.randomUUID();
    await runner.request({
      method: 'POST',
      path: '/stocktaking/scan-location',
      idempotencyKey: eventId,
      body: {
        sessionId: 's-1',
        locationBarcode: 'A-01-02',
        idempotencyKey: eventId,
      },
    });
    // Crash boundary: operation and projection committed, but the physical input was not acknowledged.
    await store.draft(
      'actor|local:draft:count-location:s-1',
      () => SCAN_LOCATION
    );
    await store.draft('actor|local:scan:count:s-1', () => [
      { id: eventId, data: { kind: 'location', code: 'A-01-02' } },
    ]);
    mountScreen(runner.request, { runner, store, getScope });
    await screen.findByText('코튼셔츠');
    await waitFor(async () =>
      expect(await store.draft('actor|local:scan:count:s-1')).toEqual([])
    );
    expect(
      calls.filter((call) => call.path === '/stocktaking/scan-location')
    ).toHaveLength(1);
    expect(
      calls.filter((call) => call.path === '/stocktaking/scan-product')
    ).toHaveLength(0);
    expect((await store.get(eventId))?.path).toBe('/stocktaking/scan-location');
  });

  it('persists product intent for rapid scans accepted while the first location request is pending', async () => {
    const calls: Call[] = [];
    const store = createOperationStore(crypto.randomUUID());
    const getScope = async () => 'actor|local';
    let release!: (value: unknown) => void;
    const locationResponse = new Promise((resolve) => {
      release = resolve;
    });
    let count = 0;
    const raw: ApiClient = {
      request: (async (opts: Call) => {
        calls.push(opts);
        if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
        if (opts.path === '/stocktaking/scan-location') return locationResponse;
        if (opts.path === '/stocktaking/scan-product') {
          count++;
          return {
            lineId: 'line-1',
            skuId: 'sku-1',
            countedQuantity: count,
            expectedQuantity: 6,
            variance: count - 6,
            lineRevision: count + 1,
          };
        }
        return {};
      }) as ApiClient['request'],
    };
    const runner = createOperationRunner({ api: raw, store, getScope });
    mountScreen(runner.request, { runner, store, getScope });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '열기' })).toBeEnabled()
    );
    fireEvent.click(screen.getByRole('button', { name: '스캔:A-01-02' }));
    fireEvent.click(screen.getByRole('button', { name: '스캔:8801' }));
    fireEvent.click(screen.getByRole('button', { name: '스캔:8801' }));
    await waitFor(async () => {
      const accepted = await store.draft<Array<{ data: unknown }>>(
        'actor|local:scan:count:s-1'
      );
      expect(accepted?.map((event) => event.data)).toEqual([
        { kind: 'location', code: 'A-01-02' },
        {
          kind: 'product',
          code: '8801',
          location: { locationCode: 'A-01-02' },
        },
        {
          kind: 'product',
          code: '8801',
          location: { locationCode: 'A-01-02' },
        },
      ]);
    });
    await act(async () => {
      release(SCAN_LOCATION);
    });
    await waitFor(() =>
      expect(screen.getByTestId('count-line-1')).toHaveTextContent('2')
    );
    expect(
      calls
        .filter((call) => call.path === '/stocktaking/scan-product')
        .map((call) => call.body)
    ).toEqual([
      expect.objectContaining({ locationId: 'l-1', productBarcode: '8801' }),
      expect.objectContaining({ locationId: 'l-1', productBarcode: '8801' }),
    ]);
  });

  it.each([false, true])(
    'never redirects a restored product scan into a different saved location (confirmed: %s)',
    async (hasConfirmedOperation) => {
      const calls: Call[] = [];
      const store = createOperationStore(crypto.randomUUID());
      const getScope = async () => 'actor|local';
      const raw: ApiClient = {
        request: (async (opts: Call) => {
          calls.push(opts);
          if (opts.path === '/stocktaking/sessions/s-1') return DETAIL;
          if (opts.path === '/stocktaking/scan-product')
            return {
              lineId: 'line-1',
              lineRevision: 2,
              skuId: 'sku-1',
              countedQuantity: 1,
              expectedQuantity: 6,
              variance: -5,
            };
          return SCAN_LOCATION;
        }) as ApiClient['request'],
      };
      const runner = createOperationRunner({ api: raw, store, getScope });
      const eventId = crypto.randomUUID();
      if (hasConfirmedOperation) {
        await store.begin({
          id: eventId,
          scope: 'actor|local',
          resource: 'stocktaking:s-1',
          method: 'POST',
          path: '/stocktaking/scan-product',
          bodyJson: JSON.stringify({
            sessionId: 's-1',
            locationId: 'l-1',
            productBarcode: '8801',
            quantity: 1,
          }),
          createdAt: Date.now(),
        });
        await store.finish(eventId, 'confirmed', {
          lineId: 'line-1',
          countedQuantity: 1,
          lineRevision: 2,
        });
      }
      await store.draft('actor|local:draft:count-location:s-1', () => ({
        ...SCAN_LOCATION,
        locationId: 'different-location',
        locationCode: 'B-02',
      }));
      await store.draft('actor|local:scan:count:s-1', () => [
        {
          id: eventId,
          data: {
            kind: 'product',
            code: '8801',
            location: { locationId: 'l-1', locationCode: 'A-01-02' },
          },
        },
      ]);
      mountScreen(runner.request, { runner, store, getScope });
      await screen.findByRole('alert');
      expect(
        calls.filter((call) => call.path === '/stocktaking/scan-product')
      ).toHaveLength(0);
      expect(
        await store.draft<Array<unknown>>('actor|local:scan:count:s-1')
      ).toHaveLength(1);
      expect(
        screen.getByRole('button', { name: '다른 로케이션' })
      ).toBeDisabled();
      if (hasConfirmedOperation) {
        expect(
          screen.queryByRole('button', { name: '이 스캔 제외' })
        ).not.toBeInTheDocument();
        expect((await store.get(eventId))?.status).toBe('confirmed');
        return;
      }
      await userEvent.click(
        screen.getByRole('button', { name: '이 스캔 제외' })
      );
      await waitFor(async () =>
        expect(await store.draft('actor|local:scan:count:s-1')).toEqual([])
      );
      expect(
        calls.filter((call) => call.path === '/stocktaking/scan-product')
      ).toHaveLength(0);
    }
  );
});
