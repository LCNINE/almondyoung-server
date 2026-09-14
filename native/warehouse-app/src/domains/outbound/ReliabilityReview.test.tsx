import 'fake-indexeddb/auto';
import { createOperationStore } from '../../core/operations/operationStore';
import { createOperationRunner } from '../../core/operations/operationRunner';
import { OperationContext } from '../../core/operations/OperationContext';
import { it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
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
  createMemoryPrefs,
  type DevicePrefs,
} from '../../core/data/devicePrefs';
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { SimpleOutboundScreen } from './SimpleOutboundScreen';
import type { ShipmentByWaybill } from './types';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

let failFirstResponse = false;
const requestKeys: string[] = [];
const shipment: ShipmentByWaybill = {
  shipmentId: 's-1',
  trackingNo: 'T-1',
  carrier: 'HANJIN',
  waybillStatus: 'registered',
  shipmentStatus: 'planned',
  batchId: 'b-1',
  workItemId: 'wi-1',
  workItemStatus: 'queued',
  recipientMasked: '홍길**',
  lines: [
    {
      shipmentLineId: 'ln-1',
      skuId: 'sk-1',
      skuCode: 'CT-001',
      skuName: '코튼셔츠',
      qty: 2,
      pickedQty: 0,
      inspectedQty: 0,
    },
  ],
};

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

function renderScreen(
  responses: Array<{
    status: 'in_progress' | 'shipped';
    pickedQty: number;
    inspectedQty: number;
  }>,
  bodies: Array<{ barcode: string; quantity: number }> = [],
  prefs: DevicePrefs = createMemoryPrefs(),
  shipmentOverride: ShipmentByWaybill = shipment
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  let call = 0;
  const applied = new Map<string, number>();
  const client: ApiClient = {
    request: (async (o: {
      path: string;
      body?: unknown;
      idempotencyKey?: string;
    }) => {
      if (o.path === '/shipments/s-1/simple-outbound-scans') {
        bodies.push(o.body as { barcode: string; quantity: number });
        const index = applied.get(o.idempotencyKey!) ?? applied.size;
        applied.set(o.idempotencyKey!, index);
        const next = responses[Math.min(index, responses.length - 1)];
        call += 1;
        requestKeys.push(o.idempotencyKey ?? '');
        if (failFirstResponse && call === 1)
          throw new TypeError('network response lost after commit');
        return {
          shipmentId: 's-1',
          workItemStatus: next.status === 'shipped' ? 'completed' : 'picking',
          status: next.status,
          dispatchAttemptId: next.status === 'shipped' ? 'att-1' : null,
          lines: [
            {
              shipmentLineId: 'ln-1',
              skuId: 'sk-1',
              qty: 2,
              pickedQty: next.pickedQty,
              inspectedQty: next.inspectedQty,
            },
          ],
        };
      }
      throw new Error(`POST ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const store = createOperationStore(crypto.randomUUID());
  const runtime = {
    store,
    getScope: async () => 'actor|local',
    runner: createOperationRunner({
      api: client,
      store,
      getScope: async () => 'actor|local',
      wait: async () => {},
    }),
  };
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="8801" />
        <SimpleOutboundScreen
          shipmentId="s-1"
          shipment={shipmentOverride}
          prefs={prefs}
        />
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
        <ApiClientProvider client={runtime.runner}>
          <OperationContext.Provider value={runtime}>
            <ScanProvider>{children}</ScanProvider>
          </OperationContext.Provider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

it('REVIEW: retry after lost response must reuse the operation key', async () => {
  failFirstResponse = true;
  requestKeys.length = 0;
  const bodies: Array<{ barcode: string; quantity: number }> = [];
  renderScreen(
    [
      { status: 'in_progress', pickedQty: 1, inspectedQty: 0 },
      { status: 'shipped', pickedQty: 2, inspectedQty: 2 },
    ],
    bodies
  );
  const user = userEvent.setup();
  await screen.findByText('단순출고');
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await screen.findByText('1 / 2');
  expect(requestKeys).toHaveLength(2);
  expect(requestKeys[1]).toBe(requestKeys[0]);
  await user.click(screen.getByRole('button', { name: '스캔:8801' }));
  await screen.findByText('출고완료');
  expect(requestKeys).toHaveLength(3);
  expect(requestKeys[2]).not.toBe(requestKeys[0]);
});
