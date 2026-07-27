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
  useRouterState,
} from '@tanstack/react-router';
import { SessionProvider } from '../../app/session-context';
import { WarehouseProvider } from '../../app/warehouse-context';
import {
  createMemoryPrefs,
  type DevicePrefs,
} from '../../core/data/devicePrefs';
import { ApiClientProvider } from '../../core/data/ApiClientProvider';
import {
  ScanProvider,
  useScanBus,
} from '../../core/hardware/scan/ScanProvider';
import type { ApiClient } from '../../core/data/httpClient';
import type { Session } from '../../core/auth/session';
import { OutboundQueueScreen } from './OutboundQueueScreen';

const session = {
  bootstrap: async () => {},
  isAuthenticated: () => true,
  getAccessToken: async () => 'tok',
  login: async () => {},
  logout: async () => {},
  subscribe: () => () => {},
} satisfies Session;

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

// workItemStatus 를 함께 보여줘, 이동한 화면이 어떤 조회 결과(저장된 스냅샷 vs 방금 새로
// 받아온 결과)로 열렸는지 테스트에서 구분할 수 있게 한다.
function TargetScreen() {
  const workItemStatus = useRouterState({
    select: (s) =>
      (s.location.state as { shipment?: { workItemStatus?: string | null } })
        .shipment?.workItemStatus,
  });
  return (
    <div>
      <p>단순출고화면</p>
      <p>status:{workItemStatus}</p>
    </div>
  );
}

function renderScreen(
  paths: string[],
  prefs: DevicePrefs = createMemoryPrefs({
    'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
  }),
  batchesByStatus: Record<
    'picking' | 'created',
    Array<{
      id: string;
      batchNumber: string;
      name: string;
      status: string;
      totalItems: number;
      totalQty: number;
    }>
  > = {
    picking: [
      {
        id: 'b-1',
        batchNumber: 'OB-1',
        name: '오전',
        status: 'picking',
        totalItems: 3,
        totalQty: 7,
      },
    ],
    created: [],
  }
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client: ApiClient = {
    request: (async (o: { path: string }) => {
      paths.push(o.path);
      if (o.path.startsWith('/shipments/by-waybill?trackingNo=T-1')) {
        return {
          shipmentId: 's-1',
          trackingNo: 'T-1',
          carrier: 'HANJIN',
          waybillStatus: 'registered',
          shipmentStatus: 'planned',
          batchId: 'b-1',
          workItemId: 'wi-1',
          workItemStatus: 'queued',
          recipientMasked: '홍길**',
          lines: [],
        };
      }
      if (o.path.startsWith('/shipments/by-waybill?trackingNo=T-NOWORKITEM')) {
        return {
          shipmentId: 's-2',
          trackingNo: 'T-NOWORKITEM',
          carrier: 'HANJIN',
          waybillStatus: 'registered',
          shipmentStatus: 'planned',
          batchId: null,
          workItemId: null,
          workItemStatus: null,
          recipientMasked: '홍길**',
          lines: [],
        };
      }
      if (o.path.startsWith('/shipments/by-waybill?trackingNo=T-SHIPPED')) {
        return {
          shipmentId: 's-3',
          trackingNo: 'T-SHIPPED',
          carrier: 'HANJIN',
          waybillStatus: 'used',
          shipmentStatus: 'shipped',
          batchId: 'b-1',
          workItemId: 'wi-3',
          workItemStatus: 'completed',
          recipientMasked: '홍길**',
          lines: [],
        };
      }
      if (o.path.startsWith('/shipments/by-waybill'))
        throw new Error(`GET ${o.path} → 404`);
      if (o.path.startsWith('/outbound-batches/v2')) {
        const [, qs] = o.path.split('?');
        const status = new URLSearchParams(qs ?? '').get('status');
        return status === 'picking' || status === 'created'
          ? batchesByStatus[status]
          : [];
      }
      throw new Error(`GET ${o.path} → 404`);
    }) as unknown as ApiClient['request'],
  };
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <>
        <ScanButton code="T-1" />
        <ScanButton code="T-404" />
        <ScanButton code="T-NOWORKITEM" />
        <ScanButton code="T-SHIPPED" />
        <OutboundQueueScreen prefs={prefs} />
      </>
    ),
  });
  const targetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/outbound/simple/$shipmentId',
    component: TargetScreen,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, targetRoute]),
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

