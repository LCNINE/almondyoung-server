import { describe, it, expect } from 'vitest';
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
  const client: ApiClient = {
    request: (async (o: { path: string; body?: unknown }) => {
      if (o.path === '/shipments/s-1/simple-outbound-scans') {
        bodies.push(o.body as { barcode: string; quantity: number });
        const next = responses[Math.min(call, responses.length - 1)];
        call += 1;
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
        <ApiClientProvider client={client}>
          <ScanProvider>{children}</ScanProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
  render(<RouterProvider router={router} />, { wrapper });
}

describe('SimpleOutboundScreen', () => {
  it('라인 진행을 0/2 로 시작한다', async () => {
    renderScreen([{ status: 'in_progress', pickedQty: 1, inspectedQty: 0 }]);
    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(await screen.findByText('0 / 2')).toBeInTheDocument();
  });

  // 리뷰 지적 2: 박스를 내려놨다가 다시 스캔하는 재개 흐름 — 절반만 스캔된 라인은
  // inspectedQty 가 아직 0 이라도(전량 스캔 전까지 검수는 진행되지 않는다) 서버가
  // 돌려준 pickedQty 로 진행이 시작돼야 한다. 이게 없으면 매번 0/N 부터 다시 세어
  // 재스캔이 과다스캔(409)으로 튕긴다.
  it('절반만 스캔된 라인은 서버가 돌려준 pickedQty 로 시작한다', async () => {
    const partiallyPicked: ShipmentByWaybill = {
      ...shipment,
      lines: [{ ...shipment.lines[0], pickedQty: 1 }],
    };
    renderScreen([], [], createMemoryPrefs(), partiallyPicked);

    expect(await screen.findByText('코튼셔츠')).toBeInTheDocument();
    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('스캔하면 서버 응답의 진행으로 갱신한다', async () => {
    const user = userEvent.setup();
    renderScreen([{ status: 'in_progress', pickedQty: 1, inspectedQty: 0 }]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByText('1 / 2')).toBeInTheDocument();
  });

  it('전량 스캔되면 출고완료와 다음 송장 버튼을 띄운다', async () => {
    const user = userEvent.setup();
    renderScreen([
      { status: 'in_progress', pickedQty: 1, inspectedQty: 0 },
      { status: 'shipped', pickedQty: 2, inspectedQty: 2 },
    ]);
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('1 / 2');
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(await screen.findByText('출고완료')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: '다음 송장 스캔' })
    ).toBeInTheDocument();
  });

  it('출고완료되면 기기에 남은 복구용 박스 정보를 지운다', async () => {
    const user = userEvent.setup();
    const prefs = createMemoryPrefs({
      'almondwms.outbound.lastBox': JSON.stringify(shipment),
    });
    renderScreen(
      [
        { status: 'in_progress', pickedQty: 1, inspectedQty: 0 },
        { status: 'shipped', pickedQty: 2, inspectedQty: 2 },
      ],
      undefined,
      prefs
    );
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('1 / 2');
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    await screen.findByText('출고완료');
    expect(prefs.get('almondwms.outbound.lastBox')).toBeNull();
  });

  it('수량을 지정하고 스캔하면 그 수량으로 올린다', async () => {
    const user = userEvent.setup();
    const bodies: Array<{ barcode: string; quantity: number }> = [];
    renderScreen(
      [{ status: 'shipped', pickedQty: 2, inspectedQty: 2 }],
      bodies
    );
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '수량 지정' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(bodies).toEqual([{ barcode: '8801', quantity: 2 }]);
  });

  it('스캔 후 수량은 1로 돌아간다 — 다음 상품에 옛 수량이 새면 안 된다', async () => {
    const user = userEvent.setup();
    const bodies: Array<{ barcode: string; quantity: number }> = [];
    renderScreen(
      [
        { status: 'in_progress', pickedQty: 2, inspectedQty: 0 },
        { status: 'in_progress', pickedQty: 3, inspectedQty: 0 },
      ],
      bodies
    );
    await screen.findByText('코튼셔츠');

    await user.click(screen.getByRole('button', { name: '수량 지정' }));
    await user.click(screen.getByRole('button', { name: '2' }));
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));
    await screen.findByText('2 / 2');
    await user.click(screen.getByRole('button', { name: '스캔:8801' }));

    expect(bodies).toEqual([
      { barcode: '8801', quantity: 2 },
      { barcode: '8801', quantity: 1 },
    ]);
  });
});
