import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
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
import type { ApiClient } from '../../core/data/httpClient';
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

function mount(opts: { prefs: DevicePrefs; request: (o: unknown) => Promise<unknown> }) {
  const client: ApiClient = { request: opts.request as unknown as ApiClient['request'] };
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const screenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="880" />
        <WithdrawBoxScreen shipmentId="s-1" shipment={shipment} prefs={opts.prefs} />
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
  it('바구니를 지정하지 않았으면 스캔을 받지 않고 설정으로 안내한다', async () => {
    mount({ prefs: prefsWith(null), request: async () => { throw new Error('should not call'); } });
    expect(await screen.findByRole('alert')).toHaveTextContent('설정에서 이 기기의 되돌림 바구니를 먼저 지정해 주세요.');
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
});
