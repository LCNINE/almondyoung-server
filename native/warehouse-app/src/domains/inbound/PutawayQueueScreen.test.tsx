import { describe, it, expect } from 'vitest';
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
import { WarehouseProvider, useWarehouse } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import type { PutawayPendingResult } from './types';
import { PutawayQueueScreen } from './PutawayQueueScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const QUEUE: PutawayPendingResult = {
  total: 2,
  truncated: false,
  items: [
    {
      lineId: 'l-1',
      skuId: 's-1',
      skuName: '무선마우스 블랙',
      skuCode: 'MOUSE-BK-01',
      pendingQty: 20,
      originLocationId: 'loc-origin',
      originLocationCode: 'zone-inbound-default',
      receivedAt: '2026-07-26T00:14:00.000Z',
    },
    {
      lineId: 'l-2',
      skuId: 's-2',
      skuName: 'USB-C 케이블 1m',
      skuCode: 'CBL-C-1M',
      pendingQty: 50,
      originLocationId: 'loc-origin',
      originLocationCode: 'zone-inbound-default',
      receivedAt: '2026-07-26T00:20:00.000Z',
    },
  ],
};

const SELECTED = { 'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }) };

/** ScanEvent 는 at 이 필수다. */
function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: 1 })}>
      scan-{code}
    </button>
  );
}

/**
 * 필터(days)와 달리 창고 전환은 어떤 이펙트도 안내/오류 배너를 정리하지 않는다
 * — 그 갭을 재현하려면 실제로 warehouseId 를 바꿔야 한다.
 */
function SwitchWarehouseButton() {
  const { setWarehouse } = useWarehouse();
  return (
    <button type="button" onClick={() => setWarehouse({ id: 'w-2', name: '다른창고' })}>
      switch-warehouse
    </button>
  );
}

interface RenderOpts {
  queue?: PutawayPendingResult;
  /** 큐 응답을 즉시 주지 않고 이 프라미스가 풀릴 때까지 pending 상태로 둔다 — 로딩 중 스캔 재현용. */
  queuePending?: Promise<PutawayPendingResult>;
  /** 큐 조회 자체가 실패하는 시나리오 — 조회 실패 중 스캔 재현용. */
  queueError?: boolean;
  /**
   * /inbound/putaway/pending 호출 순서대로 응답을 하나씩 소비한다(마지막 항목은
   * 그 뒤 호출에도 반복 사용) — 필터 변경으로 재조회가 일어나는 시점을 정밀하게
   * 제어해야 하는 시나리오(바코드 왕복 중 필터가 바뀌는 경우)용. queue/queuePending
   * 보다 우선한다.
   */
  queueSequence?: Array<PutawayPendingResult | Promise<PutawayPendingResult>>;
  barcode?: Record<string, Array<{ id: string }> | Promise<Array<{ id: string }>>>;
  /** 검색어(부분 문자열)로 대상 로케이션 후보를 내려주는 목 — 적치 완료 시나리오용. */
  locations?: Record<string, Array<{ id: string; code: string }>>;
}

function renderScreen(prefsSeed?: Record<string, string>, opts?: RenderOpts) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let queueCallCount = 0;
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      if (o.path.startsWith('/inbound/putaway/pending')) {
        if (opts?.queueSequence) {
          const idx = Math.min(queueCallCount, opts.queueSequence.length - 1);
          queueCallCount += 1;
          return opts.queueSequence[idx];
        }
        if (opts?.queuePending) return opts.queuePending;
        if (opts?.queueError) throw new Error('GET /inbound/putaway/pending → 500');
        return opts?.queue ?? QUEUE;
      }
      if (o.path.startsWith('/inventory/skus?barcode=')) {
        const code = decodeURIComponent(o.path.split('barcode=')[1]);
        const hit = opts?.barcode?.[code];
        if (!hit) throw new Error(`GET ${o.path} → 404`);
        return hit;
      }
      if (o.path.startsWith('/locations/warehouses/')) {
        const path = decodeURIComponent(o.path);
        const found = Object.entries(opts?.locations ?? {}).find(([term]) => path.includes(term));
        if (found) return { items: found[1], total: found[1].length };
        return { items: [], total: 0 };
      }
      if (o.path === '/inbound/putaway') return { success: true };
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const prefs = createMemoryPrefs(prefsSeed);
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="8801" />
        <ScanButton code="9999" />
        <ScanButton code="5555" />
        <SwitchWarehouseButton />
        <PutawayQueueScreen />
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

