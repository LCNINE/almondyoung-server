/**
 * @jest-environment jsdom
 */
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PermissionedAction } from '@/lib/auth/mutation-permission';
import type {
  ConsolidationProgressResponse,
  ConsolidationProgressSource,
  FulfillmentOrderDetail,
  ShipmentAdminDetail,
  ShipmentAdminSummary,
} from '@/lib/types/dto/fulfillment';
import { ShipmentTab } from './shipment-tab';

type QueryState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
};

const mockShipments = jest.fn<QueryState<ShipmentAdminSummary[]>, [string]>();
const mockDetail = jest.fn<QueryState<ShipmentAdminDetail>, [string]>();
type ProgressState = {
  data: ConsolidationProgressResponse | null | undefined;
  isSuccess: boolean;
  isError: boolean;
};

const mockProgress = jest.fn<ProgressState, [string]>();
const mockGranted = new Set<string>();

function mockMutation() {
  return { mutateAsync: jest.fn(), isPending: false };
}

jest.mock('@/lib/services/orders/queries', () => ({
  useConsolidationProgress: (shipmentId: string) => mockProgress(shipmentId),
  useConsolidationProgresses: (ids: string[]) =>
    ids.map((id) => mockProgress(id).data),
  useOutboundBatchV2: () => ({
    data: { name: '정중식 테스트 v2', batchNumber: 'B-001' },
  }),
}));

// 배럴 전체를 끌어오지 않도록 배송 탭·진행 패널·운송장 액션이 쓰는 것만 둔다.
jest.mock('@/lib/services/orders', () => ({
  getServerDenyMessage: () => '거절됐어요',
  isRecoverableOperation: () => false,
  useFulfillmentShipments: (id: string) => mockShipments(id),
  useShipmentDetail: (id: string) => mockDetail(id),
  createIdempotentCommand: () => ({ idempotencyKey: 'key-1' }),
  isWaybillIssued: () => true,
  isWaybillPendingIssue: () => false,
  isCarrierSupported: () => true,
  WAYBILL_CARRIERS: ['HANJIN'],
  useIssueWaybill: Object.assign(() => mockMutation(), {
    permission: ['fulfillment.warehouse.operate'],
  }),
  useRegisterManualWaybill: Object.assign(() => mockMutation(), {
    permission: ['fulfillment.warehouse.operate'],
  }),
  useReissueWaybill: Object.assign(() => mockMutation(), {
    permission: ['fulfillment.warehouse.operate'],
  }),
  useVoidWaybill: Object.assign(() => mockMutation(), {
    permission: ['fulfillment.shipment.reopen'],
  }),
  useAbandonWaybill: Object.assign(() => mockMutation(), {
    permission: ['fulfillment.warehouse.operate'],
  }),
  useExcludeShipmentFromBatch: Object.assign(() => mockMutation(), {
    permission: ['fulfillment.warehouse.operate'],
  }),
}));

jest.mock('@/lib/services/inventory/queries', () => ({
  useSuppliers: () => ({ data: undefined }),
}));

jest.mock('./channel-dispatch-query', () => ({
  useChannelDispatchViewModel: () => null,
}));

jest.mock('./channel-dispatch-status', () => ({
  ChannelDispatchAlerts: () => null,
  ChannelDispatchAttemptStatus: () => null,
}));

jest.mock('./shipment-actions', () => ({
  ShipmentActions: () => null,
}));

jest.mock('@/hooks/use-permission', () => {
  const { requirementMet } = jest.requireActual<
    typeof import('@/lib/auth/mutation-permission')
  >('@/lib/auth/mutation-permission');

  return {
    usePermissionCheck: () => ({
      can: () => true,
      isPermissionLoading: false,
      canRun: (...actions: PermissionedAction[]) =>
        actions.every((action) =>
          requirementMet(mockGranted, action.permission)
        ),
      blockedReason: () => null,
    }),
  };
});

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

// 멱등키를 만드는 crypto.randomUUID 가 jest 의 jsdom(20) 에는 없다.
Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: randomUUID,
  configurable: true,
});

