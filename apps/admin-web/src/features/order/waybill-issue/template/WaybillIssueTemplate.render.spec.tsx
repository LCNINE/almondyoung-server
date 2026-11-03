/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  ConsolidationBoardGroup,
  PlannedShipment,
} from '@/lib/types/dto/fulfillment';
import WaybillIssueTemplate from './WaybillIssueTemplate';

type QueryState<T> = {
  data: T | undefined;
  isError: boolean;
  refetch: () => void;
};

const mockPlanned = jest.fn<QueryState<PlannedShipment[]>, [string]>();
const mockBoard = jest.fn<
  QueryState<{ groups: ConsolidationBoardGroup[] }>,
  [string]
>();
const mockMutateAsync = jest.fn();

jest.mock('@/lib/services/orders', () => ({
  createIdempotentCommand: () => ({ idempotencyKey: 'key-1' }),
  getServerDenyMessage: (_error: unknown, fallback: string) => fallback,
  isCarrierSupported: () => true,
  isWaybillFailed: () => false,
  isWaybillIssued: () => true,
  isWaybillPendingIssue: () => false,
  isWaybillWaitingRetry: () => false,
  retryNoticeOf: () => null,
  WAYBILL_CARRIERS: ['HANJIN'],
  useBatchIssueWaybills: Object.assign(
    () => ({ mutateAsync: mockMutateAsync, isPending: false }),
    { permission: ['fulfillment.warehouse.operate'] }
  ),
  useConsolidationBoard: (warehouseId: string) => mockBoard(warehouseId),
  usePlannedShipments: (warehouseId: string) => mockPlanned(warehouseId),
}));

jest.mock('@/lib/services/inventory/queries', () => ({
  useWarehouses: () => ({ data: [{ id: 'w1', name: '부천 물류창고' }] }),
}));

jest.mock('@/hooks/use-permission', () => ({
  useCan: () => ({ status: 'ready', allowed: true }),
  usePermissionCheck: () => ({
    can: () => true,
    canRun: () => true,
    isPermissionLoading: false,
    blockedReason: () => null,
  }),
}));

jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/features/order/fulfillments/detail/consolidation-sheet', () => ({
  ConsolidationSheet: ({ shipmentId }: { shipmentId: string }) => (
    <div>합치기 시트 {shipmentId}</div>
  ),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

class NoopResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.hasPointerCapture = () => false;
Element.prototype.scrollIntoView = () => {};

const planned: PlannedShipment[] = [
  { shipmentId: 'a1111111-0000', orderNos: ['6321'], totalQty: 4 },
  { shipmentId: 'b2222222-0000', orderNos: ['6322'], totalQty: 3 },
  { shipmentId: 'c3333333-0000', orderNos: ['6324'], totalQty: 4 },
];

const boardGroup: ConsolidationBoardGroup = {
  key: 'g1',
  recipientSnapshot: {},
  memoDiffers: false,
  canMergeNow: false,
  shipments: ['a1111111-0000', 'b2222222-0000'].map((shipmentId) => ({
    shipmentId,
    status: 'planned',
    salesOrderNos: [],
    itemSummary: '',
    totalQty: 1,
    batchId: null,
    waybillTrackingNo: null,
    manifestVersion: 1,
    reservationVersion: 1,
    createdAt: '2026-11-01T00:00:00Z',
    orderedAt: null,
    salesChannels: [],
  })),
};

const refetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockPlanned.mockReturnValue({ data: planned, isError: false, refetch });
  mockBoard.mockReturnValue({
    data: { groups: [boardGroup] },
    isError: false,
    refetch,
  });
  mockMutateAsync.mockResolvedValue([]);
});

async function pick(...orderNos: string[]) {
  for (const orderNo of orderNos) {
    const row = screen.getByText(`#${orderNo}`).closest('tr');

    if (!row) throw new Error('row');

    await userEvent.click(within(row).getByRole('checkbox'));
  }
}

const WARNING = '먼저 확인해 주세요. 고른 상자 중 2개는 같은 곳으로 가요';

describe('WaybillIssueTemplate', () => {
  it('같은 묶음의 두 상자를 고르면 경고하고 따로 발급을 누르면 숨긴다', async () => {
    render(<WaybillIssueTemplate />);

    await pick('6321', '6322');
    expect(screen.getByText(WARNING)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: '따로 발급' }));
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('한쪽만 고르면 경고하지 않는다', async () => {
    render(<WaybillIssueTemplate />);

    await pick('6321', '6324');
    expect(screen.queryByText(WARNING)).toBeNull();
  });

  it('합치기를 누르면 합포장 시트를 연다', async () => {
    render(<WaybillIssueTemplate />);

    await pick('6321', '6322');
    await userEvent.click(screen.getByRole('button', { name: '합치기' }));

    expect(screen.getByText('합치기 시트 a1111111-0000')).toBeTruthy();
  });

  it('묶음 조회가 실패해도 경고 없이 발급할 수 있다', async () => {
    mockBoard.mockReturnValue({ data: undefined, isError: true, refetch });
    render(<WaybillIssueTemplate />);

    await pick('6321', '6322');
    expect(screen.queryByText(WARNING)).toBeNull();

    const issue = screen.getByRole('button', { name: /일괄발급/ });

    expect((issue as HTMLButtonElement).disabled).toBe(false);
  });

  it('발급 전에 건수를 확인하는 창을 띄우고 확인해야 요청한다', async () => {
    render(<WaybillIssueTemplate />);

    await pick('6321', '6324');
    await userEvent.click(screen.getByRole('button', { name: /일괄발급/ }));

    expect(mockMutateAsync).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByText('송장 2건을 발급할까요?')).toBeTruthy();

    await userEvent.click(within(dialog).getByRole('button', { name: '발급' }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        data: {
          shipmentIds: ['a1111111-0000', 'c3333333-0000'],
          carrier: 'HANJIN',
        },
        idempotencyKey: 'key-1',
      })
    );
  });

  it('주문번호로 검색하면 목록을 좁힌다', async () => {
    render(<WaybillIssueTemplate />);

    await userEvent.type(screen.getByPlaceholderText('주문번호 검색'), '6324');

    expect(screen.queryByText('#6321')).toBeNull();
    expect(screen.getByText('#6324')).toBeTruthy();
  });
});
