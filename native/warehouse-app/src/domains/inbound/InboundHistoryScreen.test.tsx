import {
  createTestWorkRuntime,
  TestWorkProvider,
  receiptFixture,
} from './__fixtures__/workRuntime';
import { expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
import type { ApiClient } from '../../core/data/httpClient';
import { InboundHistoryScreen } from './InboundHistoryScreen';
import { StaffNamesClientProvider, SYSTEM_ACTOR_ID } from './staffNames';
import { ApiError } from '../../core/data/httpClient';
const station = vi.hoisted(() => ({ on: false }));
vi.mock('../../app/station', () => ({ isStationDevice: () => station.on }));
const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
  identity: async () => ({ id: 'worker-a', name: '작업자A' }),
};
type Call = { path: string; method?: string; body?: unknown };
const noStaffNames: ApiClient = {
  request: async () => {
    throw new Error('staff names unavailable');
  },
};
async function mount(
  request: ApiClient['request'],
  staffNames: ApiClient = noStaffNames
) {
  const runtime = createTestWorkRuntime({
    request: async (r) => {
      if (!r.path.startsWith('/inbound/lines/')) return request(r);
      const id = r.path.split('/')[3];
      const history = await request<{ items: ReturnType<typeof receipt>[] }>({
        path: `/inbound/receipts?warehouseId=w&receiptId=${id}&status=all&limit=1&offset=0`,
      });
      const item = history.items.find((item) => item.id === id);
      if (!item) throw new Error('입고내역을 확인해 주세요.');
      const line = item.lines[0];
      return receiptFixture({
        ...line,
        lineId: id,
        receiptId: id,
        warehouseId: 'w',
        receiptStatus: item.status as 'posted' | 'voided',
        cancelBlockReason: line.canCancel ? null : 'CANCELED',
        pendingQty: line.canceledQty ? 0 : line.quantity,
        canPutaway: !line.canceledQty,
        putawayBlockReason: line.canceledQty ? 'CANCELED' : null,
      }) as never;
    },
  });
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: InboundHistoryScreen,
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const prefs = {
    get: () => JSON.stringify({ id: 'w', name: '시험창고' }),
    set: () => {},
    remove: () => {},
  };
  render(
    <SessionProvider session={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TestWorkProvider runtime={runtime}>
          <StaffNamesClientProvider client={staffNames}>
            <WarehouseProvider prefs={prefs}>
              <RouterProvider router={router} />
            </WarehouseProvider>
          </StaffNamesClientProvider>
        </TestWorkProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  await waitFor(() =>
    expect(
      screen.queryByText('앱과 서버 업데이트를 확인한 뒤 다시 시도해 주세요.')
    ).not.toBeInTheDocument()
  );
}
const line = (
  id: string,
  source: 'direct' | 'purchase_order',
  canceled = false
) => ({
  id,
  skuId: id,
  skuName: id === 'd' ? '직접상품' : '발주상품',
  skuCode: id,
  quantity: 4,
  source,
  originLocationCode: 'INBOUND',
  canceledQty: canceled ? 4 : 0,
  returnedQty: 0,
  putawayFromOriginQty: 0,
  canCancel: !canceled,
  cancelBlockReason: canceled ? 'ALREADY_CANCELED' : null,
});
const receipt = (
  id: string,
  source: 'direct' | 'purchase_order',
  canceled = false
) => ({
  id,
  warehouseId: 'w',
  method: 'simple',
  occurredAt: new Date().toISOString(),
  status: canceled ? 'voided' : 'posted',
  totalQuantity: 4,
  lines: [line(id, source, canceled)],
});
it('직접/발주 입고 취소는 각 출처 API를 쓰고 취소 이력을 남긴다', async () => {
  const calls: Call[] = [];
  const canceled = new Set<string>();
  await mount((async (opts: Call) => {
    calls.push(opts);
    if (opts.path.startsWith('/inbound/receipts?')) {
      const id = new URL(opts.path, 'https://local').searchParams.get(
        'receiptId'
      );
      const items = [
        receipt('d', 'direct', canceled.has('d')),
        receipt('p', 'purchase_order', canceled.has('p')),
      ].filter((item) => !id || item.id === id);
      return {
        items,
        total: items.length,
        serverTime: new Date().toISOString(),
      };
    }
    if (opts.path === '/inbound/cancel') {
      canceled.add('d');
      return { success: true };
    }
    if (opts.path === '/purchase-orders/receipt-lines/p/cancel') {
      canceled.add('p');
      return { receiptLineId: 'p', poId: 'po', skuId: 'p', quantity: 4 };
    }
    return {};
  }) as ApiClient['request']);
  await userEvent.click(
    await screen.findByRole('button', { name: '직접상품 입고 취소' })
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '전량 취소',
      })
    ).toBeEnabled()
  );
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '전량 취소',
    })
  );
  await waitFor(() =>
    expect(calls.find((c) => c.path === '/inbound/cancel')?.body).toMatchObject(
      { lineId: 'd', quantity: 4 }
    )
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '발주상품 입고 취소' })
    ).toBeEnabled()
  );
  await userEvent.click(
    await screen.findByRole('button', { name: '발주상품 입고 취소' })
  );
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveTextContent(
      '발주 미입고 수량이 복원'
    )
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: '전량 취소',
      })
    ).toBeEnabled()
  );
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '전량 취소',
    })
  );
  await waitFor(() =>
    expect(
      calls.some((c) => c.path === '/purchase-orders/receipt-lines/p/cancel')
    ).toBe(true)
  );
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: '발주상품 입고 취소' })
    ).not.toBeInTheDocument()
  );
  expect(screen.getAllByText('취소됨').length).toBeGreaterThan(0);
});
it('조회 오류를 빈 이력으로 표시하지 않는다', async () => {
  await mount((async () => {
    throw new Error('입고내역 연결 실패');
  }) as ApiClient['request']);
  expect(
    await screen.findByText(/입고내역을 불러오지 못했어요/)
  ).toBeInTheDocument();
  expect(screen.queryByText('입고내역이 없어요.')).not.toBeInTheDocument();
});
it('다음 페이지 조회 실패 시 이전 이력을 유지하고 취소는 잠근다', async () => {
  await mount((async (opts: Call) => {
    if (opts.path.includes('offset=20')) throw new Error('offline');
    return {
      items: [receipt('d', 'direct')],
      total: 21,
      serverTime: new Date().toISOString(),
    };
  }) as ApiClient['request']);
  await screen.findByRole('button', { name: '직접상품 입고 취소' });
  await userEvent.click(screen.getByRole('button', { name: '다음' }));
  expect(
    await screen.findByText(/입고내역을 불러오지 못했어요/)
  ).toBeInTheDocument();
  expect(screen.getByText('직접상품')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: '직접상품 입고 취소' })
  ).not.toBeInTheDocument();
  expect(screen.getByText(/1페이지/)).toBeInTheDocument();
});

