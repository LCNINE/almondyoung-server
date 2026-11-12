/**
 * @jest-environment jsdom
 */
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { rememberPending } from './shipment-action-pending';
import type { PermissionedAction } from '@/lib/auth/mutation-permission';
import type {
  ConsolidationProgressResponse,
  ConsolidationProgressSource,
  FulfillmentOrderDetail,
  ShipmentAdminDetail,
  ShipmentAdminSummary,
} from '@/lib/types/dto/fulfillment';
import { FULFILLMENT_SYSTEM_ACTOR_ID } from './operation-reasons';
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

let mockCanReadProfile = true;
const mockUsersLookup = jest.fn();

jest.mock('@/lib/services/users/queries', () => ({
  useAdminUsersByIds: (ids: string[], options: { enabled?: boolean }) => {
    mockUsersLookup(ids, options);
    return {
      data: options.enabled
        ? { data: [{ id: 'user-1', username: '김관리', loginId: 'kim' }] }
        : undefined,
    };
  },
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
    useCan: () => ({ status: 'ready', allowed: mockCanReadProfile }),
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
  mockCanReadProfile = true;
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

    expect(screen.getByRole('heading', { name: '상자 ship-new' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '상자 ship-old' })).toBeNull();
    expect(mockDetail).toHaveBeenLastCalledWith('ship-new');
  });

  it('상자를 지정하지 않으면 쓰지 않는 상자가 아니라 열린 상자를 연다', () => {
    renderTab();

    expect(screen.getByRole('heading', { name: '상자 ship-new' })).toBeTruthy();
    expect(mockDetail).toHaveBeenLastCalledWith('ship-new');
  });

  it('없는 상자를 지정하면 열린 상자를 연다', () => {
    renderTab('ship-gone');

    expect(screen.getByRole('heading', { name: '상자 ship-new' })).toBeTruthy();
  });

  it('쓰지 않는 상자는 접어 두고 개수만 보인다', async () => {
    renderTab();

    expect(screen.queryByText('상자 ship-old')).toBeNull();

    await userEvent.click(
      screen.getByRole('button', { name: '쓰지 않는 상자 1개' })
    );

    expect(screen.getByText('상자 ship-old')).toBeTruthy();
  });

  it('쓰지 않는 상자로 들어오면 접힌 목록을 펼쳐 둔다', () => {
    renderTab('ship-old');

    expect(screen.getByRole('heading', { name: '상자 ship-old' })).toBeTruthy();
    expect(screen.getAllByText('상자 ship-old').length).toBeGreaterThan(0);
  });

  it('목록에는 상자 전체 수량을 그대로 보인다', () => {
    mockShipments.mockReturnValue(
      loaded([{ ...summary('ship-new', 'draft'), totalQty: 5, reservedQty: 5 }])
    );

    renderTab();

    expect(screen.getByText('계획 전 · 5개')).toBeTruthy();
  });

  it('응답을 받지 못한 요청이 남은 상자는 목록에서 결과 확인이 필요하다고 보인다', () => {
    window.localStorage.clear();
    rememberPending({
      shipmentId: 'ship-new',
      action: 'split',
      idempotencyKey: 'k-1',
      sentAt: Date.now(),
    });

    renderTab();

    expect(
      screen.getByRole('button', { name: /상자 ship-new.*결과 확인 필요/ })
    ).toBeTruthy();
    window.localStorage.clear();
  });
});