const fo: FulfillmentOrderDetail = {
  id: 'fo-1',
  salesOrderId: null,
  warehouseId: 'wh-1',
  ownerId: null,
  status: 'ready',
  batchId: null,
  fulfillmentMode: 'in_house',
  priority: 'normal',
  totalItems: 1,
  totalQty: 1,
  totalReservedQty: 1,
  reservationFailureReason: null,
  allocatedAt: null,
  shippedAt: null,
  canceledAt: null,
  labelNo: null,
  createdAt: '2026-10-29T00:00:00Z',
  updatedAt: '2026-10-29T00:00:00Z',
  items: [],
  reservations: [],
  blockedReasons: [],
};

const summary = (id: string, status: string): ShipmentAdminSummary => ({
  id,
  status,
  warehouseId: 'wh-1',
  supplierId: null,
  manifestVersion: 1,
  reservationVersion: 1,
  totalQty: 1,
  reservedQty: 1,
  inspectedQty: 0,
  recoveryCode: null,
});

const detail = (id: string, status: string): ShipmentAdminDetail => ({
  id,
  status,
  warehouseId: 'wh-1',
  supplierId: null,
  manifestVersion: 1,
  reservationVersion: 1,
  recipientSnapshot: null,
  lines: [],
  waybills: [
    {
      id: `wb-${id}`,
      status: 'registered',
      trackingNo: '4567-8901-2345',
      carrier: 'HANJIN',
      manifestVersion: 1,
      issuedAt: '2026-10-29T00:00:00Z',
      voidedAt: null,
    },
  ],
  workItems: [],
  dispatchAttempts: [],
  operations: [],
});

const loaded = <T,>(data: T): QueryState<T> => ({
  data,
  isLoading: false,
  isError: false,
  error: null,
});

const source = (shipmentId: string): ConsolidationProgressSource => ({
  shipmentId,
  orderNo: null,
  trackingNo: '4567-8901-2345',
  batchId: 'batch-1',
  workItemStatus: 'picking',
  waybillId: `wb-${shipmentId}`,
  waybillStatus: 'registered',
  blockers: ['ACTIVE_INVOICE', 'ACTIVE_WORK_ITEM'],
  gaveUpAt: null,
  nextCheckAt: null,
});

const isDisabled = (name: string) =>
  screen.getByRole('button', { name }).hasAttribute('disabled');

const expectVoidAndReissueLocked = (reason: string) => {
  expect(isDisabled('무효화')).toBe(true);
  expect(isDisabled('재발급')).toBe(true);
  expect(screen.getByText(reason)).toBeTruthy();
  expect(isDisabled('운송장 발급')).toBe(false);
  expect(isDisabled('수동 등록')).toBe(false);
};

let queryClient: QueryClient;

const renderTab = (initialShipmentId?: string) => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(<ShipmentTab fo={fo} initialShipmentId={initialShipmentId} />, {
    wrapper,
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGranted.clear();
  mockGranted.add('fulfillment.shipment.reopen');
  mockGranted.add('fulfillment.warehouse.operate');
  queryClient = new QueryClient();
  mockProgress.mockReturnValue({
    data: null,
    isSuccess: true,
    isError: false,
  });
});