it('keeps invalid diagnostic rows visible and valid neighboring actions available', async () => {
  const bad = receipt('bad', 'direct');
  const good = receipt('d', 'direct');
  bad.lines[0] = {
    ...bad.lines[0],
    skuName: '확인필요상품',
    putawayFromOriginQty: -1,
    canCancel: false,
    cancelBlockReason: 'INSUFFICIENT_ORIGIN_STOCK',
    pendingQty: 5,
    canPutaway: false,
    putawayBlockReason: 'ORIGIN_STOCK_INCONSISTENT',
  } as (typeof bad.lines)[0];
  const calls: Call[] = [];
  await mount((async (opts: Call) => {
    calls.push(opts);
    return {
      items: [bad, good],
      total: 2,
      serverTime: new Date().toISOString(),
    };
  }) as ApiClient['request']);
  expect(await screen.findByText('확인필요상품')).toBeInTheDocument();
  expect(screen.getByText('직접상품')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /입고 취소/ })).toHaveLength(1);
  expect(calls.every((call) => !call.method || call.method === 'GET')).toBe(
    true
  );
});

it('선반에 넣어 취소할 수 없는 입고는 실사로 맞추는 길을 함께 보인다', async () => {
  const putaway = receipt('p', 'direct');
  putaway.lines[0] = {
    ...putaway.lines[0],
    skuName: '적치한상품',
    putawayFromOriginQty: 4,
    canCancel: false,
    cancelBlockReason: 'PUTAWAY_EXISTS',
  } as (typeof putaway.lines)[0];
  await mount((async () => ({
    items: [putaway],
    total: 1,
    serverTime: new Date().toISOString(),
  })) as ApiClient['request']);
  expect(await screen.findByText(/적치한상품/)).toBeInTheDocument();
  expect(screen.getByText(/이미 적치한 입고/)).toHaveTextContent(
    '수량이 틀렸다면 F5 실사에서 그 선반을 세어 실물에 맞추고, 실사 완료는 물류 관리자에게 요청해 주세요.'
  );
  expect(screen.queryByRole('button', { name: /입고 취소/ })).toBeNull();
});