describe('상자에 담긴 상품 표', () => {
  const lineOf = (
    id: string,
    qty: number,
    extra: Partial<ShipmentAdminDetail['lines'][number]>
  ): ShipmentAdminDetail['lines'][number] => ({
    id,
    fulfillmentOrderId: 'fo-1',
    fulfillmentOrderItemId: `item-${id}`,
    skuId: `sku-${id}-0000`,
    qty,
    reservedQty: qty,
    inspectedQty: 0,
    lineVersion: 4,
    origin: null,
    reservations: [],
    ...extra,
  });

  const originOf = (channelOrderId: string, displayOrderNo: string | null) => ({
    salesOrderLineId: `sol-${channelOrderId}`,
    salesOrderId: `so-${channelOrderId}`,
    salesChannel: 'medusa',
    channelOrderId,
    displayOrderNo,
    channelOrderItemId: `coi-${channelOrderId}`,
    channelProductId: null,
  });

  beforeEach(() => {
    mockShipments.mockReturnValue(loaded([summary('ship-1', 'draft')]));
    mockDetail.mockReturnValue(
      loaded({
        ...detail('ship-1', 'draft'),
        lines: [
          lineOf('line-aaaa-1111', 1, {
            skuName: '샘플 상품 (빨강)',
            origin: originOf('ch-order-1', 'ORDER-1'),
          }),
          lineOf('line-aaaa-3333', 1, {
            skuId: 'sku-line-aaaa-1111-0000',
            skuName: '샘플 상품 (빨강)',
            origin: originOf('ch-order-2', null),
          }),
          lineOf('line-bbbb-2222', 2, {
            skuName: '샘플 상품 (파랑)',
            origin: originOf('ch-order-2', null),
          }),
        ],
      })
    );
  });

  it('줄마다 상품명과 고객이 아는 주문번호·판매처를 보이고 내부 번호와 버전은 감춘다', () => {
    renderTab();

    const table = screen.getByRole('table');
    expect(
      screen.getByRole('heading', { name: '담긴 상품 2종 · 4개' })
    ).toBeTruthy();
    expect(
      Array.from(table.querySelectorAll('th')).map((cell) => cell.textContent)
    ).toEqual(['상품', '주문', '수량', '재고 확보', '검수']);

    const rows = Array.from(table.querySelectorAll('tbody tr')).map(
      (row) => row.textContent
    );
    expect(rows[0]).toContain('샘플 상품 (빨강)');
    expect(rows[0]).toContain('#ORDER-1');
    expect(rows[0]).toContain('아몬드영 (자사몰)');
    expect(rows[1]).toContain('#ch-order-2');
    expect(rows).toHaveLength(3);
    expect(table.textContent).not.toMatch(/line-aaa|so-ch-order|coi-|v4/);
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

    expect(screen.getByRole('heading', { name: '상자 ship-a' })).toBeTruthy();

    mockShipments.mockReturnValue(
      loaded([summary('ship-a', 'superseded'), summary('ship-new', 'draft')])
    );
    mockProgress.mockImplementation((id) => ({
      data: id === 'ship-a' ? completed('ship-new', ['1', '2']) : null,
      isSuccess: true,
      isError: false,
    }));
    view.rerender(<ShipmentTab fo={fo} initialShipmentId="ship-a" />);

    expect(screen.getByRole('heading', { name: '상자 ship-new' })).toBeTruthy();
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

    expect(screen.getByRole('heading', { name: '상자 box-e' })).toBeTruthy();
    expect(
      screen.getByText('#6275와 #6314가 새 상자 하나로 합쳐졌어요')
    ).toBeTruthy();
  });
});

