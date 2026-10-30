/**
 * @jest-environment jsdom
 */
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PermissionedAction } from '@/lib/auth/mutation-permission';
import { orderQueryKeys } from '@/lib/services/orders/query-keys';
import type {
  ConsolidationProgressResponse,
  ConsolidationProgressSource,
} from '@/lib/types/dto/fulfillment';
import { ConsolidationProgressPanel } from './consolidation-progress-panel';

type ExcludeVars = { batchId: string; shipmentId: string; reason: string };
type VoidVars = {
  waybillId: string;
  shipmentId?: string;
  data: { reason: string };
};

const mockProgress = jest.fn<
  { data: ConsolidationProgressResponse | null | undefined },
  [string]
>();
const mockBatch = jest.fn<
  { data: { name: string; batchNumber: string } | undefined },
  [string]
>();
const mockExclude = jest.fn<Promise<unknown>, [ExcludeVars]>();
const mockVoid = jest.fn<Promise<unknown>, [VoidVars]>();
const mockGranted = new Set<string>();

jest.mock('@/lib/services/orders/queries', () => ({
  useConsolidationProgress: (shipmentId: string) => mockProgress(shipmentId),
  useOutboundBatchV2: (batchId: string) => mockBatch(batchId),
}));

// 배럴 전체를 끌어오지 않도록 패널이 쓰는 것만 둔다.
jest.mock('@/lib/services/orders', () => ({
  getServerDenyMessage: () => '거절됐어요',
  useExcludeShipmentFromBatch: Object.assign(
    () => ({ mutateAsync: mockExclude, isPending: false }),
    { permission: ['fulfillment.warehouse.operate'] }
  ),
  useVoidWaybill: Object.assign(
    () => ({ mutateAsync: mockVoid, isPending: false }),
    { permission: ['fulfillment.shipment.reopen'] }
  ),
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

const source = (
  overrides: Partial<ConsolidationProgressSource> = {}
): ConsolidationProgressSource => ({
  shipmentId: 'src',
  trackingNo: '4567-8901-2345',
  batchId: 'batch-1',
  workItemStatus: 'picking',
  waybillId: 'wb-1',
  waybillStatus: 'registered',
  blockers: ['ACTIVE_INVOICE', 'ACTIVE_WORK_ITEM'],
  gaveUpAt: null,
  nextCheckAt: null,
  ...overrides,
});

const pending = (
  sources: ConsolidationProgressSource[]
): ConsolidationProgressResponse => ({
  operationId: 'op-1',
  status: 'pending',
  targetShipmentId: null,
  sources,
});

let queryClient: QueryClient;

const renderPanel = (children?: ReactNode) => {
  const wrapper = ({ children: tree }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
  );

  return render(
    <ConsolidationProgressPanel shipmentId="src">
      {children}
    </ConsolidationProgressPanel>,
    { wrapper }
  );
};

const GAVE_UP_AT = '2026-10-29T03:00:00Z';

const hasDimmedAncestor = (element: HTMLElement) =>
  element.closest('.opacity-50') !== null;

const grant = (...keys: string[]) =>
  keys.forEach((key) => mockGranted.add(key));

beforeEach(() => {
  jest.clearAllMocks();
  mockGranted.clear();
  queryClient = new QueryClient();
  mockBatch.mockReturnValue({
    data: { name: '정중식 테스트 v2', batchNumber: 'B-001' },
  });
  mockExclude.mockResolvedValue({});
  mockVoid.mockResolvedValue({});
});

describe('합포장 진행 패널', () => {
  it('진행 응답이 없으면 아무것도 그리지 않는다', () => {
    mockProgress.mockReturnValue({ data: null });

    const { container } = renderPanel();

    expect(container.innerHTML).toBe('');
  });

  it('exclude 단계면 배치에서 빼기 버튼, 권한 없으면 숨김', async () => {
    mockProgress.mockReturnValue({ data: pending([source()]) });
    grant('fulfillment.warehouse.operate');
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();

    renderPanel();

    expect(screen.getByText('합포장 진행 중')).toBeTruthy();
    expect(screen.getByText('이 상자를 배치에서 빼 주세요')).toBeTruthy();
    expect(
      screen.getByText(/정중식 테스트 v2 배치에 들어 있어요/)
    ).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '배치에서 빼기' }));

    expect(mockExclude).toHaveBeenCalledWith({
      batchId: 'batch-1',
      shipmentId: 'src',
      reason: '합포장',
    });
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: orderQueryKeys.consolidationProgress('src'),
      })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orderQueryKeys.shipment('src'),
    });
  });

  it('배치에서 빼기 권한이 없으면 버튼을 숨긴다', () => {
    mockProgress.mockReturnValue({ data: pending([source()]) });

    renderPanel();

    expect(screen.getByText('이 상자를 배치에서 빼 주세요')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '배치에서 빼기' })).toBeNull();
  });

  it('unpick 단계면 창고에 전할 문구와 복사 버튼', async () => {
    mockProgress.mockReturnValue({
      data: pending([source({ workItemStatus: 'withdrawing' })]),
    });
    const user = userEvent.setup();

    renderPanel();

    const message =
      '정중식 테스트 v2 배치의 송장 4567-8901-2345 상자를 뺐어요. 담아 둔 상품을 되돌려 주세요.';

    expect(
      screen.getByText('창고에서 상품을 제자리에 돌려놓아야 해요')
    ).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(mockBatch).toHaveBeenCalledWith('batch-1');

    await user.click(screen.getByRole('button', { name: '문구 복사' }));

    // user-event 가 navigator.clipboard 를 자기 가짜로 바꿔 둔다.
    expect(await navigator.clipboard.readText()).toBe(message);
  });

  it('void 단계면 운송장 취소 버튼, registered 일 때만', async () => {
    mockProgress.mockReturnValue({
      data: pending([source({ batchId: null, blockers: ['ACTIVE_INVOICE'] })]),
    });
    grant('fulfillment.shipment.reopen');
    const user = userEvent.setup();

    renderPanel();

    expect(screen.getByText('기존 운송장을 취소해 주세요')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '운송장 취소' }));

    expect(mockVoid).toHaveBeenCalledWith({
      waybillId: 'wb-1',
      shipmentId: 'src',
      data: { reason: '합포장으로 재발급' },
    });
  });

  it('송장이 registered 가 아니면 운송장 취소 대신 예외로 보인다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({
          batchId: null,
          blockers: ['ACTIVE_INVOICE'],
          waybillStatus: 'allocated',
        }),
      ]),
    });
    grant('fulfillment.shipment.reopen');

    renderPanel();

    expect(screen.queryByRole('button', { name: '운송장 취소' })).toBeNull();
    expect(
      screen.getByText('이 화면에서 처리할 수 없는 상태예요')
    ).toBeTruthy();
  });

  it('auto 단계면 "10분 안에 자동으로 합쳐져요"', () => {
    mockProgress.mockReturnValue({
      data: pending([source({ batchId: null, blockers: [] })]),
    });

    renderPanel();

    expect(screen.getByText('10분 안에 자동으로 합쳐져요')).toBeTruthy();
    expect(screen.queryByText(/1분/)).toBeNull();
  });

  it('stuck 이면 "이 화면에서 처리할 수 없는 상태예요"와 정체 보드 링크', () => {
    mockProgress.mockReturnValue({
      data: pending([source({ blockers: ['DISPATCH_ATTEMPT_EXISTS'] })]),
    });
    grant('fulfillment.warehouse.operate');

    renderPanel();

    expect(
      screen.getByText('이 화면에서 처리할 수 없는 상태예요')
    ).toBeTruthy();
    expect(screen.getByText(/발송 시도가 있어요/)).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '정체 보드 열기' }).getAttribute('href')
    ).toBe('/order/stall-board');
    expect(screen.queryByRole('button', { name: '배치에서 빼기' })).toBeNull();
  });

  it('pending·completed 가 아닌 작업도 예외로 보인다', () => {
    mockProgress.mockReturnValue({
      data: { ...pending([source()]), status: 'recovery_required' },
    });

    renderPanel();

    expect(
      screen.getByText('이 화면에서 처리할 수 없는 상태예요')
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: '정체 보드 열기' })).toBeTruthy();
  });

  it('gaveUp 이면 "자동으로 합쳐지지 않았어요"', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({
          batchId: null,
          blockers: [],
          gaveUpAt: '2026-10-29T03:00:00Z',
        }),
      ]),
    });

    renderPanel();

    expect(screen.getByText('자동으로 합쳐지지 않았어요')).toBeTruthy();
    expect(screen.queryByText('10분 안에 자동으로 합쳐져요')).toBeNull();
    expect(
      screen.getByRole('link', { name: '정체 보드 열기' }).getAttribute('href')
    ).toBe('/order/stall-board');
  });

  it('completed 면 "합쳐졌어요"와 새 상자 링크(/order/fulfillments?shipmentId=<target>)', () => {
    mockProgress.mockReturnValue({
      data: {
        operationId: 'op-1',
        status: 'completed',
        targetShipmentId: 'target-1',
        sources: [source({ gaveUpAt: '2026-10-29T03:00:00Z' })],
      },
    });

    renderPanel();

    expect(screen.getByText('합쳐졌어요')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '새 상자로 가기' }).getAttribute('href')
    ).toBe('/order/fulfillments?shipmentId=target-1');
    expect(screen.queryByText('합포장 진행 중')).toBeNull();
    expect(screen.queryByText('자동으로 합쳐지지 않았어요')).toBeNull();
  });

  it('원본이 둘이면 지금 할 일에 그 상자의 송장번호를 적는다', async () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ batchId: null, blockers: [] }),
        source({
          shipmentId: 'other',
          trackingNo: '1111-2222-3333',
          batchId: 'batch-2',
          waybillId: 'wb-2',
        }),
      ]),
    });
    grant('fulfillment.warehouse.operate');
    const user = userEvent.setup();

    renderPanel();

    expect(
      screen.getByText('송장 1111-2222-3333 상자의 일이에요')
    ).toBeTruthy();
    expect(screen.getByText('상자 2개를 하나로 합치는 중이에요')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: '배치에서 빼기' }));

    expect(mockExclude).toHaveBeenCalledWith({
      batchId: 'batch-2',
      shipmentId: 'other',
      reason: '합포장',
    });
  });

  it('포기가 있어도 배치에서 빼기 할 일과 버튼은 남는다', () => {
    mockProgress.mockReturnValue({
      data: pending([source({ gaveUpAt: GAVE_UP_AT })]),
    });
    grant('fulfillment.warehouse.operate');

    renderPanel();

    expect(screen.getByText('이 상자를 배치에서 빼 주세요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '배치에서 빼기' })).toBeTruthy();
    expect(screen.getByText('자동으로 합쳐지지 않았어요')).toBeTruthy();
    expect(screen.getByRole('link', { name: '정체 보드 열기' })).toBeTruthy();
  });

  it('포기가 있어도 창고에 전할 문구와 복사 버튼은 남는다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ workItemStatus: 'withdrawing', gaveUpAt: GAVE_UP_AT }),
      ]),
    });

    renderPanel();

    expect(
      screen.getByText(
        '정중식 테스트 v2 배치의 송장 4567-8901-2345 상자를 뺐어요. 담아 둔 상품을 되돌려 주세요.'
      )
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '문구 복사' })).toBeTruthy();
  });

  it('포기가 있어도 운송장 취소 할 일과 버튼은 남는다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({
          batchId: null,
          blockers: ['ACTIVE_INVOICE'],
          gaveUpAt: GAVE_UP_AT,
        }),
      ]),
    });
    grant('fulfillment.shipment.reopen');

    renderPanel();

    expect(screen.getByText('기존 운송장을 취소해 주세요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '운송장 취소' })).toBeTruthy();
  });

  it('다른 원본의 포기가 할 일을 가진 상자의 할 일을 가리지 않는다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ batchId: null, blockers: [], gaveUpAt: GAVE_UP_AT }),
        source({
          shipmentId: 'other',
          trackingNo: '1111-2222-3333',
          batchId: 'batch-2',
          waybillId: 'wb-2',
        }),
      ]),
    });
    grant('fulfillment.warehouse.operate');

    renderPanel();

    expect(screen.getByText('이 상자를 배치에서 빼 주세요')).toBeTruthy();
    expect(screen.getByRole('button', { name: '배치에서 빼기' })).toBeTruthy();
    expect(
      screen.getByText('송장 1111-2222-3333 상자의 일이에요')
    ).toBeTruthy();
    expect(screen.queryByText('10분 안에 자동으로 합쳐져요')).toBeNull();
  });

  it('합쳐진 원본 상자는 아래 내용을 흐리게 두고 초록 패널은 그대로 둔다', () => {
    mockProgress.mockReturnValue({
      data: {
        operationId: 'op-1',
        status: 'completed',
        targetShipmentId: 'target-1',
        sources: [source(), source({ shipmentId: 'other' })],
      },
    });

    renderPanel(<p>상자 내용</p>);

    expect(hasDimmedAncestor(screen.getByText('상자 내용'))).toBe(true);
    expect(hasDimmedAncestor(screen.getByText('합쳐졌어요'))).toBe(false);
    expect(
      hasDimmedAncestor(screen.getByRole('link', { name: '새 상자로 가기' }))
    ).toBe(false);
  });

  it('진행 중이면 아래 상자 내용을 흐리게 두지 않는다', () => {
    mockProgress.mockReturnValue({ data: pending([source()]) });

    renderPanel(<p>상자 내용</p>);

    expect(hasDimmedAncestor(screen.getByText('상자 내용'))).toBe(false);
  });
});