describe('PutawayQueueScreen', () => {
  it('창고가 없으면 창고 선택을 요구한다', async () => {
    renderScreen();
    expect(await screen.findByText('창고를 먼저 선택해 주세요.')).toBeInTheDocument();
  });

  it('대기 라인을 잔여수량·출발지와 함께 보여준다', async () => {
    renderScreen(SELECTED);
    expect(await screen.findByText('무선마우스 블랙')).toBeInTheDocument();
    expect(screen.getByText('잔여 20')).toBeInTheDocument();
    expect(screen.getAllByText(/zone-inbound-default/)[0]).toBeInTheDocument();
  });

  it('큐에 1건인 상품을 스캔하면 시트가 바로 열린다', async () => {
    renderScreen(SELECTED, { barcode: { '8801': [{ id: 's-1' }] } });
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-8801' }));

    expect(await screen.findByRole('dialog', { name: '적치' })).toBeInTheDocument();
  });

  it('큐에 여러 건인 상품을 스캔하면 후보 목록을 보여준다', async () => {
    // 같은 SKU 로 두 라인이 내려오는 응답
    renderScreen(SELECTED, {
      queue: {
        total: 2,
        truncated: false,
        items: [
          { ...QUEUE.items[0] },
          { ...QUEUE.items[0], lineId: 'l-3', pendingQty: 50, receivedAt: '2026-07-26T05:02:00.000Z' },
        ],
      },
      barcode: { '8801': [{ id: 's-1' }] },
    });
    // 같은 SKU 이름을 가진 두 줄이 함께 내려오므로 단수 매칭(findByText)은
    // "복수 일치"로 실패한다 — 로딩 완료를 기다리는 게 목적이니 복수형으로 기다린다.
    await screen.findAllByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-8801' }));

    expect(await screen.findByText('어느 건을 적치할까요?')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '적치' })).not.toBeInTheDocument();
  });

  it('큐에 없는 상품을 스캔하면 없다고 알린다', async () => {
    renderScreen(SELECTED, { barcode: { '9999': [{ id: 's-none' }] } });
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-9999' }));

    expect(await screen.findByText('이 상품은 적치 대기가 없어요.')).toBeInTheDocument();
  });

  it('큐가 비면 기간 필터가 걸려 있음을 함께 알린다', async () => {
    renderScreen(SELECTED, { queue: { total: 0, truncated: false, items: [] } });
    expect(await screen.findByText(/적치할 항목이 없어요/)).toBeInTheDocument();
    expect(await screen.findByText(/기간 필터를 넓혀 보세요/)).toBeInTheDocument();
  });

  it("'전체' 필터에서 큐가 비면 기간을 넓히라는 말은 하지 않는다", async () => {
    renderScreen(SELECTED, { queue: { total: 0, truncated: false, items: [] } });
    // 기본 필터(최근 1일)에서 '전체'로 바꾼 뒤에도 빈 결과라면 더 넓힐 기간이 없다.
    await userEvent.click(await screen.findByRole('button', { name: '전체' }));

    expect(await screen.findByText(/적치할 항목이 없어요/)).toBeInTheDocument();
    expect(screen.queryByText(/기간 필터를 넓혀 보세요/)).not.toBeInTheDocument();
  });

  it('후보 목록이 떠 있는 동안 재스캔으로 1건이 좁혀지면 후보 목록이 닫히고 시트만 남는다', async () => {
    // s-1 두 라인(l-1, l-3)으로 첫 스캔이 후보 목록을 띄우고, s-2(l-2, 유일)로
    // 두 번째 스캔이 단건으로 좁혀지는 상황 — 두 오버레이가 동시에 켜지면 안 된다.
    renderScreen(SELECTED, {
      queue: {
        total: 3,
        truncated: false,
        items: [
          { ...QUEUE.items[0] },
          { ...QUEUE.items[0], lineId: 'l-3', pendingQty: 50, receivedAt: '2026-07-26T05:02:00.000Z' },
          { ...QUEUE.items[1] },
        ],
      },
      barcode: { '8801': [{ id: 's-1' }], '5555': [{ id: 's-2' }] },
    });
    await screen.findAllByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-8801' }));
    expect(await screen.findByText('어느 건을 적치할까요?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'scan-5555' }));

    expect(await screen.findByRole('dialog', { name: '적치' })).toBeInTheDocument();
    expect(screen.queryByText('어느 건을 적치할까요?')).not.toBeInTheDocument();

    // 시트를 닫아도 낡은 후보 목록이 되살아나지 않는다.
    await userEvent.click(screen.getByRole('button', { name: '나중에' }));
    expect(screen.queryByText('어느 건을 적치할까요?')).not.toBeInTheDocument();
  });

  it('안내 문구가 뜬 뒤 목록에서 직접 골라 적치를 마치면 문구가 다시 나타나지 않는다', async () => {
    renderScreen(SELECTED, {
      barcode: { '9999': [{ id: 's-none' }] },
      locations: { DST01: [{ id: 'loc-dst', code: 'DST01' }] },
    });
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-9999' }));
    expect(await screen.findByText('이 상품은 적치 대기가 없어요.')).toBeInTheDocument();

    // 안내 대신 목록에서 다른 항목을 직접 골라 적치를 진행한다.
    await userEvent.click(screen.getByRole('button', { name: /무선마우스 블랙/ }));
    expect(await screen.findByRole('dialog', { name: '적치' })).toBeInTheDocument();
    expect(screen.queryByText('이 상품은 적치 대기가 없어요.')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('대상 로케이션 검색'), 'DST01');
    await waitFor(() => expect(screen.getByRole('button', { name: '적치' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: '적치' }));

    // 적치 완료로 시트가 닫힌 뒤에도 방금 끝낸 작업에 낡은 안내가 붙어 보이면 안 된다.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '적치' })).not.toBeInTheDocument());
    expect(screen.queryByText('이 상품은 적치 대기가 없어요.')).not.toBeInTheDocument();
  });

  it('기간 필터를 바꾸면 낡은 안내가 지워진다', async () => {
    renderScreen(SELECTED, { barcode: { '9999': [{ id: 's-none' }] } });
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-9999' }));
    expect(await screen.findByText('이 상품은 적치 대기가 없어요.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '최근 7일' }));
    expect(screen.queryByText('이 상품은 적치 대기가 없어요.')).not.toBeInTheDocument();
  });

  it('기간 필터를 바꾸면 미등록 바코드 오류 배너도 지워진다', async () => {
    // '9999' 는 barcode 맵에 없으므로 404 → 미등록 바코드 오류 배너가 뜬다.
    // (notice 안내가 아니라 byBarcode.isError 배너라는 점이 위 테스트와 다르다.)
    renderScreen(SELECTED, {});
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-9999' }));
    expect(await screen.findByText('등록되지 않은 바코드예요.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '최근 7일' }));
    expect(screen.queryByText('등록되지 않은 바코드예요.')).not.toBeInTheDocument();
  });

  it('바코드 조회가 왕복하는 중에 창고가 바뀌면 "적치 대기가 없어요"라고 단언하지 않는다', async () => {
    // 시나리오: 스캔 시점엔 큐가 준비돼 있었지만(무선마우스 블랙 보유), 바코드
    // 조회가 서버를 왕복하는 동안 작업자가 창고를 바꿔서 새 쿼리가 도착 전
    // (pending)이 된다. 필터(days) 변경과 달리 창고 변경은 어떤 이펙트도
    // notice/오류 배너를 정리하지 않으므로, 이 갭은 오직 onSuccess 진입부의
    // 재확인으로만 막을 수 있다 — 응답이 도착한 시점의 실제 준비 상태를 봐야 한다.
    let resolveBarcode!: (v: Array<{ id: string }>) => void;
    const barcodePending = new Promise<Array<{ id: string }>>((res) => {
      resolveBarcode = res;
    });
    let resolveOtherWarehouseQueue!: (v: PutawayPendingResult) => void;
    const otherWarehouseQueuePending = new Promise<PutawayPendingResult>((res) => {
      resolveOtherWarehouseQueue = res;
    });

    renderScreen(SELECTED, {
      queueSequence: [QUEUE, otherWarehouseQueuePending],
      barcode: { '8801': barcodePending },
    });
    await screen.findByText('무선마우스 블랙');

    // 스캔 — 이 시점엔 원래 창고의 큐가 이미 성공 상태다. 바코드 응답은 아직 안 왔다.
    await userEvent.click(screen.getByRole('button', { name: 'scan-8801' }));

    // 바코드 왕복 중에 창고를 바꾼다 — 새 창고의 쿼리가 나가고, 아직 안 풀려서
    // pending 상태로 들어간다(placeholderData 가 없으므로 items 도 일시적으로 빈다).
    await userEvent.click(screen.getByRole('button', { name: 'switch-warehouse' }));

    // 이제야 바코드 응답이 도착한다 — onSuccess 시점엔 큐가 다시 "준비 안 됨"이다.
    resolveBarcode([{ id: 's-1' }]);

    expect(await screen.findByText('목록을 아직 못 불러왔어요. 잠시 후 다시 스캔해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('이 상품은 적치 대기가 없어요.')).not.toBeInTheDocument();

    resolveOtherWarehouseQueue(QUEUE);
  });

  it('큐가 아직 안 왔을 때 스캔하면 "적치 대기가 없어요"라고 단언하지 않는다', async () => {
    let resolveQueue!: (v: PutawayPendingResult) => void;
    const queuePending = new Promise<PutawayPendingResult>((res) => {
      resolveQueue = res;
    });
    renderScreen(SELECTED, { queuePending, barcode: { '8801': [{ id: 's-1' }] } });

    // 큐가 아직 도착하지 않은 채로 스캔한다 — 이 시점의 items 는 빈 배열이다.
    // findByRole 로 라우터 마운트를 기다린 뒤 클릭한다(큐 응답 자체는 여전히 pending).
    await userEvent.click(await screen.findByRole('button', { name: 'scan-8801' }));

    expect(await screen.findByText('목록을 아직 못 불러왔어요. 잠시 후 다시 스캔해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('이 상품은 적치 대기가 없어요.')).not.toBeInTheDocument();

    resolveQueue(QUEUE);
    await screen.findByText('무선마우스 블랙');
  });

  it('큐 조회가 실패했을 때 스캔하면 "적치 대기가 없어요"라고 단언하지 않는다', async () => {
    renderScreen(SELECTED, { queueError: true, barcode: { '8801': [{ id: 's-1' }] } });
    await screen.findByRole('alert');

    await userEvent.click(screen.getByRole('button', { name: 'scan-8801' }));

    expect(await screen.findByText('목록을 아직 못 불러왔어요. 잠시 후 다시 스캔해 주세요.')).toBeInTheDocument();
    expect(screen.queryByText('이 상품은 적치 대기가 없어요.')).not.toBeInTheDocument();
  });

  it('로딩 중에는 건수를 감춘다', async () => {
    let resolveQueue!: (v: PutawayPendingResult) => void;
    const queuePending = new Promise<PutawayPendingResult>((res) => {
      resolveQueue = res;
    });
    renderScreen(SELECTED, { queuePending });

    // 라우터 마운트를 기다린 뒤 확인한다 — 그 전에는 화면 자체가 아직 없어
    // "0건"의 부재가 우연이 아니라 의도한 결과인지 알 수 없다.
    await screen.findByText('상품 바코드를 스캔하거나 목록에서 고르세요.');
    expect(screen.queryByText('0건')).not.toBeInTheDocument();

    resolveQueue(QUEUE);
    expect(await screen.findByText('2건')).toBeInTheDocument();
  });

  it('미등록 바코드 오류 배너는 목록에서 직접 고르면 지워진다', async () => {
    renderScreen(SELECTED, {}); // '9999' 가 barcode 맵에 없으므로 404
    await screen.findByText('무선마우스 블랙');

    await userEvent.click(screen.getByRole('button', { name: 'scan-9999' }));
    expect(await screen.findByText('등록되지 않은 바코드예요.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /무선마우스 블랙/ }));
    await screen.findByRole('dialog', { name: '적치' });
    expect(screen.queryByText('등록되지 않은 바코드예요.')).not.toBeInTheDocument();
  });
});