describe('상자 정보는 내부 번호·영어 상태 없이 보인다', () => {
  const longId = '8f772b52-43a1-4826-90ec-8981411c7466';

  beforeEach(() => {
    mockShipments.mockReturnValue(
      loaded([{ ...summary(longId, 'shipped'), reservedQty: 0 }])
    );
    mockDetail.mockReturnValue(
      loaded({
        ...detail(longId, 'shipped'),
        manifestVersion: 2,
        reservationVersion: 3,
        recoveryCode: 'DISPATCH_RECALL_PENDING',
        lines: [
          {
            id: 'line-1',
            fulfillmentOrderId: 'fo-1',
            fulfillmentOrderItemId: 'item-1',
            skuId: 'sku-1',
            skuName: '샘플 상품 (빨강)',
            qty: 1,
            reservedQty: 0,
            inspectedQty: 1,
            lineVersion: 1,
            origin: null,
            reservations: [],
          },
        ],
        waybills: [
          {
            id: 'wb-uuid-1',
            status: 'used',
            trackingNo: '4567-8901-2345',
            carrier: 'HANJIN',
            manifestVersion: 2,
            issuedAt: '2026-11-01T00:00:00Z',
            voidedAt: null,
          },
        ],
        dispatchAttempts: [
          {
            id: 'attempt-uuid-1',
            attemptNo: 1,
            status: 'dispatched',
            waybillId: 'wb-uuid-1',
            dispatchedAt: '2026-11-01T01:00:00Z',
            recalledAt: null,
            recoveryCode: null,
            sources: [
              {
                id: 'src-1',
                shipmentLineId: 'line-1',
                sourceLocationId: 'loc-uuid-1',
                quantity: 1,
                stockEventId: null,
              },
            ],
            trackingEvents: [],
          },
        ],
        operations: [
          {
            operationId: 'op-uuid-1',
            type: 'consolidate',
            status: 'completed',
            reason: '같은 고객 묶음',
            createdAt: '2026-11-01T00:00:00Z',
            completedAt: '2026-11-01T00:00:01Z',
          },
          {
            operationId: 'op-uuid-2',
            type: 'plan',
            status: 'failed',
            lastError: 'SHIPMENT_NOT_DRAFT',
            createdAt: '2026-11-01T00:00:00Z',
            completedAt: null,
          },
        ],
      })
    );
  });

  it('머리·목록·송장·출고·작업 기록을 한국어로 보인다', () => {
    renderTab();

    expect(screen.getByRole('heading', { name: '상자 8f772b52' })).toBeTruthy();
    const text = document.body.textContent ?? '';
    for (const expected of [
      '상자 (1)',
      '출고 완료 · 1개',
      '회수 재처리 대기',
      '창고 출고',
      '한진택배',
      '출고에 씀',
      '출고 기록 (1)',
      '1차 출고 · 송장 4567-8901-2345',
      '출고됨',
      '샘플 상품 (빨강) 1개',
      '작업 기록 (2)',
      '합포장',
      '같은 고객 묶음',
      '계획 확정',
      '처리하지 못했어요',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(
      /manifest|reservation|attempt|durable|operation|source|tracking|shipment|shipped|dispatched|completed|SHIPMENT_NOT_DRAFT|M2\/R3|wb-uuid|op-uuid|8f772b52-43a1/
    );
    const row = screen.getByRole('table').querySelector('tbody tr');
    // 출고한 상자는 확보가 풀려 있어 확보 수량 대신 —
    expect(row?.textContent).toBe('샘플 상품 (빨강)-1—1');
  });
});

describe('작업 기록의 사유·요청 경로·처리자·메모', () => {
  const systemActor = FULFILLMENT_SYSTEM_ACTOR_ID;
  const operation = (
    id: string,
    fields: Partial<ShipmentAdminDetail['operations'][number]>
  ): ShipmentAdminDetail['operations'][number] => ({
    operationId: id,
    type: 'recipient_revision',
    status: 'completed',
    createdAt: '2026-11-01T00:00:00Z',
    completedAt: '2026-11-01T00:00:01Z',
    ...fields,
  });

  const renderWith = (
    operations: ShipmentAdminDetail['operations']
  ): string => {
    mockShipments.mockReturnValue(loaded([summary('ship-1', 'draft')]));
    mockDetail.mockReturnValue(
      loaded({ ...detail('ship-1', 'draft'), operations })
    );
    renderTab();
    return document.body.textContent ?? '';
  };

  it('사유 이름표·요청 경로·처리자·시각·메모를 줄마다 보인다', () => {
    const text = renderWith([
      operation('op-1', {
        reason: '[가림]',
        reasonCode: 'customer_address_change',
        requestChannel: 'phone',
        operatorId: 'user-1',
        note: '택배사 확인 후 변경',
      }),
    ]);

    expect(text).toContain('수령인 변경 · 고객이 주소·연락처 변경 요청');
    expect(text).toContain(
      `전화 · 김관리 · ${new Date('2026-11-01T00:00:00Z').toLocaleString('ko-KR')}`
    );
    expect(text).toContain('택배사 확인 후 변경');
    expect(text).not.toMatch(/[a-z]+_[a-z_]+/);
  });

  it('자동 기록은 이름표와 «자동» 으로 보인다', () => {
    const text = renderWith([
      operation('op-2', {
        type: 'plan',
        reason: '[가림]',
        reasonCode: 'system_plan',
        operatorId: systemActor,
      }),
    ]);

    expect(text).toContain('계획 확정');
    expect(text).not.toContain('계획 확정 · 계획 확정');
    expect(text).toContain(
      `자동 · ${new Date('2026-11-01T00:00:00Z').toLocaleString('ko-KR')}`
    );
    expect(text).not.toContain(systemActor);
  });

  it('분류되지 않은 가려진 사유는 그대로 보이고 모르는 처리자 id 는 감춘다', () => {
    const text = renderWith([
      operation('op-3', {
        reason: '[가림]',
        reasonCode: null,
        operatorId: 'user-unknown',
      }),
    ]);

    expect(text).toContain('수령인 변경 · [가림]');
    expect(text).not.toContain('user-unknown');
  });

  it('직원 목록을 볼 권한이 없으면 조회하지 않고 처리자 없이 보인다', () => {
    mockCanReadProfile = false;
    const text = renderWith([
      operation('op-5', {
        reason: '[가림]',
        reasonCode: 'customer_address_change',
        operatorId: 'user-1',
      }),
    ]);

    expect(mockUsersLookup).toHaveBeenCalledWith(
      ['user-1'],
      expect.objectContaining({ enabled: false, retry: false })
    );
    expect(text).not.toContain('김관리');
    expect(text).not.toContain('user-1');
  });

  it('기타는 직접 쓴 글을 뒤에 붙인다', () => {
    const text = renderWith([
      operation('op-4', {
        type: 'split',
        reason: '박스 파손',
        reasonCode: 'other',
      }),
    ]);

    expect(text).toContain('상자 분할 · 기타 · 박스 파손');
  });
});
