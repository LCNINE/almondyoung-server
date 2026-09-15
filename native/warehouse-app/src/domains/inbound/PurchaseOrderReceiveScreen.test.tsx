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
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { PurchaseOrderReceiveScreen } from './PurchaseOrderReceiveScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const ARRIVALS = {
  warehouseId: 'w-1',
  totalDocuments: 1,
  totalOutstandingQuantity: 12,
  arrivals: [
    {
      source: 'purchase_order',
      documentId: 'po-1',
      type: 'domestic',
      supplier: { id: 'sup-1', name: '르아리컴퍼니' },
      expectedDate: '2026-09-20',
      totalOutstandingQuantity: 12,
      lines: [
        {
          skuId: 's1',
          skuName: '코튼셔츠',
          skuCode: 'CT-001',
          orderedQty: 20,
          receivedQty: 8,
          outstandingQty: 12,
          expectedArrival: '2026-09-20',
        },
      ],
    },
  ],
};

const SKU_BY_BARCODE = [
  {
    id: 's1',
    code: 'CT-001',
    name: '코튼셔츠',
    currentStock: 0,
    safetyStock: 0,
    barcodes: [
      { id: 'b1', barcode: '8801', isPrimary: true, packingUnit: null },
    ],
  },
];

interface Call {
  path: string;
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
}

/** 테스트에서 하드웨어 스캔을 흉내 내는 버튼. ScanEvent 는 at 이 필수다. */
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

interface RenderOpts {
  /** true 면 발주 수령이 항상 400 으로 실패한다(응답 유실 흉내). */
  failReceive?: boolean;
  /**
   * true 면 실패하는 receive 호출이라도 "서버는 실제로 커밋했다" 상태를
   * 흉내 낸다 — 이후 expected-arrivals 재조회는 해당 항목이 이미 다 받아져
   * 목록에서 빠진 것으로 응답한다(이중입고 시나리오 재현용).
   */
  silentCommit?: boolean;
  /** true 면 발주 수령 취소가 항상 400 으로 실패한다(응답 유실 흉내). */
  failCancel?: boolean;
  /** 서버가 발주 수령 409 문구를 보낸다. */
  conflictReceive?: boolean;
}

