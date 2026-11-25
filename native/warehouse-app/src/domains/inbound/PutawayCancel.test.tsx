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
import { describe, expect, it } from 'vitest';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import { ApiError, type ApiClient } from '../../core/data/httpClient';
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import {
  createTestWorkRuntime,
  receiptFixture,
  TestWorkProvider,
} from './__fixtures__/workRuntime';
import { PutawayQueueScreen } from './PutawayQueueScreen';
import type { ReceiptLineState } from './receiptState';
import type { ReceiptSource } from './types';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};

interface Sent {
  path: string;
  body?: unknown;
  idempotencyKey?: string;
}

const DAY = 86_400_000;

async function open(
  opts: {
    source?: ReceiptSource;
    receivedAt?: string;
    /** 상태 조회를 차례로 소비한다(마지막 항목 반복) */
    states?: Array<Partial<ReceiptLineState>>;
    reply?: (sent: Sent) => unknown;
  } = {}
) {
  const sent: Sent[] = [];
  let reads = 0;
  let canceled = false;
  let barcodes = 0;
  const source = opts.source ?? 'direct';
  const api: ApiClient = {
    request: (async (o: Sent) => {
      if (o.path.startsWith('/inbound/lines/')) {
        const states = opts.states ?? [{}];
        return receiptFixture({
          lineId: 'l-1',
          source,
          quantity: 5,
          pendingQty: 5,
          ...states[Math.min(reads++, states.length - 1)],
        });
      }
      if (o.path.startsWith('/inbound/putaway/pending'))
        return {
          total: canceled ? 0 : 1,
          truncated: false,
          nextCursor: null,
          items: canceled
            ? []
            : [
                {
                  source,
                  canPutaway: true,
                  putawayBlockReason: null,
                  lineId: 'l-1',
                  skuId: 's1',
                  skuName: '시험 상품',
                  skuCode: 'T-1',
                  pendingQty: 5,
                  originLocationId: 'l-origin',
                  originLocationCode: '입고존',
                  receivedAt: opts.receivedAt ?? new Date().toISOString(),
                },
              ],
        };
      if (o.path.startsWith('/inventory/stocks/return-zone'))
        return {
          locationId: 'r',
          locationCode: 'R',
          warehouseId: 'w-1',
          items: [],
        };
      if (o.path.startsWith('/waiting-orders?')) return { items: [] };
      if (o.path.startsWith('/inventory/skus?barcode=')) {
        barcodes++;
        return [];
      }
      if (
        o.path === '/inbound/cancel' ||
        o.path.startsWith('/purchase-orders/receipt-lines/')
      ) {
        sent.push(o);
        const result = opts.reply
          ? await opts.reply(o)
          : source === 'purchase_order'
            ? { receiptLineId: 'l-1', poId: 'po', skuId: 's1', quantity: 5 }
            : { success: true };
        canceled = true;
        return result;
      }
      throw new Error(`unexpected ${o.path}`);
    }) as unknown as ApiClient['request'],
  };
  const runtime = createTestWorkRuntime(api);
  let bus: ReturnType<typeof useScanBus> | null = null;
  function GrabBus() {
    bus = useScanBus();
    return null;
  }
  const root = createRootRoute({ component: () => <Outlet /> });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/',
        component: () => (
          <>
            <GrabBus />
            <PutawayQueueScreen />
          </>
        ),
      }),
      createRoute({
        getParentRoute: () => root,
        path: '/inbound/history',
        component: () => <p>내역 화면</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <SessionProvider session={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TestWorkProvider runtime={runtime}>
          <WarehouseProvider
            prefs={createMemoryPrefs({
              'almondwms.warehouse': JSON.stringify({
                id: 'w-1',
                name: '창고',
              }),
            })}
          >
            <ScanProvider>
              <RouterProvider router={router} />
            </ScanProvider>
          </WarehouseProvider>
        </TestWorkProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  const open = await screen.findByRole('button', { name: '잘못 입고 · 취소' });
  await waitFor(() => expect(open).toBeEnabled());
  await userEvent.click(open);
  const dialog = await screen.findByRole('dialog', { name: '입고 취소 확인' });
  const submit = within(dialog).getByRole('button', { name: '전량 취소' });
  return {
    sent,
    dialog,
    submit,
    barcodes: () => barcodes,
    scan: (code: string) =>
      act(() => bus?.emit({ code, source: 'hid', at: 1 })),
  };
}

describe('적치 대기에서 입고 취소', () => {
  it('그 줄을 전량 취소하고 목록에서 사라진다', async () => {
    const { sent, submit, dialog } = await open();
    await waitFor(() => expect(submit).toBeEnabled());
    expect(dialog).toHaveTextContent('시험 상품 5개');
    expect(dialog).not.toHaveTextContent('오늘 입고한 건이 아니에요');
    await userEvent.click(submit);
    expect(
      await screen.findByText((_, el) => el?.getAttribute('role') === 'status' && el.textContent === '입고 취소시험 상품 5개')
    ).toBeInTheDocument();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      path: '/inbound/cancel',
      body: { lineId: 'l-1', quantity: 5 },
    });
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: '잘못 입고 · 취소' })
      ).not.toBeInTheDocument()
    );
  });

  it('발주 입고는 발주 취소 경로로 보낸다', async () => {
    const { sent, submit, dialog } = await open({ source: 'purchase_order' });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(dialog).toHaveTextContent('발주 미입고 수량이 복원됩니다.');
    await userEvent.click(submit);
    await waitFor(() =>
      expect(sent[0]?.path).toBe('/purchase-orders/receipt-lines/l-1/cancel')
    );
  });

  it('다른 날 입고한 건이면 날짜를 확인하게 한다', async () => {
    const { submit, dialog } = await open({
      receivedAt: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(dialog).toHaveTextContent('오늘 입고한 건이 아니에요');
  });

  it('다시 재고를 기다리게 되는 주문을 먼저 보인다', async () => {
    const { submit, dialog } = await open({
      states: [
        {
          cancelReservations: {
            orderCount: 2,
            quantity: 3,
            missingQty: 0,
            heldBy: [],
          },
        },
      ],
    });
    await waitFor(() => expect(submit).toBeEnabled());
    expect(dialog).toHaveTextContent(
      '이 재고를 잡아 둔 주문 2건(3개)은 다시 재고를 기다려요.'
    );
  });

  it('출고 준비에 들어간 주문이 잡고 있으면 막고 그 주문을 보인다', async () => {
    const { submit, dialog, sent } = await open({
      states: [
        {
          cancelReservations: {
            orderCount: 0,
            quantity: 0,
            missingQty: 3,
            heldBy: [{ orderNo: '1234', quantity: 3 }],
          },
        },
        {},
      ],
    });
    await within(dialog).findByText('주문 1234 · 3개');
    expect(dialog).toHaveTextContent(
      '송장을 무효화하고 출고 배치에서 빼 달라고'
    );
    expect(submit).toBeDisabled();
    expect(sent).toHaveLength(0);
    // 관리자가 빼 주면 창을 닫지 않고 이어서 취소한다
    await userEvent.click(
      within(dialog).getByRole('button', { name: '다시 확인' })
    );
    await waitFor(() => expect(submit).toBeEnabled());
    expect(dialog).not.toHaveTextContent('주문 1234');
  });

  it.each([
    [
      '적치함',
      { cancelBlockReason: 'ALREADY_PUTAWAY', putawayFromOriginQty: 2 },
      '이미 2개를 선반에 넣어',
    ],
    [
      '다른 기기에서 취소함',
      { cancelBlockReason: 'CANCELED' },
      '이미 취소된 입고예요.',
    ],
  ] as const)(
    '취소할 수 없으면 할 일을 말한다 — %s',
    async (_name, state, text) => {
      const { submit, dialog } = await open({
        states: [{ canCancel: false, ...state }],
      });
      await waitFor(() => expect(dialog).toHaveTextContent(text));
      expect(submit).toBeDisabled();
    }
  );

  it('선적 상자 입고는 줄로 취소하지 않고 입고내역으로 보낸다', async () => {
    const { submit, dialog, sent } = await open({ source: 'inbound_shipment' });
    expect(
      within(dialog).getByRole('link', { name: '입고내역' })
    ).toHaveAttribute('href', '/inbound/history');
    expect(submit).toBeDisabled();
    expect(sent).toHaveLength(0);
  });

  it('누르는 사이 잡은 주문이 바뀌면 보내지 않고 바뀐 내용을 다시 보인다', async () => {
    const holding = (orderCount: number) => ({
      cancelReservations: {
        orderCount,
        quantity: orderCount,
        missingQty: 0,
        heldBy: [],
      },
    });
    const { submit, dialog, sent } = await open({
      states: [holding(0), holding(1)],
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await within(dialog).findByText(/이 재고를 잡은 주문이 바뀌었어요/);
    expect(dialog).toHaveTextContent('주문 1건(1개)은 다시 재고를 기다려요');
    expect(sent).toHaveLength(0);
    await userEvent.click(submit);
    await waitFor(() => expect(sent).toHaveLength(1));
  });

  it('서버가 거절하면 이유를 알리고 목록을 다시 읽는다', async () => {
    const { submit } = await open({
      reply: () => {
        throw new ApiError('x', 409, 'CONFLICT');
      },
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    expect(
      await screen.findByText(
        '이 재고를 잡은 주문 때문에 취소하지 못했어요. 입고내역에서 다시 열어 확인해 주세요.'
      )
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '잘못 입고 · 취소' })
    ).toBeInTheDocument();
  });

  it('두 번 눌러도 한 번만 보낸다', async () => {
    const { submit, sent } = await open();
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.dblClick(submit);
    await screen.findByText((_, el) => el?.getAttribute('role') === 'status' && el.textContent === '입고 취소시험 상품 5개');
    expect(sent).toHaveLength(1);
  });

  it('창이 열린 동안 찍은 상품은 적치로 넘기지 않는다', async () => {
    const { submit, scan, barcodes } = await open();
    await waitFor(() => expect(submit).toBeEnabled());
    await scan('8801234567890');
    expect(barcodes()).toBe(0);
  });

  it('예약 정보를 주지 않는 서버에서도 취소할 수 있다', async () => {
    const { submit, sent } = await open({
      states: [{ cancelReservations: undefined }],
    });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await waitFor(() => expect(sent).toHaveLength(1));
  });
});
