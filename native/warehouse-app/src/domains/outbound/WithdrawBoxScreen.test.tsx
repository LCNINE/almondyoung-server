import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import { createMemoryPrefs, type DevicePrefs } from '../../core/data/devicePrefs';
import { ConflictError, type ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { ScanProvider, useScanBus } from '../../core/hardware/scan/ScanProvider';
import { writeReturnBin } from '../returns/returnBin';
import type { ShipmentByWaybill } from './types';
import { WithdrawBoxScreen } from './WithdrawBoxScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

const shipment: ShipmentByWaybill = {
  shipmentId: 's-1',
  trackingNo: 'T-1',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'withdrawing',
  recipientMasked: '홍길**',
  lines: [],
  labelState: 'withdrawing',
  labelChanges: [],
  labelIssue: null,
  exitTo: 'draft',
  removals: [
    { shipmentLineId: 'l', skuId: 's', skuCode: 'C', skuName: '볼펜', sourceLocationId: 'loc', locationCode: 'A-01', boxQty: 1, cartQty: 0 },
  ],
};

function ScanButton({ code }: { code: string }) {
  const bus = useScanBus();
  return (
    <button type="button" onClick={() => bus.emit({ code, source: 'hid', at: Date.now() })}>
      스캔:{code}
    </button>
  );
}

function prefsWith(bin: string | null): DevicePrefs {
  const prefs = createMemoryPrefs({ 'almondwms.warehouse': JSON.stringify({ id: 'wh', name: '창고' }) });
  if (bin) writeReturnBin(prefs, { warehouseId: 'wh', barcode: bin });
  return prefs;
}

function mount(opts: {
  prefs: DevicePrefs;
  request: (o: unknown) => Promise<unknown>;
  shipment?: ShipmentByWaybill | null;
}) {
  const shown = opts.shipment === undefined ? shipment : opts.shipment;
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="880" />
        <ScanButton code="RB-9" />
        <WithdrawBoxScreen shipmentId="s-1" shipment={shown} prefs={opts.prefs} />
      </>
    ),
  });
  const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: () => <p>설정</p> });
  const outboundRoute = createRoute({ getParentRoute: () => rootRoute, path: '/outbound', component: () => <p>출고</p> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([screenRoute, settingsRoute, outboundRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SessionProvider session={session}>
      <WarehouseProvider prefs={opts.prefs}>
        <QueryClientProvider client={new QueryClient()}>
          <ApiClientProvider client={client}>
            <ScanProvider>{children}</ScanProvider>
          </ApiClientProvider>
        </QueryClientProvider>
      </WarehouseProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
  return { user: userEvent.setup() };
}

describe('WithdrawBoxScreen', () => {
  it('바구니를 지정하지 않았으면 스캔을 보내지 않고 설정으로 안내한다', async () => {
    const calls: unknown[] = [];
    const { user } = mount({ prefs: prefsWith(null), request: async (o) => { calls.push(o); return {}; } });
    expect(await screen.findByRole('alert')).toHaveTextContent('설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(calls).toEqual([]);
  });

  it('송장 정보를 잃은 채로는 스캔을 보내지 않는다', async () => {
    const calls: unknown[] = [];
    const { user } = mount({ prefs: prefsWith('RB-1'), shipment: null, request: async (o) => { calls.push(o); return {}; } });
    expect(await screen.findByText('송장 정보를 잃었어요. 송장을 다시 스캔해 주세요.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(calls).toEqual([]);
    expect(screen.getByText('출고작업으로')).toBeInTheDocument();
  });

  it('확정 거절이면 문구를 보이고 줄은 그대로다', async () => {
    const { user } = mount({
      prefs: prefsWith('RB-1'),
      request: async () => { throw new ConflictError('m', 'REMOVAL_NOT_PENDING'); },
    });
    await user.click(await screen.findByRole('button', { name: '스캔:880' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이 상품은 이 박스에서 뺄 게 없어요.');
    expect(screen.getByText('[A-01] 볼펜')).toBeInTheDocument();
  });

  it('일부만 뺀 응답이면 줄을 응답대로 고치고 계속 받는다', async () => {
    const { user } = mount({
      prefs: prefsWith('RB-1'),
      request: async () => ({
        removedQty: 1, exited: false, exitTo: 'draft',
        removals: [{ ...shipment.removals[0], skuName: '지우개', boxQty: 3, cartQty: 0 }],
      }),
    });
    await user.click(await screen.findByRole('button', { name: '스캔:880' }));
    expect(await screen.findByText('[A-01] 지우개')).toBeInTheDocument();
    expect(screen.queryByText('[A-01] 볼펜')).not.toBeInTheDocument();
    expect(screen.getByText('3개')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('바구니 바코드를 찍으면 보내지 않고 안내한다', async () => {
    const calls: unknown[] = [];
    const { user } = mount({ prefs: prefsWith('RB-1'), request: async (o) => { calls.push(o); return {}; } });
    await user.click(await screen.findByRole('button', { name: '스캔:RB-9' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('바구니 바코드예요');
    expect(calls).toEqual([]);
  });

  it('카트 몫만 남았으면 박스 스캔을 받지 않고 분류대로 안내한다', async () => {
    const calls: unknown[] = [];
    const { user } = mount({
      prefs: prefsWith('RB-1'),
      shipment: { ...shipment, removals: [{ ...shipment.removals[0], boxQty: 0, cartQty: 2 }] },
      request: async (o) => { calls.push(o); return {}; },
    });
    expect(await screen.findByRole('status')).toHaveTextContent('분류대');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(calls).toEqual([]);
  });

  it('결과를 모르는 실패 뒤에는 새 스캔을 받지 않고, 처리 내역 확인이 같은 키로 다시 보낸다', async () => {
    const calls: Array<{ idempotencyKey: string }> = [];
    let fail = true;
    const { user } = mount({
      prefs: prefsWith('RB-1'),
      request: async (o) => {
        calls.push(o as { idempotencyKey: string });
        if (fail) { fail = false; throw new Error('network'); }
        return { removedQty: 1, exited: false, exitTo: 'draft', removals: shipment.removals };
      },
    });
    await user.click(await screen.findByRole('button', { name: '스캔:880' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('같은 상품을 다시 찍지 말고');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(calls).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '처리 내역 확인' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].idempotencyKey).toBe(calls[0].idempotencyKey);
    await waitFor(() => expect(screen.queryByRole('button', { name: '처리 내역 확인' })).not.toBeInTheDocument());
    // 거절된 스캔이 큐에 쌓였다가 재시도 뒤에 흘러나오지 않았음을 확인한다.
    expect(calls).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[2].idempotencyKey).not.toBe(calls[0].idempotencyKey);
  });

  it('뺄 상품을 [로케이션] 상품명으로 보이고, 스캔하면 바구니로 빼고, 마지막이면 «송장은 버려 주세요»', async () => {
    const calls: unknown[] = [];
    const { user } = mount({
      prefs: prefsWith('RB-1'),
      request: async (o) => {
        calls.push(o);
        return { removedQty: 1, exited: true, exitTo: 'draft', removals: [] };
      },
    });
    expect(await screen.findByText('[A-01] 볼펜')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(await screen.findByRole('status')).toHaveTextContent('다 뺐어요. 이 박스의 송장은 버려 주세요.');
    expect(calls).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/shipments/s-1/return-bin-removals',
        body: { barcode: '880', returnBinBarcode: 'RB-1', quantity: 1 },
      }),
    ]);
  });

  it('다 뺀 뒤의 스캔은 보내지 않고 바구니에 넣지 말라고 알린다', async () => {
    const calls: unknown[] = [];
    const { user } = mount({
      prefs: prefsWith('RB-1'),
      request: async (o) => { calls.push(o); return { removedQty: 1, exited: true, exitTo: 'draft', removals: [] }; },
    });
    await user.click(await screen.findByRole('button', { name: '스캔:880' }));
    await screen.findByText('다 뺐어요. 이 박스의 송장은 버려 주세요.');
    await user.click(screen.getByRole('button', { name: '스캔:880' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 다 뺀 박스예요');
    expect(calls).toHaveLength(1);
  });
});