async function renderScreen(calls: Call[], opts: RenderOpts = {}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let served = ARRIVALS;
  let current = receiptFixture({
    source: 'purchase_order',
    lineId: 'rl-1',
    quantity: 20,
    pendingQty: 20,
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
      if (o.path.startsWith('/inventory/expected-arrivals')) return served;
      if (o.path.startsWith('/inventory/skus?barcode=8801'))
        return SKU_BY_BARCODE;
      if (o.path.startsWith('/inventory/skus?barcode=')) return [];
      if (o.path === '/purchase-orders/po-1/receipts') {
        if (opts.silentCommit) {
          served = {
            ...served,
            arrivals: [{ ...served.arrivals[0], lines: [] }],
          };
        }
        if (opts.conflictReceive) {
          throw new ConflictError('이미 전량 입고된 품목입니다: s1');
        }
        if (opts.failReceive)
          throw new Error('POST /purchase-orders/po-1/receipts → 400');
        const qty = (o.body as { lines: { quantity: number }[] }).lines[0]
          .quantity;
        current = { ...current, quantity: qty, pendingQty: qty };
        return {
          receiptId: 'r-1',
          poId: 'po-1',
          lines: [
            { receiptLineId: 'rl-1', skuId: 's1', quantity: current.quantity },
          ],
        };
      }
      if (o.path === '/purchase-orders/receipt-lines/rl-1/cancel') {
        if (opts.failCancel) {
          throw new Error(
            'POST /purchase-orders/receipt-lines/rl-1/cancel → 400'
          );
        }
        current = {
          ...current,
          receiptStatus: 'voided',
          canceledQty: current.quantity,
          pendingQty: 0,
          canCancel: false,
          canPutaway: false,
          cancelBlockReason: 'CANCELED',
          putawayBlockReason: 'CANCELED',
        };
        return {
          receiptLineId: 'rl-1',
          poId: 'po-1',
          skuId: 's1',
          quantity: current.quantity,
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
            items: [
              {
                id: 'l-dst',
                code: 'B-05-03',
                displayName: 'B-05-03',
                isActive: true,
                isSystem: false,
              },
            ],
            total: 1,
          };
        }
        return { items: [], total: 0 };
      }
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const runtime = createTestWorkRuntime(client);
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
        <ScanButton code="9999" />
        <PurchaseOrderReceiveScreen poId="po-1" />
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
  return qc;
}

describe('PurchaseOrderReceiveScreen', () => {
  it('발주 라인을 발주/입고/남은 수량으로 보여준다', async () => {
    await renderScreen([]);
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(screen.getByText(/남은 12/)).toBeInTheDocument();
  });

  it('예정 바코드 첫 스캔은 실제 스캔한 수량으로 열린다', async () => {
    const user = userEvent.setup();
    await renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    expect(sheet).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
  });

  it('발주에 없는 바코드는 시트를 열지 않고 경고한다', async () => {
    const user = userEvent.setup();
    await renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:9999' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '이 발주에 없는 품목'
    );
    expect(
      screen.queryByRole('dialog', { name: '입고 수량' })
    ).not.toBeInTheDocument();
  });

  it('입고하면 POST /purchase-orders/:poId/receipts 에 lines 1개를 보내고 결과 배너를 남긴다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '입고' }));

    await waitFor(() => {
      const receive = calls.find(
        (c) => c.path === '/purchase-orders/po-1/receipts'
      );
      expect(receive?.body).toMatchObject({
        warehouseId: 'w-1',
        lines: [{ skuId: 's1', quantity: 1 }],
      });
      expect(receive?.idempotencyKey).toBeTruthy();
    });
    expect(await screen.findByText(/입고됨/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '적치하기' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('적치를 마치면 취소 버튼이 사라진다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '입고' }));
    await screen.findByRole('button', { name: '적치하기' });

    await user.click(screen.getByRole('button', { name: '적치하기' }));
    const sheet = await screen.findByRole('dialog', { name: '적치' });
    // 대상지를 못 고른 채 "나중에" 로 닫아도 취소 버튼은 남아야 한다
    await user.click(screen.getByRole('button', { name: '나중에' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '취소' })).toBeInTheDocument();
  });

  it('부분 적치를 실제로 완료하면 배너 누계·취소 게이트·재오픈 시 잔여가 반영된다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getAllByRole('button', { name: '입고' })[0]);
    await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '입고' }));
    await screen.findByRole('button', { name: '적치하기' });

    // 1차 부분 적치: 12개 중 7개.
    await user.click(screen.getByRole('button', { name: '적치하기' }));
    let sheet = await screen.findByRole('dialog', { name: '적치' });
    await user.type(
      within(sheet).getByLabelText('대상 로케이션 검색'),
      'B-05-03'
    );
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '적치' })).toBeEnabled()
    );
    // 프리필 12 → 지우기·지우기 → 0 → '7' = 7.
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '7' }));
    await user.click(within(sheet).getByRole('button', { name: '적치' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());

    expect(await screen.findByText(/7개 적치됨/)).toBeInTheDocument();
    // 간편입고 적치 대기 행과 같은 어휘("잔여 N개 · M개 적치됨")를 쓰는지 — 두 화면의
    // 표시가 실제로 맞는지(주석만 그렇다고 말하는 게 아니라)를 잠근다.
    expect(screen.getByText(/잔여 5개 · 7개 적치됨/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '취소' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '적치하기' })
    ).toBeInTheDocument();

    // 재오픈하면 잔여(5)로 다시 프리필된다 — 대입 버그라면 여전히 12가 제안된다.
    await user.click(screen.getByRole('button', { name: '적치하기' }));
    sheet = await screen.findByRole('dialog', { name: '적치' });
    expect(within(sheet).getByText(/잔여 5개/)).toBeInTheDocument();

    // 2차 부분 적치: 남은 5개 중 3개. 여기가 누적(10) vs 대입(3)을 가른다.
    await user.type(
      within(sheet).getByLabelText('대상 로케이션 검색'),
      'B-05-03'
    );
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '적치' })).toBeEnabled()
    );
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '3' }));
    await user.click(within(sheet).getByRole('button', { name: '적치' }));
    await waitFor(() => expect(sheet).not.toBeInTheDocument());

    expect(await screen.findByText(/10개 적치됨/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: '취소' })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '적치하기' })
    ).toBeInTheDocument();

    // 재오픈하면 잔여(2)로 프리필된다 — 대입 버그라면 9가 제안돼 서버가 거부할 값이 된다.
    await user.click(screen.getByRole('button', { name: '적치하기' }));
    sheet = await screen.findByRole('dialog', { name: '적치' });
    expect(within(sheet).getByText(/잔여 2개/)).toBeInTheDocument();

    const putawayCalls = calls.filter((c) => c.path === '/inbound/putaway');
    expect(putawayCalls).toHaveLength(2);
    expect(putawayCalls[0].body).toMatchObject({ quantity: 7 });
    expect(putawayCalls[1].body).toMatchObject({ quantity: 3 });
  });

  it('시트가 열린 뒤 같은 바코드를 다시 찍으면 스캔 누적으로 넘어간다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('코튼셔츠');

    // 여는 스캔부터 실제 수량 1개가 보인다.
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    // 수량 표시 div 로 좁힌다 — NumberPad 의 숫자 키(0~9)와 텍스트가 겹친다.
    expect(
      within(sheet).getByText('1', { selector: 'div' })
    ).toBeInTheDocument();

    // 둘째 스캔(총 2 회)부터 "세는 중"이 화면에 보인다.
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    expect(
      await within(sheet).findByText('2', { selector: 'div' })
    ).toBeInTheDocument();
    // 셋째 스캔(총 3 회) — 3 번 찍었으면 3 개가 세여야 한다(N 회 스캔 = N 개,
    // N-1 개가 되는 과소입고를 여기서 고정한다).
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    expect(
      await within(sheet).findByText('3', { selector: 'div' })
    ).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '입고' }));
    await waitFor(() => {
      const receive = calls.find(
        (c) => c.path === '/purchase-orders/po-1/receipts'
      );
      expect(receive?.body).toMatchObject({
        lines: [{ skuId: 's1', quantity: 3 }],
      });
    });
  });

  it('시트가 열린 상태에서 다른 품목을 찍으면 누적하지 않고 알린다', async () => {
    const user = userEvent.setup();
    await renderScreen([]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await user.click(screen.getByRole('button', { name: '스캔:9999' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // 시트는 그대로 열려 있고 수량도 프리필 그대로다
    expect(
      screen.getByRole('dialog', { name: '입고 수량' })
    ).toBeInTheDocument();
  });

  it('남은 수량을 넘는 값은 제출하지 않고 시트 안에 안내한다 (초과 수령은 서버가 거절한다)', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });

    // 프리필 12(남은 수량)를 지우고 13을 입력한다.
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '지우기' }));
    await user.click(within(sheet).getByRole('button', { name: '1' }));
    await user.click(within(sheet).getByRole('button', { name: '3' }));

    expect(
      within(sheet).getByText(
        '남은 수량 12개를 넘습니다. 발주 수량을 확인해 주세요.'
      )
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: '입고' })).toBeDisabled();
    expect(calls.some((c) => c.path === '/purchase-orders/po-1/receipts')).toBe(
      false
    );
  });

  it('취소 확인 다이얼로그가 뜬 동안 스캔해도 수량 시트가 열리지 않는다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '입고' }));
    await screen.findByRole('button', { name: '적치하기' });

    await user.click(screen.getByRole('button', { name: '취소' }));
    const dialog = await screen.findByRole('dialog', { name: '입고 취소' });

    // 취소 확인이 뜬 동안은 목록 상태(active===null)라 스캔이 그냥 통과하면
    // 다이얼로그 뒤에 새 수량 시트가 몰래 열린다 — 그러면 안 된다.
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    expect(
      screen.queryByRole('dialog', { name: '입고 수량' })
    ).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '취소하기' }));

    await waitFor(() => {
      const cancel = calls.find(
        (c) => c.path === '/purchase-orders/receipt-lines/rl-1/cancel'
      );
      expect(cancel?.body).toMatchObject({
        idempotencyKey: expect.any(String),
      });
    });
  });

  it('결과 배너의 취소는 POST /purchase-orders/receipt-lines/:id/cancel 로 간다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '입고' }));
    await screen.findByRole('button', { name: '적치하기' });

    await user.click(screen.getByRole('button', { name: '취소' }));
    const dialog = await screen.findByRole('dialog', { name: '입고 취소' });
    expect(dialog).toHaveTextContent('코튼셔츠 1개 입고를 전량 취소합니다.');
    // 배너 자체의 [취소] 버튼은 다이얼로그가 뜬 동안 사라져, 다이얼로그의 [취소]
    // 버튼과 접근성 이름이 겹치지 않는다(딱 하나만 남는다).
    expect(screen.getAllByRole('button', { name: '취소' })).toHaveLength(1);

    await user.click(within(dialog).getByRole('button', { name: '취소하기' }));

    await waitFor(() => {
      const cancel = calls.find(
        (c) => c.path === '/purchase-orders/receipt-lines/rl-1/cancel'
      );
      expect(cancel?.body).toMatchObject({
        idempotencyKey: expect.any(String),
      });
      expect(cancel?.idempotencyKey).toBeTruthy();
    });
  });

  it('입고가 실패하면 시트 안에 에러가 보이고, 시트가 열린 채로 남아 재시도할 수 있다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls, { failReceive: true });
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(within(sheet).getByRole('button', { name: '입고' }));

    // 시트가 화면 전체를 덮으므로, 에러도 시트 안에서 보여야 작업자가 알아챈다.
    await waitFor(() =>
      expect(
        screen.getByText(/처리 여부를 확인하고 있어요/)
      ).toBeInTheDocument()
    );
    // 응답이 실패로 보이는 동안은 배너로 넘어가지 않고 시트가 남아, 성공/실패를
    // 모른 채로 값을 고쳐 다시 누르는 이중입고 경로를 차단한다.
    expect(
      screen.getByRole('dialog', { name: '입고 수량' })
    ).toBeInTheDocument();
    expect(screen.queryByText(/입고됨/)).not.toBeInTheDocument();
  });

  it('서버 충돌은 내부 식별자 없이 안내한다', async () => {
    const user = userEvent.setup();
    await renderScreen([], { conflictReceive: true });
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(within(sheet).getByRole('button', { name: '입고' }));

    await waitFor(() =>
      expect(
        screen.getByText(/처리 여부를 확인하고 있어요/)
      ).toBeInTheDocument()
    );
    expect(sheet).not.toHaveTextContent('s1');
  });

  it('응답이 유실되고 품목이 사라져도 원래 요청의 성공을 추정하지 않는다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    const qc = await renderScreen(calls, {
      failReceive: true,
      silentCommit: true,
    });
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    const sheet = await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(within(sheet).getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(within(sheet).getByRole('button', { name: '입고' }));

    await screen.findByText(/처리 여부를 확인하고 있어요/);
    await qc.refetchQueries({ queryKey: ['expected-arrivals'] });
    // 목록에서 품목이 사라진 사실만으로 이 요청의 성공을 추정할 수 없다. 원래
    // 멱등키의 결과가 확인될 때까지 입력을 보존하고 재제출·취소를 막는다.
    expect(
      await within(sheet).findByText(
        '발주 상태가 바뀌었어요. 입고내역을 확인해 주세요.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('dialog', { name: '입고 수량' })
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: '입고' })).toBeDisabled();
    expect(
      within(sheet).queryByRole('button', { name: '입력 취소' })
    ).not.toBeInTheDocument();
  });

  it('취소가 실패로 보여도 같은 라인으로 재시도하면 같은 멱등키를 재사용한다', async () => {
    const user = userEvent.setup();
    const calls: Call[] = [];
    await renderScreen(calls, { failCancel: true });
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByRole('dialog', { name: '입고 수량' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '입고' })).toBeEnabled()
    );
    await user.click(screen.getByRole('button', { name: '입고' }));
    await screen.findByRole('button', { name: '적치하기' });

    await user.click(screen.getByRole('button', { name: '취소' }));
    const dialog = await screen.findByRole('dialog', { name: '입고 취소' });
    await user.click(within(dialog).getByRole('button', { name: '취소하기' }));
    await waitFor(() => {
      expect(
        calls.filter(
          (c) => c.path === '/purchase-orders/receipt-lines/rl-1/cancel'
        )
      ).not.toHaveLength(0);
    });

    await screen.findByText(/처리 여부를 확인하고 있어요/);
    expect(
      screen.queryByRole('button', { name: '취소' })
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '처리 내역 확인' }));
    await waitFor(() =>
      expect(
        calls.filter(
          (c) => c.path === '/purchase-orders/receipt-lines/rl-1/cancel'
        ).length
      ).toBeGreaterThan(1)
    );
    // 같은 receiptLineId 재시도는 본문과 헤더 모두 같은 키를 유지한다.
    const cancelCalls = calls.filter(
      (c) => c.path === '/purchase-orders/receipt-lines/rl-1/cancel'
    );
    expect(cancelCalls[0].idempotencyKey).toBe(cancelCalls[1].idempotencyKey);
  });
});
