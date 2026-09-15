import {
  createTestWorkRuntime,
  TestWorkProvider,
  receiptFixture,
} from './__fixtures__/workRuntime';
import { describe, it, expect } from 'vitest';
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
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { QuickInboundScreen } from './QuickInboundScreen';

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

async function renderScreen(
  calls: Call[],
  restored?: Partial<ReturnType<typeof receiptFixture>>
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let current = receiptFixture({
    source: 'direct',
    lineId: 'ln-1',
    quantity: 20,
    pendingQty: 20,
    ...restored,
  });
  const client: ApiClient = {
    request: (async (o: Call) => {
      calls.push(o);
      if (o.path.startsWith('/inbound/lines/')) return current;
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
              status: current.receiptStatus,
              totalQuantity: current.quantity,
              lines: [{ ...current, id: current.lineId }],
            },
          ],
        };
      if (o.path.startsWith('/inventory/skus/search/advanced?'))
        return { items: BOX_SKU, total: 1 };
      if (o.path.startsWith('/inventory/skus?barcode=880')) return BOX_SKU;
      if (o.path.startsWith('/inventory/skus?barcode=')) return [];
      if (o.path === '/inbound/simple') {
        return {
          id: 'r-1',
          lines: [{ id: 'ln-1', skuId: 's1', quantity: 20 }],
        };
      }
      if (o.path === '/inbound/putaway') {
        const qty = (o.body as { quantity: number }).quantity;
        current = {
          ...current,
          pendingQty: current.pendingQty - qty,
          putawayFromOriginQty: current.putawayFromOriginQty + qty,
          canCancel: false,
          cancelBlockReason: 'ALREADY_PUTAWAY',
          canPutaway: current.pendingQty > qty,
          putawayBlockReason:
            current.pendingQty > qty ? null : 'NOTHING_PENDING',
        };
        return { success: true };
      }
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
  const runtime = createTestWorkRuntime(client);
  if (restored)
    await runtime.store.draft('fixture:draft:quick-inbound:w-1', () => ({
      receiptId: 'r-1',
      cart: [],
      staged: [
        {
          lineId: current.lineId,
          skuId: current.skuId,
          skuCode: current.skuCode,
          skuName: current.skuName,
          quantity: current.quantity,
          putawayDoneQty: 0,
        },
      ],
      seen: [],
      key: 'restored-receipt',
    }));
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
        <QuickInboundScreen />
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
        <TestWorkProvider runtime={runtime}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>{children}</ScanProvider>
          </WarehouseProvider>
        </TestWorkProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  await waitFor(() =>
    expect(document.querySelector('[aria-busy]')).toHaveAttribute(
      'aria-busy',
      'false'
    )
  );
}