describe('배송 탭 상자 선택', () => {
  beforeEach(() => {
    mockShipments.mockReturnValue(
      loaded([summary('ship-old', 'superseded'), summary('ship-new', 'draft')])
    );
    mockDetail.mockImplementation((id) =>
      loaded(detail(id, id === 'ship-old' ? 'superseded' : 'draft'))
    );
  });

  it('새 상자 링크로 들어오면 합쳐진 원본이 아니라 새 상자를 연다', () => {
    renderTab('ship-new');

    expect(screen.getByRole('heading', { name: 'ship-new' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'ship-old' })).toBeNull();
    expect(mockDetail).toHaveBeenLastCalledWith('ship-new');
  });

  it('상자를 지정하지 않으면 쓰지 않는 상자가 아니라 열린 상자를 연다', () => {
    renderTab();

    expect(screen.getByRole('heading', { name: 'ship-new' })).toBeTruthy();
    expect(mockDetail).toHaveBeenLastCalledWith('ship-new');
  });

  it('없는 상자를 지정하면 열린 상자를 연다', () => {
    renderTab('ship-gone');

    expect(screen.getByRole('heading', { name: 'ship-new' })).toBeTruthy();
  });

  it('쓰지 않는 상자는 접어 두고 개수만 보인다', async () => {
    renderTab();

    expect(screen.queryByText('ship-old')).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: '쓰지 않는 상자 1개' })
    );

    expect(screen.getByText('ship-old')).toBeTruthy();
  });

  it('쓰지 않는 상자로 들어오면 접힌 목록을 펼쳐 둔다', () => {
    renderTab('ship-old');

    expect(screen.getByRole('heading', { name: 'ship-old' })).toBeTruthy();
    expect(screen.getAllByText('ship-old').length).toBeGreaterThan(0);
  });

  it('목록에는 상자 전체 수량을 그대로 보인다', () => {
    mockShipments.mockReturnValue(
      loaded([{ ...summary('ship-new', 'draft'), totalQty: 5, reservedQty: 5 }])
    );

    renderTab();

    expect(screen.getByText(/draft · 5개 · 예약 5/)).toBeTruthy();
  });
});

describe('합쳐진 새 상자 카드', () => {
  beforeEach(() => {
    mockShipments.mockReturnValue(
      loaded([summary('ship-old', 'superseded'), summary('ship-new', 'draft')])
    );
    mockDetail.mockImplementation((id) =>
      loaded(detail(id, id === 'ship-old' ? 'superseded' : 'draft'))
    );
    mockProgress.mockImplementation((id) => ({
      data:
        id === 'ship-old'
          ? {
              operationId: 'op-1',
              status: 'completed',
              targetShipmentId: 'ship-new',
              sources: [
                { ...source('ship-old'), orderNo: '6275' },
                { ...source('ship-old-2'), orderNo: '6314' },
              ],
            }
          : null,
      isSuccess: true,
      isError: false,
    }));
  });

  it('열린 새 상자 맨 위에 합쳐졌다는 카드와 다음 할 일이 뜬다', () => {
    renderTab();

    expect(
      screen.getByText('#6275와 #6314가 새 상자 하나로 합쳐졌어요')
    ).toBeTruthy();
    expect(screen.getByText('1. 계획 확정')).toBeTruthy();
  });
});

describe('합포장 중 기존 무효화 버튼', () => {
  beforeEach(() => {
    mockShipments.mockReturnValue(loaded([summary('src', 'draft')]));
    mockDetail.mockImplementation((id) => loaded(detail(id, 'draft')));
  });

  it('배치에 든 상자가 합포장 진행 중이면 무효화를 막고 진행 안내로 보낸다', () => {
    mockProgress.mockReturnValue({
      data: {
        operationId: 'op-1',
        status: 'pending',
        targetShipmentId: null,
        sources: [source('src'), source('other')],
      },
      isSuccess: true,
      isError: false,
    });

    renderTab();

    expect(screen.getByRole('button', { name: '배치에서 빼기' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '무효화' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: '재발급' }).hasAttribute('disabled')
    ).toBe(true);
    expect(
      screen.getByText('합포장 진행 중에는 위 진행 안내에서 운송장을 취소해요')
    ).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '운송장 발급' })
        .hasAttribute('disabled')
    ).toBe(false);
  });

  it('합포장이 없으면 무효화를 지금처럼 열 수 있다', async () => {
    renderTab();

    const voidButton = screen.getByRole('button', { name: '무효화' });

    expect(voidButton.hasAttribute('disabled')).toBe(false);
    expect(
      screen.getByRole('button', { name: '재발급' }).hasAttribute('disabled')
    ).toBe(false);
    expect(
      screen.queryByText(
        '합포장 진행 중에는 위 진행 안내에서 운송장을 취소해요'
      )
    ).toBeNull();

    await userEvent.click(voidButton);

    expect(
      await screen.findByRole('heading', { name: '운송장 무효화' })
    ).toBeTruthy();
  });

  it('멈춘 송장은 무효화가 아니라 «중단하고 다시 발급»으로 푼다(#1241)', () => {
    mockDetail.mockImplementation((id) => {
      const base = detail(id, 'planned');
      return loaded({
        ...base,
        waybills: base.waybills.map((w) => ({ ...w, status: 'allocated' })),
      });
    });

    renderTab();

    expect(screen.getByText('송장 발급이 멈춰 있어요')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '중단하고 다시 발급' })
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '무효화' }).hasAttribute('disabled')
    ).toBe(true);
  });

  it('진행 상태를 불러오는 중이면 무효화·재발급을 열지 않는다', () => {
    mockProgress.mockReturnValue({
      data: undefined,
      isSuccess: false,
      isError: false,
    });

    renderTab();

    expectVoidAndReissueLocked('합포장 진행 상태를 확인하는 중이에요');
  });

  it('진행 상태 조회가 실패하면 무효화·재발급을 열지 않는다', () => {
    mockProgress.mockReturnValue({
      data: undefined,
      isSuccess: false,
      isError: true,
    });

    renderTab();

    expectVoidAndReissueLocked(
      '합포장 진행 상태를 확인하지 못했어요. 새로고침해 주세요'
    );
  });
});