describe('OutboundQueueScreen', () => {
  it('송장을 스캔하면 단순출고 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('출고작업');

    await user.click(screen.getByRole('button', { name: '스캔:T-1' }));

    expect(await screen.findByText('단순출고화면')).toBeInTheDocument();
  });

  it('없는 운송장은 안내를 띄우고 이동하지 않는다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('출고작업');

    await user.click(screen.getByRole('button', { name: '스캔:T-404' }));

    expect(
      await screen.findByText(
        '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
  });

  it('오늘 배치 요약을 보여준다', async () => {
    renderScreen([]);
    expect(await screen.findByText('OB-1')).toBeInTheDocument();
    expect(await screen.findByText('3박스 · 7개')).toBeInTheDocument();
  });

  it('아직 시작 안 한(created) 배치도 진행 중 배치 다음에 보여준다', async () => {
    renderScreen([], undefined, {
      picking: [
        {
          id: 'b-1',
          batchNumber: 'OB-1',
          name: '오전',
          status: 'picking',
          totalItems: 3,
          totalQty: 7,
        },
      ],
      created: [
        {
          id: 'b-2',
          batchNumber: 'OB-2',
          name: '오후',
          status: 'created',
          totalItems: 2,
          totalQty: 5,
        },
      ],
    });

    expect(await screen.findByText('OB-1')).toBeInTheDocument();
    expect(await screen.findByText('OB-2')).toBeInTheDocument();
    const items = await screen.findAllByRole('listitem');
    const labels = items.map((li) => li.textContent);
    expect(labels[0]).toContain('OB-1');
    expect(labels[1]).toContain('OB-2');
  });

  it('같은 배치가 picking·created 양쪽에서 오면 한 번만 보여준다', async () => {
    renderScreen([], undefined, {
      picking: [
        {
          id: 'b-1',
          batchNumber: 'OB-1',
          name: '오전',
          status: 'picking',
          totalItems: 3,
          totalQty: 7,
        },
      ],
      created: [
        {
          id: 'b-1',
          batchNumber: 'OB-1',
          name: '오전',
          status: 'created',
          totalItems: 3,
          totalQty: 7,
        },
      ],
    });

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(1);
  });

  it('직전 작업이 있으면 복구 카드를 띄운다', async () => {
    renderScreen(
      [],
      createMemoryPrefs({
        'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
        'almondwms.outbound.lastBox': JSON.stringify({
          shipmentId: 's-1',
          trackingNo: 'T-1',
          carrier: 'HANJIN',
          waybillStatus: 'registered',
          shipmentStatus: 'planned',
          batchId: 'b-1',
          workItemId: 'wi-1',
          workItemStatus: 'picking',
          recipientMasked: '홍길**',
          lines: [],
        }),
      })
    );

    expect(await screen.findByText('하던 작업 이어서')).toBeInTheDocument();
    expect(await screen.findByText('HANJIN T-1')).toBeInTheDocument();
  });

  // 리뷰 지적 2: 복구 카드는 기기에 저장된 스냅샷을 그대로 재생하면 안 된다 — 그 사이
  // 다른 작업자가 박스를 더 스캔했을 수 있다. 저장된 스냅샷은 workItemStatus='picking'
  // 이지만, 실시간 조회(T-1)는 'queued' 를 돌려준다 — 화면은 재조회 결과로 이동해야 한다.
  it('복구 카드를 누르면 저장된 스냅샷이 아니라 방금 조회한 결과로 이동한다', async () => {
    const user = userEvent.setup();
    renderScreen(
      [],
      createMemoryPrefs({
        'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
        'almondwms.outbound.lastBox': JSON.stringify({
          shipmentId: 's-1',
          trackingNo: 'T-1',
          carrier: 'HANJIN',
          waybillStatus: 'registered',
          shipmentStatus: 'planned',
          batchId: 'b-1',
          workItemId: 'wi-1',
          workItemStatus: 'picking',
          recipientMasked: '홍길**',
          lines: [],
        }),
      })
    );
    await screen.findByText('하던 작업 이어서');

    await user.click(screen.getByRole('button', { name: '이어서 작업' }));

    expect(await screen.findByText('단순출고화면')).toBeInTheDocument();
    expect(await screen.findByText('status:queued')).toBeInTheDocument();
  });

  it('복구 카드 재조회가 실패하면 일반 스캔과 같은 에러 안내를 띄우고 그대로 남는다', async () => {
    const user = userEvent.setup();
    renderScreen(
      [],
      createMemoryPrefs({
        'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
        'almondwms.outbound.lastBox': JSON.stringify({
          shipmentId: 's-404',
          trackingNo: 'T-404',
          carrier: 'HANJIN',
          waybillStatus: 'registered',
          shipmentStatus: 'planned',
          batchId: 'b-1',
          workItemId: 'wi-1',
          workItemStatus: 'queued',
          recipientMasked: '홍길**',
          lines: [],
        }),
      })
    );
    await screen.findByText('하던 작업 이어서');

    await user.click(screen.getByRole('button', { name: '이어서 작업' }));

    expect(
      await screen.findByText(
        '이 운송장을 찾을 수 없어요. 번호를 확인해 주세요.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
  });

  // 리뷰 지적 4: 조회 결과가 "오늘 배치에 없음"·"이미 출고됨" 을 나타내면 스캔 한 번에
  // 넘어가지 않고 큐 화면에 남아 안내를 준다 — 첫 상품 스캔에서야 발견하게 두지 않는다.
  it('workItemId 가 없으면 안내를 띄우고 이동하지 않는다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('출고작업');

    await user.click(screen.getByRole('button', { name: '스캔:T-NOWORKITEM' }));

    expect(
      await screen.findByText(
        '이 송장은 오늘 배치에 없어요 — 관리자에게 문의해 주세요'
      )
    ).toBeInTheDocument();
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
  });

  it('이미 출고된 송장이면 안내를 띄우고 이동하지 않는다', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    await screen.findByText('출고작업');

    await user.click(screen.getByRole('button', { name: '스캔:T-SHIPPED' }));

    expect(
      await screen.findByText('이미 출고된 송장이에요')
    ).toBeInTheDocument();
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
  });
});
