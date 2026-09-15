import { expect, it } from 'vitest';
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
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { ScanProvider } from '../../core/hardware/scan/ScanProvider';
import { createMemoryPrefs } from '../../core/data/devicePrefs';
import type { ApiClient } from '../../core/data/httpClient';
import { LocationOutboundScreen } from './LocationOutboundScreen';
const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
};
const shipment = {
  shipmentId: 's',
  warehouseId: 'w',
  outboundContract: 'location' as const,
  trackingNo: 'T',
  carrier: '택배',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b',
  workItemId: 'wi',
  workItemStatus: 'queued',
  recipientMasked: '김**',
  lines: [
    {
      shipmentLineId: 'line',
      skuId: 'sku',
      skuCode: 'S',
      skuName: '셔츠',
      qty: 3,
      pickedQty: 0,
      inspectedQty: 0,
    },
  ],
};
const source = (id: string, qty: number) => ({
  shipmentLineId: 'line',
  skuId: 'sku',
  sourceLocationId: id,
  sourceLocationCode: id,
  allocatedQty: qty,
  pickedQty: 0,
  remainingQty: qty,
});
const state = {
  shipmentId: 's',
  warehouseId: 'w',
  status: 'in_progress',
  workItemStatus: 'picking',
  dispatchAttemptId: null,
  lines: [
    {
      shipmentLineId: 'line',
      skuId: 'sku',
      qty: 3,
      pickedQty: 0,
      inspectedQty: 0,
    },
  ],
  sources: [source('A', 1), source('B', 2)],
};
type Call = { path: string; method?: string; body?: unknown };
function mount(request: ApiClient['request'], warehouseId = 'w') {
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
    component: () => (
      <LocationOutboundScreen
        shipmentId="s"
        shipment={shipment}
        prefs={prefs}
      />
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([index]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <SessionProvider session={session}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ApiClientProvider client={{ request }}>
          <WarehouseProvider prefs={prefs}>
            <ScanProvider>
              <RouterProvider router={router} />
            </ScanProvider>
          </WarehouseProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
it('위치 선택 없이는 접수하지 않고 선택한 B와 수량을 요청에 고정한다', async () => {
  const calls: Call[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  mount((async (opts: Call) => {
    calls.push(opts);
    if (opts.path === '/inventory/work-context')
      return { capabilities: { locationOutbound: true } };
    if (opts.path.endsWith('location-outbound-scans')) {
      await gate;
      return {
        ...state,
        lines: [{ ...state.lines[0], pickedQty: 2 }],
        sources: [
          source('A', 1),
          { ...source('B', 2), pickedQty: 2, remainingQty: 0 },
        ],
      };
    }
    return state;
  }) as ApiClient['request']);
  const start = await screen.findByRole('button', { name: '출고 준비' });
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.click(start);
  await screen.findByRole('button', { name: 'B 선택' });
  expect(screen.getByLabelText('출고 상품 바코드')).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'B 선택' }));
  const quantity = screen.getByLabelText(/다음 스캔 수량/);
  await userEvent.clear(quantity);
  await userEvent.type(quantity, '2');
  await userEvent.type(
    screen.getByLabelText('출고 상품 바코드'),
    '8801{Enter}'
  );
  await waitFor(() =>
    expect(
      calls.find((c) => c.path.endsWith('location-outbound-scans'))?.body
    ).toEqual({
      warehouseId: 'w',
      sourceLocationId: 'B',
      barcode: '8801',
      quantity: 2,
    })
  );
  expect(screen.getByRole('button', { name: '위치 변경' })).toBeDisabled();
  release();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '위치 변경' })).toBeEnabled()
  );
  expect(calls.some((c) => c.path.includes('simple-outbound'))).toBe(false);
});
it('선택 창고가 다르면 출고 준비 명령을 만들지 않는다', async () => {
  const calls: Call[] = [];
  mount(
    (async (opts: Call) => {
      calls.push(opts);
      return { capabilities: { locationOutbound: true } };
    }) as ApiClient['request'],
    'other'
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('창고');
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});
it('서버 미지원이면 준비와 위치 없는 자동 전환을 막는다', async () => {
  const calls: Call[] = [];
  mount((async (opts: Call) => {
    calls.push(opts);
    return { capabilities: {} };
  }) as ApiClient['request']);
  expect(await screen.findByRole('alert')).toHaveTextContent('업데이트');
  expect(screen.getByRole('button', { name: '출고 준비' })).toBeDisabled();
  expect(calls.some((c) => c.method === 'POST')).toBe(false);
});
it('스캔 생략은 사유와 모든 위치별 실물 수량을 명시한다', async () => {
  const calls: Call[] = [];
  mount((async (opts: Call) => {
    calls.push(opts);
    if (opts.path === '/inventory/work-context')
      return { capabilities: { locationOutbound: true } };
    if (opts.path.endsWith('location-outbound-forces'))
      return { ...state, status: 'shipped', sources: [] };
    return state;
  }) as ApiClient['request']);
  const start = await screen.findByRole('button', { name: '출고 준비' });
  await waitFor(() => expect(start).toBeEnabled());
  await userEvent.click(start);
  await userEvent.click(
    await screen.findByRole('button', { name: '스캔 생략 확인' })
  );
  const dialog = screen.getByRole('dialog');
  const confirm = within(dialog).getByRole('button', {
    name: '확인한 수량 출고',
  });
  expect(confirm).toBeDisabled();
  await userEvent.type(
    within(dialog).getByLabelText('스캔 생략 사유'),
    '포장 실물 확인'
  );
  await userEvent.type(within(dialog).getByLabelText(/A 실물 수량/), '1');
  await userEvent.type(within(dialog).getByLabelText(/B 실물 수량/), '2');
  await userEvent.click(confirm);
  await waitFor(() =>
    expect(
      calls.find((c) => c.path.endsWith('location-outbound-forces'))?.body
    ).toMatchObject({
      warehouseId: 'w',
      reason: '포장 실물 확인',
      items: [
        { shipmentLineId: 'line', sourceLocationId: 'A', quantity: 1 },
        { shipmentLineId: 'line', sourceLocationId: 'B', quantity: 2 },
      ],
    })
  );
});