async function mountShipmentLine() {
  await mount((async (opts: Call) => {
    if (opts.path.startsWith('/inbound/receipts?')) {
      return {
        total: 1,
        serverTime: new Date().toISOString(),
        items: [
          {
            ...receipt('s', 'direct'),
            lines: [
              {
                ...line('s', 'direct'),
                skuName: '선적상품',
                source: 'inbound_shipment',
                inboundShipmentBox: {
                  shipmentId: 'ship-1',
                  shipmentName: '11월 2차 배편',
                  boxId: 'box-1',
                  boxLabel: 'L7',
                },
              },
            ],
          },
        ],
      };
    }
    return {};
  }) as ApiClient['request']);
}
it('shipment receipt line shows box and no line cancel', async () => {
  station.on = false;
  await mountShipmentLine();
  expect(
    await screen.findByText(/11월 2차 배편 · 상자 L7/)
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /입고 취소/ })
  ).not.toBeInTheDocument();
  expect(screen.getByText('스테이션에서 취소해요')).toBeInTheDocument();
});
it('shipment receipt line on station shows box without line cancel or handheld hint', async () => {
  station.on = true;
  await mountShipmentLine();
  expect(
    await screen.findByText(/11월 2차 배편 · 상자 L7/)
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: /입고 취소/ })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('스테이션에서 취소해요')).not.toBeInTheDocument();
  station.on = false;
});
it('on station the header has no back link, on handheld it goes back to the purchase-order list', async () => {
  station.on = true;
  await mountShipmentLine();
  await screen.findByText(/11월 2차 배편 · 상자 L7/);
  expect(screen.queryByRole('link', { name: '뒤로' })).toBeNull();
  station.on = false;
  cleanup();
  await mountShipmentLine();
  await screen.findByText(/11월 2차 배편 · 상자 L7/);
  expect(screen.getByRole('link', { name: '뒤로' })).toHaveAttribute('href', '/inbound');
});
it('on station the shipment box line links to that box', async () => {
  station.on = true;
  await mountShipmentLine();
  const link = await screen.findByRole('link', { name: /11월 2차 배편 · 상자 L7/ });
  expect(link).toHaveAttribute(
    'href',
    '/inbound/boxes?shipmentId=ship-1&boxId=box-1'
  );
  station.on = false;
});
it('on handheld the shipment box line is plain text, not a link', async () => {
  station.on = false;
  await mountShipmentLine();
  await screen.findByText(/11월 2차 배편 · 상자 L7/);
  expect(
    screen.queryByRole('link', { name: /11월 2차 배편 · 상자 L7/ })
  ).toBeNull();
});