describe('합쳐진 뒤 상자 선택', () => {
  const completed = (
    target: string,
    orderNos: string[]
  ): ConsolidationProgressResponse => ({
    operationId: `op-${target}`,
    status: 'completed',
    targetShipmentId: target,
    sources: orderNos.map((orderNo) => ({
      ...source(`src-${orderNo}`),
      orderNo,
    })),
  });

  it('보던 원본 상자가 합쳐지면 새 상자로 옮기고 쓰지 않는 상자 목록을 접는다', () => {
    window.history.replaceState(
      null,
      '',
      '/order/fulfillments/fo-1?shipmentId=ship-a'
    );
    mockShipments.mockReturnValue(loaded([summary('ship-a', 'draft')]));
    mockDetail.mockImplementation((id) => loaded(detail(id, 'draft')));
    mockProgress.mockReturnValue({
      data: null,
      isSuccess: true,
      isError: false,
    });

    const view = renderTab('ship-a');

    expect(screen.getByRole('heading', { name: 'ship-a' })).toBeTruthy();

    mockShipments.mockReturnValue(
      loaded([summary('ship-a', 'superseded'), summary('ship-new', 'draft')])
    );
    mockProgress.mockImplementation((id) => ({
      data: id === 'ship-a' ? completed('ship-new', ['1', '2']) : null,
      isSuccess: true,
      isError: false,
    }));
    view.rerender(<ShipmentTab fo={fo} initialShipmentId="ship-a" />);

    expect(screen.getByRole('heading', { name: 'ship-new' })).toBeTruthy();
    expect(
      screen
        .getByRole('button', { name: '쓰지 않는 상자 1개' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    expect(window.location.search).toBe('?shipmentId=ship-new');
  });

  it('합쳐진 결과 상자가 또 합쳐졌으면 마지막 상자에 완료 카드를 보인다', () => {
    mockShipments.mockReturnValue(
      loaded([
        summary('box-a', 'superseded'),
        summary('box-b', 'superseded'),
        summary('box-c', 'superseded'),
        summary('box-d', 'superseded'),
        summary('box-e', 'draft'),
      ])
    );
    mockDetail.mockImplementation((id) =>
      loaded(detail(id, id === 'box-e' ? 'draft' : 'superseded'))
    );
    mockProgress.mockImplementation((id) => {
      const data =
        id === 'box-a' || id === 'box-b'
          ? completed('box-c', ['10', '20'])
          : id === 'box-c' || id === 'box-d'
            ? completed('box-e', ['6275', '6314'])
            : null;

      return { data, isSuccess: true, isError: false };
    });

    renderTab();

    expect(screen.getByRole('heading', { name: 'box-e' })).toBeTruthy();
    expect(
      screen.getByText('#6275와 #6314가 새 상자 하나로 합쳐졌어요')
    ).toBeTruthy();
  });
});
