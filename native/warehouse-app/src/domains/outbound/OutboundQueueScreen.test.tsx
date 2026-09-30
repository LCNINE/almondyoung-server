import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, within } from '@testing-library/react';
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
import {
  LABEL_PRINTER_KEY,
  type PrintRaw,
} from '../../core/hardware/print/labelPrinter';
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

type CapturedRequest = { method: string; path: string };

function renderScreen(
  requests: CapturedRequest[],
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
      startedAt: string | null;
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
        startedAt: '2026-09-30T00:00:00.000Z',
      },
    ],
    created: [],
  },
  foundWarehouse = 'w-1',
  labelPrinting = false,
  labelDeps: {
    label?: () => Promise<unknown>;
    print?: PrintRaw;
    labelState?: string | null;
    labelChanges?: unknown[];
    labelIssue?: string | null;
  } = {}
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const client: ApiClient = {
    request: (async (o: { method?: string; path: string }) => {
      requests.push({ method: o.method ?? 'GET', path: o.path });
      if (o.path === '/inventory/work-context')
        return { capabilities: { locationOutbound: true } };
      if (o.path.startsWith('/shipments/by-waybill?trackingNo=T-1')) {
        return {
          warehouseId: foundWarehouse,
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
          labelState: labelDeps.labelState ?? 'current',
          labelChanges: labelDeps.labelChanges ?? [],
          labelIssue: labelDeps.labelIssue ?? null,
        };
      }
      if (o.path.startsWith('/shipments/by-waybill?trackingNo=T-NOWORKITEM')) {
        return {
          warehouseId: foundWarehouse,
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
          warehouseId: foundWarehouse,
          shipmentId: 's-3',
          trackingNo: 'T-SHIPPED',
          carrier: 'HANJIN',
          waybillStatus: 'used',
          shipmentStatus: 'shipped',
          batchId: 'b-1',
          workItemId: null,
          workItemStatus: null,
          recipientMasked: '홍길**',
          lines: [],
        };
      }
      if (o.path.startsWith('/shipments/by-waybill'))
        throw new Error(`GET ${o.path} → 404`);
      const workItems = /^\/outbound-batches\/([^/]+)\/work-items$/.exec(
        o.path
      );
      if (workItems)
        return [
          { id: `wi-${workItems[1]}`, shipmentId: 's-1', status: 'queued' },
        ];
      if (o.path === '/shipments/s-1/waybill/label') {
        return labelDeps.label
          ? labelDeps.label()
          : { waybillId: 'w', trackingNo: 'T-1', format: 'zpl', data: '^XA^XZ', pages: 1, fingerprint: 'f'.repeat(64), revision: 1 };
      }
      if (o.path === '/shipments/s-1/waybill/label-prints') return undefined;
      if (/^\/outbound-batches\/[^/]+\/waybill-label-states$/.test(o.path)) return [];
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
        <OutboundQueueScreen
          prefs={prefs}
          labelPrinting={labelPrinting}
          print={labelDeps.print}
        />
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
  it('시작된 배치 카드에만 「박스 넣기」가 보인다', async () => {
    renderScreen([], undefined, {
      picking: [
        { id: 'b-1', batchNumber: 'OB-1', name: '오전', status: 'picking', totalItems: 3, totalQty: 7, startedAt: '2026-09-30T00:00:00.000Z' },
      ],
      created: [
        { id: 'b-2', batchNumber: 'OB-2', name: '오후', status: 'created', totalItems: 2, totalQty: 5, startedAt: null },
      ],
    });
    await screen.findByText('OB-2');
    expect(screen.getAllByRole('button', { name: '박스 넣기' })).toHaveLength(1);
  });

  it('박스 넣기 패널이 열려 있는 동안 스캔은 박스 열기로 가지 않는다', async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    renderScreen(requests);
    await user.click(await screen.findByRole('button', { name: '박스 넣기' }));
    await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(requests.some((r) => r.path.startsWith('/shipments/by-waybill'))).toBe(false);
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
  });

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
          startedAt: '2026-09-30T00:00:00.000Z',
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
          startedAt: null,
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
          startedAt: '2026-09-30T00:00:00.000Z',
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
          startedAt: null,
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
    const requests: CapturedRequest[] = [];
    renderScreen(requests);
    await screen.findByText('출고작업');

    await user.click(screen.getByRole('button', { name: '스캔:T-SHIPPED' }));

    expect(
      await screen.findByText('이미 출고된 송장이에요')
    ).toBeInTheDocument();
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
    expect(requests.filter(({ method }) => method === 'POST')).toHaveLength(0);
  });

  it('labelPrinting 이면 배치 행마다 라벨 인쇄 버튼이 있다', async () => {
    const requests: CapturedRequest[] = [];
    renderScreen(requests, undefined, undefined, 'w-1', true);
    await screen.findByText('OB-1');
    expect(screen.getByRole('button', { name: '송장 인쇄' })).toBeInTheDocument();
  });

  it('시작 전 배치에는 「작업 시작」만 있고 송장 인쇄는 없다(station 이어도)', async () => {
    renderScreen(
      [],
      undefined,
      {
        picking: [],
        created: [
          {
            id: 'b-2',
            batchNumber: 'OB-2',
            name: '오후',
            status: 'created',
            totalItems: 1,
            totalQty: 1,
            startedAt: null,
          },
        ],
      },
      'w-1',
      true
    );
    await screen.findByText('OB-2');
    expect(screen.getByRole('button', { name: '작업 시작' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '송장 인쇄' })).toBeNull();
  });

  it('시작된 배치에는 「작업 시작」이 없고 station 이면 송장 인쇄가 있다', async () => {
    renderScreen([], undefined, undefined, 'w-1', true);
    await screen.findByText('OB-1');
    expect(screen.queryByRole('button', { name: '작업 시작' })).toBeNull();
    expect(screen.getByRole('button', { name: '송장 인쇄' })).toBeInTheDocument();
  });

  it('기본(핸드헬드)에서는 라벨 인쇄 버튼이 없다', async () => {
    const requests: CapturedRequest[] = [];
    renderScreen(requests);
    await screen.findByText('OB-1');
    expect(screen.queryByRole('button', { name: '송장 인쇄' })).toBeNull();
  });

  // 인쇄 중엔 useUnsavedWork 가 라우터를 막는다 — 그때 스캔이 navigate 까지 가면 그 promise 가
  // 끝나지 않아 이후 스캔이 전부 무시된다(스캐너가 조용히 죽는다).
  it('라벨 인쇄 중 스캔은 안내만 하고, 인쇄가 끝나면 다시 박스를 연다', async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    let release: (v: unknown) => void = () => {};
    renderScreen(
      requests,
      createMemoryPrefs({
        'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
        [LABEL_PRINTER_KEY]: 'spooler://XP',
      }),
      undefined,
      'w-1',
      true,
      {
        label: () => new Promise((resolve) => (release = resolve)),
        print: async () => {},
      }
    );
    await user.click(await screen.findByRole('button', { name: '송장 인쇄' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '인쇄',
      })
    );
    await screen.findByRole('button', { name: '인쇄 중 0/1' });

    await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
    expect(
      await screen.findByText('송장 인쇄가 끝난 뒤 스캔해 주세요.')
    ).toBeInTheDocument();
    expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
    expect(
      requests.filter(({ path }) => path.startsWith('/shipments/by-waybill'))
    ).toHaveLength(0);

    release({ waybillId: 'w', trackingNo: 'T-1', format: 'zpl', data: '^XA^XZ', pages: 1, fingerprint: 'f'.repeat(64), revision: 1 });
    expect(await screen.findByRole('status')).toHaveTextContent('보냄 1');

    await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
    expect(await screen.findByText('단순출고화면')).toBeInTheDocument();
  });

  describe('송장 상태(labelState)로 화면을 가른다', () => {
    const stationPrefs = () =>
      createMemoryPrefs({
        'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
        [LABEL_PRINTER_KEY]: 'spooler://XP',
      });

    it('station 에서 never_printed 송장을 스캔하면 작업 화면으로 가지 않고 출력 패널을 보인다', async () => {
      const user = userEvent.setup();
      renderScreen([], stationPrefs(), undefined, 'w-1', true, {
        labelState: 'never_printed',
        print: async () => {},
      });
      await screen.findByText('OB-1');
      await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
      expect(
        await screen.findByText(
          '송장을 아직 출력하지 않았어요. 출력한 뒤 송장을 다시 스캔해 주세요.'
        )
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: '송장 재출력' })
      ).toBeInTheDocument();
      expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
    });

    it('비station 에서 reprint_required 면 안내만 하고 출력 버튼은 없다', async () => {
      const user = userEvent.setup();
      renderScreen([], undefined, undefined, 'w-1', false, {
        labelState: 'reprint_required',
      });
      await screen.findByText('OB-1');
      await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
      expect(
        await screen.findByText(
          '송장이 바뀌었어요. 프린터 있는 자리에서 새 송장을 출력해 주세요.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '송장 재출력' })).toBeNull();
      expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
    });

    it('station 의 reprint_required 는 바뀐 줄을 보여 준다', async () => {
      const user = userEvent.setup();
      renderScreen([], stationPrefs(), undefined, 'w-1', true, {
        labelState: 'reprint_required',
        labelChanges: [
          { locationCode: 'A-01', skuId: 's', name: '볼펜', printedQty: 1, currentQty: 2 },
        ],
        print: async () => {},
      });
      await screen.findByText('OB-1');
      await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
      expect(await screen.findByText('[A-01] 볼펜 1개 → 2개')).toBeInTheDocument();
    });

    it('not_started 면 작업 시작 안내', async () => {
      const user = userEvent.setup();
      renderScreen([], undefined, undefined, 'w-1', false, {
        labelState: 'not_started',
      });
      await screen.findByText('OB-1');
      await user.click(screen.getByRole('button', { name: '스캔:T-1' }));
      expect(
        await screen.findByText('배치 화면에서 「작업 시작」을 먼저 눌러 주세요.')
      ).toBeInTheDocument();
      expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
    });
  });

  // 프린터는 한 대다 — 두 배치가 동시에 돌면 라벨이 한 줄로 섞여 나온다.
  it('한 배치를 인쇄하는 동안 다른 배치의 라벨 인쇄는 막힌다', async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    renderScreen(
      [],
      createMemoryPrefs({
        'almondwms.warehouse': JSON.stringify({ id: 'w-1', name: '한국창고' }),
        [LABEL_PRINTER_KEY]: 'spooler://XP',
      }),
      {
        picking: [
          {
            id: 'b-1',
            batchNumber: 'OB-1',
            name: '오전',
            status: 'picking',
            totalItems: 1,
            totalQty: 1,
            startedAt: '2026-09-30T00:00:00.000Z',
          },
        ],
        created: [
          {
            id: 'b-2',
            batchNumber: 'OB-2',
            name: '오후',
            status: 'created',
            totalItems: 1,
            totalQty: 1,
            startedAt: '2026-09-30T00:00:00.000Z',
          },
        ],
      },
      'w-1',
      true,
      {
        label: () => new Promise((resolve) => (release = resolve)),
        print: async () => {},
      }
    );
    await screen.findByText('OB-2');
    const [first, second] = screen.getAllByRole('button', { name: '송장 인쇄' });
    await user.click(first);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: '인쇄',
      })
    );
    await screen.findByRole('button', { name: '인쇄 중 0/1' });
    expect(second).toBeDisabled();

    release({ waybillId: 'w', trackingNo: 'T-1', format: 'zpl', data: '^XA^XZ', pages: 1, fingerprint: 'f'.repeat(64), revision: 1 });
    await screen.findByRole('status');
    expect(second).toBeEnabled();
  });
});

it('다른 창고의 송장은 화면 진입 전에 거절한다', async () => {
  const requests: CapturedRequest[] = [];
  renderScreen(requests, undefined, undefined, 'other');
  await userEvent.type(
    await screen.findByLabelText('운송장번호'),
    'T-1{Enter}'
  );
  expect(await screen.findByRole('alert')).toHaveTextContent('창고');
  expect(screen.queryByText('단순출고화면')).not.toBeInTheDocument();
});