it('입고내역은 내부 입고 번호와 줄 번호를 보이지 않고 시간·창고·상품별 수량·상태를 보인다', async () => {
  const item = {
    ...receipt('d', 'direct'),
    id: 'rcpt-7f3a9c21',
    occurredAt: '2026-11-25T05:07:00.000Z',
    lines: [{ ...line('d', 'direct'), id: 'rline-55b0e1' }],
  };
  await mount((async () => ({
    items: [item],
    total: 1,
    serverTime: new Date().toISOString(),
  })) as ApiClient['request']);
  const record = await screen.findByRole('listitem', {
    name: '2026.11.25 14:07 입고내역',
  });
  expect(record).toHaveTextContent('시험창고');
  expect(record).toHaveTextContent('1종 · 입고 4개');
  expect(within(record).getByText('직접상품')).toBeInTheDocument();
  expect(within(record).getByText('입고 완료')).toBeInTheDocument();
  expect(within(record).getByText('적치 대기')).toBeInTheDocument();
  expect(document.body.textContent).not.toContain('rcpt-7f3a9c21');
  expect(document.body.textContent).not.toContain('rline-55b0e1');
});

it('입고 취소 버튼은 마우스를 올려도 빨간 배경이 되지 않는다', async () => {
  await mount((async () => ({
    items: [receipt('d', 'direct')],
    total: 1,
    serverTime: new Date().toISOString(),
  })) as ApiClient['request']);
  const cancel = await screen.findByRole('button', {
    name: '직접상품 입고 취소',
  });
  expect(cancel).toHaveClass('hover:bg-white');
  expect(cancel.className).not.toMatch(/hover:bg-(red|\[#a)/);
});

const STAFF_A = '11111111-1111-4111-8111-111111111111';
const STAFF_B = '22222222-2222-4222-8222-222222222222';

function receiptsBy(actors: (string | null)[]) {
  return actors.map((actorId, i) => ({
    ...receipt(`r${i}`, 'direct'),
    occurredAt: `2026-11-25T0${i}:00:00.000Z`,
    actorId,
    lines: [{ ...line('d', 'direct'), id: `l${i}` }],
  }));
}

it('입고내역 줄마다 작업자 이름을 한 번의 묶음 조회로 보이고 자동 처리는 자동이다', async () => {
  const items = receiptsBy([STAFF_B, STAFF_A, SYSTEM_ACTOR_ID, STAFF_A]);
  const staffCalls: string[] = [];
  await mount(
    (async () => ({
      items,
      total: items.length,
      serverTime: new Date().toISOString(),
    })) as ApiClient['request'],
    {
      request: (async (opts: Call) => {
        staffCalls.push(opts.path);

        return {
          success: true,
          data: [
            { id: STAFF_A, name: '김입고' },
            { id: STAFF_B, name: '박적치' },
          ],
        };
      }) as ApiClient['request'],
    }
  );

  const first = await screen.findByRole('listitem', {
    name: '2026.11.25 09:00 입고내역',
  });
  await waitFor(() =>
    expect(first).toHaveTextContent('박적치 · 시험창고 · 직접')
  );
  expect(
    screen.getByRole('listitem', { name: '2026.11.25 10:00 입고내역' })
  ).toHaveTextContent('김입고 · 시험창고');
  expect(
    screen.getByRole('listitem', { name: '2026.11.25 11:00 입고내역' })
  ).toHaveTextContent('자동 · 시험창고');
  expect(staffCalls).toEqual([
    `/admin/staff/names?ids=${STAFF_A},${STAFF_B}`,
  ]);
});

it.each([
  ['권한 없음', new ApiError('GET → 403', 403, 'FORBIDDEN')],
  ['연결 실패', new Error('network')],
])('작업자 이름 조회가 %s 이어도 입고내역은 그대로 보이고 이름 자리는 빈 표시다', async (_, failure) => {
  const items = receiptsBy([STAFF_A, null]);
  await mount(
    (async () => ({
      items,
      total: items.length,
      serverTime: new Date().toISOString(),
    })) as ApiClient['request'],
    {
      request: async () => {
        throw failure;
      },
    }
  );

  const record = await screen.findByRole('listitem', {
    name: '2026.11.25 09:00 입고내역',
  });
  expect(record).toHaveTextContent('— · 시험창고');
  expect(record).toHaveTextContent('1종 · 입고 4개');
  expect(
    screen.getByRole('listitem', { name: '2026.11.25 10:00 입고내역' })
  ).toHaveTextContent('— · 시험창고');
  expect(
    within(record).getByRole('button', { name: '직접상품 입고 취소' })
  ).toBeInTheDocument();
});