describe('QuickInboundScreen', () => {
  it('스캔하면 카트에 담긴다', async () => {
    const user = userEvent.setup();
    await renderScreen([]);
    // 라우터 초기 매치가 커밋되기 전에 동기 getByRole 로 스캔 버튼을 찾으면
    // 아직 빈 문서라 실패한다 — 헤더 제목으로 초기 렌더 완료를 기다린다.
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
  });

  it('같은 SKU 를 다시 스캔하면 포장단위만큼 더한다', async () => {
    const user = userEvent.setup();
    await renderScreen([]);
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('코튼셔츠');
    // 박스 바코드(20개입)를 찍으면 1 → 21
    await user.click(screen.getByRole('button', { name: '스캔:8802' }));

    await waitFor(() =>
      expect(screen.getByLabelText('코튼셔츠 수량')).toHaveTextContent('21')
    );
  });

  it('등록하면 카트가 적치 대기 목록으로 바뀐다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8802' }));
    await screen.findByText('코튼셔츠');
    await user.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() => {
      const simple = calls.find((c) => c.path === '/inbound/simple');
      expect(simple?.body).toMatchObject({
        warehouseId: 'w-1',
        items: [{ skuId: 's1', quantity: 20 }],
      });
    });
    expect(await screen.findByText('적치 대기')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치' })).toBeInTheDocument();
  });

  it('등록한 뒤에는 스캔해도 적치 대기 목록이 바뀌지 않는다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8802' }));
    await screen.findByText('코튼셔츠');
    await user.click(screen.getByRole('button', { name: '등록' }));

    await waitFor(() => {
      const simple = calls.find((c) => c.path === '/inbound/simple');
      expect(simple?.body).toMatchObject({
        warehouseId: 'w-1',
        items: [{ skuId: 's1', quantity: 20 }],
      });
    });
    expect(await screen.findByText('적치 대기')).toBeInTheDocument();

    // 등록 직후 스냅샷 — 이 다음의 스캔이 이 상태를 조금이라도 바꾸면 가드가 뚫린 것이다.
    const lookupCallsBefore = calls.filter((c) =>
      c.path.startsWith('/inventory/skus?barcode=')
    ).length;
    const putawayButtonsBefore = screen.getAllByRole('button', {
      name: '적치',
    }).length;

    // 등록 후 재스캔(미등록 바코드). 가드가 없으면 lookup 이 다시 실행되고 응답이 빈 배열이라
    // "등록되지 않은 바코드예요" 알림까지 뜬다 — 가드가 있으면 useScanner 콜백 첫 줄에서
    // 즉시 return 하므로 lookup 자체가 호출되지 않는다.
    await user.click(screen.getByRole('button', { name: '스캔:9999' }));

    // "아무 일도 안 일어난다"는 그 순간의 스냅샷만으로는 증명할 수 없다(비동기 응답이 아직
    // 안 왔을 수도 있음) — waitFor 가 타임아웃까지 계속 폴링하다 실패로 끝나야
    // "결국에도 안 바뀐다"를 확인한 것이다. rejects.toThrow 로 그 타임아웃을 기대한다.
    await expect(
      waitFor(
        () => {
          expect(
            calls.filter((c) => c.path.startsWith('/inventory/skus?barcode='))
              .length
          ).toBeGreaterThan(lookupCallsBefore);
        },
        { timeout: 300 }
      )
    ).rejects.toThrow();

    // 적치 대기 목록도 그대로다 — 새 행 없음, 기존 행 수량 불변, 미등록 바코드 알림도 없음.
    expect(screen.getByRole('alert')).toHaveTextContent('현재 작업을 마친 뒤');
    expect(screen.getAllByRole('button', { name: '적치' })).toHaveLength(
      putawayButtonsBefore
    );
    expect(screen.getByText('20')).toBeInTheDocument();
  });

  it('적치 대기 행에서 부분 적치를 완료하면 잔여·누계 표시와 완료 배지가 반영된다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('간편입고');

    await user.click(screen.getByRole('button', { name: '스캔:8802' }));
    await screen.findByText('코튼셔츠');
    await user.click(screen.getByRole('button', { name: '등록' }));
    await screen.findByText('적치 대기');

    // 1차 부분 적치: 20개 중 12개.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '적치' }));
    let sheet = await screen.findByRole('dialog', { name: '적치' });
    await user.type(
      within(sheet).getByLabelText('대상 로케이션 검색'),
      'B-05-03'
    );
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '적치' })).toBeEnabled()
    );
    // 프리필 20 → 지우기·지우기 → 0 → '1' '2' = 12.
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '1' }));
    await user.click(within(sheet).getByRole('button', { name: '2' }));
    await user.click(within(sheet).getByRole('button', { name: '적치' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());

    expect(
      await screen.findByText(/잔여 8개 · 12개 적치됨/)
    ).toBeInTheDocument();
    expect(screen.queryByText('완료')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치' })).toBeInTheDocument();

    // 재오픈하면 잔여(8)로 다시 프리필된다.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '적치' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '적치' }));
    sheet = await screen.findByRole('dialog', { name: '적치' });
    expect(within(sheet).getByText(/잔여 8개/)).toBeInTheDocument();

    // 2차 부분 적치: 남은 8개 중 5개. 누적(17) vs 대입(5)을 가른다 — 완료(20)는
    // 아직 아니므로 완료 배지가 뜨면 안 된다.
    await user.type(
      within(sheet).getByLabelText('대상 로케이션 검색'),
      'B-05-03'
    );
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '적치' })).toBeEnabled()
    );
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '5' }));
    await user.click(within(sheet).getByRole('button', { name: '적치' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());

    expect(
      await screen.findByText(/잔여 3개 · 17개 적치됨/)
    ).toBeInTheDocument();
    expect(screen.queryByText('완료')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '적치' })).toBeInTheDocument();

    const putawayCalls = calls.filter((c) => c.path === '/inbound/putaway');
    expect(putawayCalls).toHaveLength(2);
    expect(putawayCalls[0].body).toMatchObject({ quantity: 12 });
    expect(putawayCalls[1].body).toMatchObject({ quantity: 5 });
  });

  it('빈 카트로는 등록할 수 없다', async () => {
    await renderScreen([]);
    expect(await screen.findByRole('button', { name: '등록' })).toBeDisabled();
  });
});

it('상품 검색과 키보드 수량 입력만으로 간편입고하고 재선택은 수량을 늘리지 않는다', async () => {
  const calls: Call[] = [];
  await renderScreen(calls);
  await userEvent.type(
    await screen.findByLabelText('상품명·코드 검색'),
    '셔츠{Enter}'
  );
  await userEvent.click(
    await screen.findByRole('button', { name: '코튼셔츠 선택' })
  );
  const quantity = await screen.findByLabelText(/입고 수량 직접 입력/);
  await userEvent.clear(quantity);
  expect(screen.getByRole('button', { name: '수량 저장' })).toBeDisabled();
  await userEvent.type(quantity, '10');
  await userEvent.click(screen.getByRole('button', { name: '수량 저장' }));
  await userEvent.click(screen.getByRole('button', { name: '코튼셔츠 선택' }));
  expect(await screen.findByLabelText(/입고 수량 직접 입력/)).toHaveValue('10');
  await userEvent.click(screen.getByRole('button', { name: '수량 저장' }));
  await userEvent.click(screen.getByRole('button', { name: '등록' }));
  await waitFor(() =>
    expect(calls.find((c) => c.path === '/inbound/simple')?.body).toMatchObject(
      { items: [{ skuId: 's1', quantity: 10 }] }
    )
  );
});

for (const returned of [3, 10]) {
  it(`회송 ${returned}개인 입고는 회송 누계와 서버의 잔여 적치 정책을 따로 표시한다`, async () => {
    await renderScreen([], {
      quantity: 10,
      pendingQty: 10 - returned,
      returnedQty: returned,
      canPutaway: returned < 10,
      putawayBlockReason: returned < 10 ? null : 'NOTHING_PENDING',
      canCancel: false,
      cancelBlockReason: 'RETURN_EXISTS',
    });
    expect(await screen.findByText(`${returned}개 회송됨`)).toBeInTheDocument();
    if (returned < 10) {
      expect(screen.getByRole('button', { name: '적치' })).toBeEnabled();
      await userEvent.click(screen.getByRole('button', { name: '적치' }));
      expect(
        await screen.findByRole('dialog', { name: '적치' })
      ).toHaveTextContent('잔여 7개');
    } else
      expect(
        screen.queryByRole('button', { name: '적치' })
      ).not.toBeInTheDocument();
  });
}
