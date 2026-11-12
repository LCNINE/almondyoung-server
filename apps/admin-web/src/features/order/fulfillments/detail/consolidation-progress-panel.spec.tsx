/**
 * @jest-environment jsdom
 */
import { randomUUID } from 'node:crypto';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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
let mockVoidPending = false;
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
    () => ({ mutateAsync: mockVoid, isPending: mockVoidPending }),
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
  orderNo: null,
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

const TARGET = { status: 'draft', waybills: [], workItems: [] };

let queryClient: QueryClient;

const renderPanel = (
  children?: ReactNode,
  props: { mergedFromShipmentId?: string; shipmentId?: string } = {}
) => {
  const wrapper = ({ children: tree }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
  );

  return render(
    <ConsolidationProgressPanel
      shipmentId={props.shipmentId ?? 'src'}
      mergedFromShipmentId={props.mergedFromShipmentId}
      target={TARGET}
    >
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
  mockVoidPending = false;
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
    expect(
      screen
        .getByRole('checkbox', { name: '송장도 같이 무효화' })
        .getAttribute('data-state')
    ).toBe('checked');
    await user.click(screen.getByRole('button', { name: '빼기' }));

    expect(mockExclude).toHaveBeenCalledWith({
      batchId: 'batch-1',
      shipmentId: 'src',
      reason: '합포장',
      voidWaybill: true,
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

  it('체크를 끄면 송장 무효화 없이 빼기를 요청한다', async () => {
    mockProgress.mockReturnValue({ data: pending([source()]) });
    grant('fulfillment.warehouse.operate');
    const user = userEvent.setup();

    renderPanel();
    await user.click(screen.getByRole('button', { name: '배치에서 빼기' }));
    await user.click(
      screen.getByRole('checkbox', { name: '송장도 같이 무효화' })
    );
    await user.click(screen.getByRole('button', { name: '빼기' }));

    expect(mockExclude).toHaveBeenCalledWith({
      batchId: 'batch-1',
      shipmentId: 'src',
      reason: '합포장',
      voidWaybill: false,
    });
  });

  it('자동 무효화가 예약된 철회 상자는 안내를 보이고 수동 취소 버튼을 숨긴다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ workItemStatus: 'withdrawing', voidOnWithdrawal: true }),
      ]),
    });
    grant('fulfillment.shipment.reopen');

    renderPanel();

    expect(
      screen.getByText('상품을 다 꺼내면 송장이 자동으로 무효화돼요')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '운송장 취소' })).toBeNull();
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

  it('운송장 취소 중이면 버튼 크기를 그대로 두고 로딩을 보인다', () => {
    mockProgress.mockReturnValue({
      data: pending([source({ batchId: null, blockers: ['ACTIVE_INVOICE'] })]),
    });
    grant('fulfillment.shipment.reopen');
    mockVoidPending = true;

    renderPanel();

    const button = screen.getByRole('button', { name: '운송장 취소' });

    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.querySelector('.invisible')?.textContent).toBe('운송장 취소');
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

  describe('자동 합포장 대기', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-11-12T12:00:00'));
    });

    afterEach(() => {
      cleanup();
      jest.useRealTimers();
    });

    it('가장 빠른 확인 시각까지 매초 세고 예정 시각과 2분 뒤에 상태를 바꾼다', () => {
      mockProgress.mockReturnValue({
        data: pending([
          source({
            batchId: null,
            blockers: [],
            nextCheckAt: '2026-11-12T12:05:00',
          }),
          source({
            shipmentId: 'other',
            batchId: null,
            blockers: [],
            nextCheckAt: '2026-11-12T12:01:02',
          }),
        ]),
      });

      renderPanel();

      expect(screen.getByText('자동으로 합치는 중이에요')).toBeTruthy();
      expect(
        screen.getByText(
          '서버가 1분 02초 뒤(12:01)에 다시 확인하고 바로 합쳐요.'
        )
      ).toBeTruthy();
      expect(screen.getByRole('progressbar')).toBeTruthy();
      expect(
        screen.getByText(
          '더 누를 건 없어요. 합쳐지면 이 화면이 저절로 바뀌어요.'
        )
      ).toBeTruthy();

      act(() => jest.advanceTimersByTime(1000));

      expect(
        screen.getByText(
          '서버가 1분 01초 뒤(12:01)에 다시 확인하고 바로 합쳐요.'
        )
      ).toBeTruthy();
      expect(
        Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))
      ).toBeGreaterThan(0);

      act(() => jest.advanceTimersByTime(61_000));

      expect(screen.getByText('지금 확인하고 있어요')).toBeTruthy();
      expect(
        screen.getByText('곧 합쳐져요. 보통 1분 안에 끝나요.')
      ).toBeTruthy();
      expect(screen.queryByRole('progressbar')).toBeNull();

      act(() => jest.advanceTimersByTime(119_000));

      expect(screen.getByText('지금 확인하고 있어요')).toBeTruthy();

      act(() => jest.advanceTimersByTime(1000));

      expect(screen.getByText('예상보다 오래 걸리고 있어요')).toBeTruthy();
      expect(
        screen.getByText('12:01에 확인하기로 했는데 아직 안 합쳐졌어요.')
      ).toBeTruthy();
      expect(
        screen
          .getByRole('link', { name: '정체 보드 열기' })
          .getAttribute('href')
      ).toBe('/order/stall-board');
    });

    it('확인 시각이 없으면 지금 확인 중이라고 표시한다', () => {
      mockProgress.mockReturnValue({
        data: pending([source({ batchId: null, blockers: [] })]),
      });

      renderPanel();

      expect(screen.getByText('지금 확인하고 있어요')).toBeTruthy();
      expect(
        screen.getByText('곧 합쳐져요. 보통 1분 안에 끝나요.')
      ).toBeTruthy();
      expect(screen.queryByRole('progressbar')).toBeNull();
    });

    it('재조회로 확인 시각이 바뀌면 새 시각부터 기다린다', () => {
      mockProgress.mockReturnValue({
        data: pending([
          source({
            batchId: null,
            blockers: [],
            nextCheckAt: '2026-11-12T11:57:00',
          }),
        ]),
      });
      const view = renderPanel();

      expect(screen.getByText('예상보다 오래 걸리고 있어요')).toBeTruthy();

      mockProgress.mockReturnValue({
        data: pending([
          source({ batchId: null, blockers: [], nextCheckAt: null }),
          source({
            shipmentId: 'other',
            batchId: null,
            blockers: [],
            nextCheckAt: '2026-11-12T12:03:00',
          }),
        ]),
      });
      view.rerender(
        <ConsolidationProgressPanel shipmentId="src" target={TARGET} />
      );

      expect(
        screen.getByText(
          '서버가 3분 00초 뒤(12:03)에 다시 확인하고 바로 합쳐요.'
        )
      ).toBeTruthy();
      expect(
        screen.getByRole('progressbar').getAttribute('aria-valuenow')
      ).toBe('0');
    });
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
    expect(screen.queryByText('지금 확인하고 있어요')).toBeNull();
    expect(screen.queryByText('자동으로 합치는 중이에요')).toBeNull();
    expect(
      screen.getByRole('link', { name: '정체 보드 열기' }).getAttribute('href')
    ).toBe('/order/stall-board');
  });

  it('completed 인 원본 상자는 새 상자로 가라고 하지 않고 쓰지 않는 상자라고만 알린다', () => {
    mockProgress.mockReturnValue({
      data: {
        operationId: 'op-1',
        status: 'completed',
        targetShipmentId: 'target-1',
        sources: [source({ gaveUpAt: '2026-10-29T03:00:00Z' })],
      },
    });

    renderPanel();

    expect(screen.getByText('합쳐져서 지금은 쓰지 않는 상자예요')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '새 상자로 가기' })).toBeNull();
    expect(screen.queryByText('합포장 진행 중')).toBeNull();
    expect(screen.queryByText('자동으로 합쳐지지 않았어요')).toBeNull();
  });

  it('한 원본에 주문이 여럿이어도 제목에 모든 주문번호를 센다', () => {
    mockProgress.mockImplementation((id) => ({
      data:
        id === 'src'
          ? {
              operationId: 'op-1',
              status: 'completed',
              targetShipmentId: 'target-1',
              sources: [
                source({ orderNo: '6275, 6276' }),
                source({ shipmentId: 'other', orderNo: '6314' }),
              ],
            }
          : null,
    }));

    renderPanel(<p>상자 내용</p>, {
      shipmentId: 'target-1',
      mergedFromShipmentId: 'src',
    });

    expect(
      screen.getByText('#6275 외 2건이 새 상자 하나로 합쳐졌어요')
    ).toBeTruthy();
  });

  it('새 상자에서는 합쳐졌다는 카드와 다음 할 일 세 단계를 맨 위에 보인다', () => {
    mockProgress.mockImplementation((id) => ({
      data:
        id === 'src'
          ? {
              operationId: 'op-1',
              status: 'completed',
              targetShipmentId: 'target-1',
              sources: [
                source({ orderNo: '6275' }),
                source({ shipmentId: 'other', orderNo: '6314' }),
              ],
            }
          : null,
    }));

    renderPanel(<p>상자 내용</p>, {
      shipmentId: 'target-1',
      mergedFromShipmentId: 'src',
    });

    expect(
      screen.getByText('#6275와 #6314가 새 상자 하나로 합쳐졌어요')
    ).toBeTruthy();
    expect(screen.getByText('다음 할 일')).toBeTruthy();
    expect(screen.getByText('1. 계획 확정')).toBeTruthy();
    expect(screen.getByText('2. 운송장 발급')).toBeTruthy();
    expect(screen.getByText('3. 배치 넣기')).toBeTruthy();
    expect(screen.queryByRole('link', { name: '새 상자로 가기' })).toBeNull();
    expect(hasDimmedAncestor(screen.getByText('상자 내용'))).toBe(false);
    expect(
      screen
        .getByText('#6275와 #6314가 새 상자 하나로 합쳐졌어요')
        .compareDocumentPosition(screen.getByText('상자 내용')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('주문번호를 모르면 상자 수로 말한다', () => {
    mockProgress.mockImplementation((id) => ({
      data:
        id === 'src'
          ? {
              operationId: 'op-1',
              status: 'completed',
              targetShipmentId: 'target-1',
              sources: [source(), source({ shipmentId: 'other' })],
            }
          : null,
    }));

    renderPanel(undefined, {
      shipmentId: 'target-1',
      mergedFromShipmentId: 'src',
    });

    expect(
      screen.getByText('상자 2개가 새 상자 하나로 합쳐졌어요')
    ).toBeTruthy();
  });

  it('합포장이 끝나면 출고주문과 상자 조회를 다시 불러온다', async () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    mockProgress.mockReturnValue({
      data: pending([
        source({ orderNo: '6275' }),
        source({ shipmentId: 'other', orderNo: '6314' }),
      ]),
    });

    const view = renderPanel();

    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: orderQueryKeys.fulfillments,
    });

    mockProgress.mockReturnValue({
      data: {
        operationId: 'op-1',
        status: 'completed',
        targetShipmentId: 'target-1',
        sources: [
          source({ orderNo: '6275' }),
          source({ shipmentId: 'other', orderNo: '6314' }),
        ],
      },
    });
    view.rerender(
      <ConsolidationProgressPanel shipmentId="src" target={TARGET} />
    );

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: orderQueryKeys.fulfillments,
      })
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orderQueryKeys.fulfillmentOrders,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orderQueryKeys.shipment('src'),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orderQueryKeys.shipment('other'),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: orderQueryKeys.shipment('target-1'),
    });
    expect(toast.success).toHaveBeenCalledWith('#6275와 #6314가 합쳐졌어요');

    view.rerender(
      <ConsolidationProgressPanel shipmentId="src" target={TARGET} />
    );

    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('이미 합쳐진 상자를 처음 열 때는 다시 불러오지 않는다', () => {
    const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
    mockProgress.mockReturnValue({
      data: {
        operationId: 'op-1',
        status: 'completed',
        targetShipmentId: 'target-1',
        sources: [source()],
      },
    });

    renderPanel();

    expect(invalidate).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('진행 중 제목은 합치는 두 주문을 말하고 내 주문을 앞에 둔다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ shipmentId: 'other', orderNo: '6275', batchId: null }),
        source({
          orderNo: '6314',
          batchId: null,
          blockers: ['ACTIVE_INVOICE'],
        }),
      ]),
    });

    renderPanel();

    expect(screen.getByText('#6314와 #6275를 합치는 중이에요')).toBeTruthy();
    expect(
      screen.getByText('끝날 때까지 두 상자 모두 출고되지 않아요')
    ).toBeTruthy();
  });

  it('상대 주문 상자의 일이면 이 상자가 아니라 주문번호와 송장번호로 말한다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ orderNo: '6314', batchId: null, blockers: [] }),
        source({
          shipmentId: 'other',
          orderNo: '6275',
          trackingNo: '100037690642',
          batchId: null,
          waybillId: 'wb-2',
          blockers: ['ACTIVE_INVOICE'],
        }),
      ]),
    });
    grant('fulfillment.shipment.reopen');

    renderPanel();

    expect(
      screen.getByText('#6275 상자의 운송장을 취소해 주세요')
    ).toBeTruthy();
    expect(screen.queryByText('기존 운송장을 취소해 주세요')).toBeNull();
    expect(
      screen.getByText(/#6275 상자\(송장 100037690642\)의 일이에요/)
    ).toBeTruthy();
  });

  it('한 상자에 주문이 여럿이면 주문번호마다 #를 붙인다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ orderNo: '6314', batchId: null, blockers: [] }),
        source({
          shipmentId: 'other',
          orderNo: '6275, 6276',
          trackingNo: '100037690642',
          batchId: null,
          waybillId: 'wb-2',
          blockers: ['ACTIVE_INVOICE'],
        }),
      ]),
    });
    grant('fulfillment.shipment.reopen');

    renderPanel();

    expect(
      screen.getByText('#6275, #6276 상자의 운송장을 취소해 주세요')
    ).toBeTruthy();
    expect(
      screen.getByText(/#6275, #6276 상자\(송장 100037690642\)의 일이에요/)
    ).toBeTruthy();
  });

  it('상대 주문 상자를 배치에서 뺄 때도 그 주문을 말한다', () => {
    mockProgress.mockReturnValue({
      data: pending([
        source({ orderNo: '6314', batchId: null, blockers: [] }),
        source({
          shipmentId: 'other',
          orderNo: '6275',
          trackingNo: '100037690642',
        }),
      ]),
    });

    renderPanel();

    expect(screen.getByText('#6275 상자를 배치에서 빼 주세요')).toBeTruthy();
    expect(screen.queryByText('이 상자를 배치에서 빼 주세요')).toBeNull();
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
    expect(
      screen
        .getByRole('checkbox', { name: '송장도 같이 무효화' })
        .getAttribute('data-state')
    ).toBe('checked');
    await user.click(screen.getByRole('button', { name: '빼기' }));

    expect(mockExclude).toHaveBeenCalledWith({
      batchId: 'batch-2',
      shipmentId: 'other',
      reason: '합포장',
      voidWaybill: true,
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

    expect(
      screen.getByText('송장 1111-2222-3333 상자를 배치에서 빼 주세요')
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: '배치에서 빼기' })).toBeTruthy();
    expect(
      screen.getByText('송장 1111-2222-3333 상자의 일이에요')
    ).toBeTruthy();
    expect(screen.queryByText('지금 확인하고 있어요')).toBeNull();
    expect(screen.queryByText('자동으로 합치는 중이에요')).toBeNull();
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
    expect(
      hasDimmedAncestor(screen.getByText('합쳐져서 지금은 쓰지 않는 상자예요'))
    ).toBe(false);
  });

  it('진행 중이면 아래 상자 내용을 흐리게 두지 않는다', () => {
    mockProgress.mockReturnValue({ data: pending([source()]) });

    renderPanel(<p>상자 내용</p>);

    expect(hasDimmedAncestor(screen.getByText('상자 내용'))).toBe(false);
  });
});
