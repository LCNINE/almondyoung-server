/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RefundDto } from '@/lib/types/dto/wallet';
import type {
  SalesOrderBusinessTimelineItemDto,
  SalesOrderShipmentOperationDto,
} from '@/lib/types/dto/orders';
import type { OrderLineRow } from '../../hooks/use-order-rows';

const mockOperationsHook = jest.fn();
const mockOrder = jest.fn();
const mockRows = jest.fn();
let mockPage = 0;
const mockSetPage = jest.fn();
const mockBankRefunds = jest.fn();

jest.mock('@/lib/services/orders', () => ({
  useSalesOrder: (id: string) => mockOrder(id),
  useSalesOrderAmendments: () => ({ data: [], isError: false }),
  useAdminCancelSalesOrder: () => ({}),
  useAdminManualRefundComplete: () => ({}),
  useSalesOrderShipmentOperations: (
    id: string,
    options: { enabled?: boolean }
  ) => mockOperationsHook(id, options),
}));

jest.mock('@/lib/services/users/queries', () => ({
  useAdminUsersByIds: (_ids: string[], options: { enabled?: boolean }) => ({
    data: options.enabled
      ? { data: [{ id: 'user-1', username: '김관리', loginId: 'kim' }] }
      : undefined,
  }),
}));

// 표 화면의 나머지 의존은 이 창과 무관하다.
jest.mock('@/components/common/merged-data-table', () => ({
  MergedDataTable: ({
    data,
    columns,
    emptyMessage,
  }: {
    data: OrderLineRow[];
    columns: {
      label: string;
      render?: (value: unknown, row: OrderLineRow) => React.ReactNode;
    }[];
    emptyMessage?: string;
  }) => (
    <>
      {data.length === 0 && <p>{emptyMessage}</p>}
      {data.map((r) => (
        <div key={r.rowId}>
          {columns.find((c) => c.label === '기능')?.render?.(undefined, r)}
        </div>
      ))}
    </>
  ),
}));
jest.mock('@/components/admin-ui-experimental/common/table/table', () => ({
  Table: {
    Pagination: ({ count }: { count: number }) => <p>전체 {count}건</p>,
  },
}));
jest.mock('@/features/order/cancel-settlement/settlement-actions', () => ({
  SettlementActions: () => null,
}));
jest.mock('../purchase-satisfaction-section', () => ({
  PurchaseSatisfactionSection: () => null,
}));
jest.mock('@/hooks/use-permission', () => ({
  useCan: () => ({ status: 'ready', allowed: true }),
  useCanOpen: () => ({ status: 'ready', allowed: true }),
  useCanRun: () => ({ status: 'ready', allowed: true }),
  usePermissionCheck: () => ({ can: () => true, canRun: () => true }),
}));
jest.mock('../../contexts/filter.context', () => ({
  useOrderHistoryFilter: () => ({
    filter: { type: 'all', channels: [] },
    searchToken: 0,
    page: mockPage,
    setPage: mockSetPage,
  }),
}));
jest.mock('../../hooks/use-order-rows', () => ({
  useSalesOrderRows: () => mockRows(),
}));
jest.mock('../../hooks/use-order-bank-refunds', () => ({
  ...jest.requireActual('../../hooks/use-order-bank-refunds'),
  useOrderBankRefunds: () => mockBankRefunds(),
}));
jest.mock('@/components/table/table-cells/product-thumbnail-cell', () => ({
  ProductThumbnailCell: () => null,
}));
jest.mock('dayjs', () => ({
  __esModule: true,
  default: jest.requireActual('dayjs'),
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import OrderTable, { BusinessTimelineModal } from './index';

const row = { orderId: 'order-1', orderNo: 'A-100' } as OrderLineRow;

const link = (at: string): SalesOrderBusinessTimelineItemDto => ({
  id: 'link-1',
  relationName: 'opened_cancellation',
  direction: 'outbound',
  source: { type: 'sales_order', id: 'order-1', externalRef: null },
  target: { type: 'wallet_refund', id: 'refund-1', externalRef: null },
  linkedEntity: { type: 'wallet_refund', id: 'refund-1', externalRef: null },
  metadata: { note: '환불 접수 메모' },
  occurredAt: at,
  createdAt: at,
});

const operation = (
  fields: Partial<SalesOrderShipmentOperationDto>
): SalesOrderShipmentOperationDto => ({
  operationId: 'op-1',
  type: 'split',
  status: 'completed',
  shipmentIds: ['8f772b52-43a1-4826-90ec-8981411c7466'],
  fulfillmentOrderId: 'fo-77',
  otherOrdersInBox: false,
  reasonCode: 'customer_ship_first',
  reason: '[가림]',
  requestChannel: 'kakao',
  note: '고객 요청 메모',
  operatorId: 'user-1',
  createdAt: '2026-11-01T02:00:00Z',
  completedAt: '2026-11-01T02:00:01Z',
  ...fields,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockOrder.mockReturnValue({
    isLoading: false,
    data: {
      businessTimeline: [
        link('2026-11-01T01:00:00Z'),
        { ...link('2026-11-01T03:00:00Z'), id: 'link-2' },
      ],
    },
  });
  mockOperationsHook.mockReturnValue({
    data: {
      salesOrderId: 'order-1',
      items: [operation({ otherOrdersInBox: true })],
    },
  });
});

describe('주문 행의 계좌 대기 안내', () => {
  it.each(['cancelled', 'confirmed'])(
    '전체·부분 취소(%s)는 계좌 상자가 기존 송금 할 일을 대신한다',
    (orderStatus) => {
      const order: OrderLineRow = {
        ...row,
        rowId: 'row-1',
        rowSeq: 1,
        lineId: 'line-1',
        lineIndex: 1,
        orderLineCount: 1,
        isFirstOfOrder: true,
        channelOrderId: 'channel-1',
        orderDate: '',
        channel: 'medusa',
        orderStatus,
        memoLoaded: true,
        walletIntentId: 'pi-1',
        variantId: 'v-1',
        productName: '상품',
        quantity: 1,
        isMatched: true,
        isDirect: false,
        shipmentPhase: null,
        lines: [],
        cancelRequest: {
          id: 'req-1',
          status: 'settling',
          scope: 'partial',
          convertedFromFull: false,
          requestedAt: '',
          rejection: null,
          outcome: null,
          refundMode: 'manual',
          lines: [],
          settlement: {
            requestId: 'req-1',
            phase: 'delayed',
            mode: 'manual',
            confirmedAt: '2026-11-16T01:00:00Z',
            startedAt: undefined,
            deadlineAt: '2026-11-19T01:00:00Z',
            lastFailure: null,
            marketRequest: false,
          },
        },
      };
      const bankRefund: RefundDto = {
        id: 'rf-1',
        intentId: 'pi-1',
        chargeId: 'ch-1',
        paymentMethodType: 'BANK_TRANSFER',
        status: 'PENDING',
        execution: 'MANUAL',
        amount: 1000,
        currency: 'KRW',
        manualConfirmable: true,
        reasonCode: null,
        reasonMessage: null,
        createdAt: '',
      };
      mockRows.mockReturnValue({
        data: { items: [order] },
        total: 1,
        lineTotal: 1,
        pageCount: 1,
      });
      mockBankRefunds.mockReturnValue({ data: [bankRefund] });
      const client = new QueryClient();
      const view = render(
        <QueryClientProvider client={client}>
          <OrderTable />
        </QueryClientProvider>
      );

      expect(screen.getByText('환불 계좌 필요')).toBeTruthy();
      expect(screen.queryByRole('link', { name: '환불 내역 보기' })).toBeNull();
      expect(
        screen.getByRole('button', { name: '직접 송금했어요' })
      ).toBeTruthy();
      if (orderStatus === 'cancelled')
        expect(screen.getByText('주문 취소됨')).toBeTruthy();

      mockBankRefunds.mockReturnValue({ data: [] });
      mockRows.mockReturnValue({
        data: {
          items: [
            {
              ...order,
              refundStatus: 'manual_pending',
              manualReason: 'NO_WALLET_INTENT',
            },
          ],
        },
        total: 1,
        lineTotal: 1,
        pageCount: 1,
      });
      view.rerender(
        <QueryClientProvider client={client}>
          <OrderTable />
        </QueryClientProvider>
      );

      expect(screen.queryByText('환불 계좌 필요')).toBeNull();
      expect(screen.getByRole('link', { name: '환불 내역 보기' })).toBeTruthy();
      expect(screen.getByText('수동처리 필요')).toBeTruthy();
      if (orderStatus === 'cancelled')
        expect(screen.getByText('취소됨')).toBeTruthy();
    }
  );
});

describe('주문 이력 창의 상자 작업', () => {
  it('닫혀 있으면 상자 작업 조회를 켜지 않고 열면 켠다', () => {
    const { rerender } = render(
      <BusinessTimelineModal
        order={row}
        open={false}
        onOpenChange={jest.fn()}
      />
    );
    expect(mockOperationsHook).toHaveBeenLastCalledWith('order-1', {
      enabled: false,
    });

    rerender(
      <BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />
    );
    expect(mockOperationsHook).toHaveBeenLastCalledWith('order-1', {
      enabled: true,
    });
  });

  it('연결 기록과 상자 작업을 시각 순으로 한 목록에 보이고 상자 링크·합포장 표시를 단다', () => {
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('상자 분할');
    expect(text).toContain('고객이 일부 먼저 보내 달라고 요청');
    expect(text).toContain('카카오 상담 · 김관리');
    expect(text).toContain('고객 요청 메모');
    expect(text).toContain('합포장 상자');
    expect(text).toContain('상자 8f772b52');

    const anchor = Array.from(document.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('상자 8f772b52')
    );
    expect(anchor?.getAttribute('href')).toBe(
      '/order/fulfillments/fo-77?shipmentId=8f772b52-43a1-4826-90ec-8981411c7466'
    );

    const notes = text.indexOf('환불 접수 메모');
    const box = text.indexOf('상자 분할');
    expect(notes).toBeGreaterThan(-1);
    expect(notes).toBeLessThan(box);
    expect(text.lastIndexOf('환불 접수 메모')).toBeGreaterThan(box);
  });

  it('화면에 영어 코드가 보이지 않는다', () => {
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    const text = (document.body.textContent ?? '').replace(
      /8f772b52|order-1|refund-1/g,
      ''
    );
    expect(text).not.toMatch(/[a-z]+_[a-z_]+/);
  });

  it('상자 번호만 있고 출고 주문을 모르면 링크 없이 번호만 보인다', () => {
    mockOperationsHook.mockReturnValue({
      data: {
        salesOrderId: 'order-1',
        items: [operation({ fulfillmentOrderId: null })],
      },
    });
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    expect(document.body.textContent).toContain('상자 8f772b52');
    expect(
      Array.from(document.querySelectorAll('a')).some((a) =>
        a.textContent?.includes('상자 8f772b52')
      )
    ).toBe(false);
  });

  it('상자 작업만 있어도 빈 안내를 띄우지 않는다', () => {
    mockOrder.mockReturnValue({
      isLoading: false,
      data: { businessTimeline: [] },
    });
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('아직 기록된 업무 이력이 없습니다');
    expect(text).toContain('상자 분할');
  });

  it('상자마다 자기 상자를 여는 주소로 연결한다', () => {
    mockOperationsHook.mockReturnValue({
      data: {
        salesOrderId: 'order-1',
        items: [
          operation({
            shipmentIds: ['aaaaaaaa-1111', 'bbbbbbbb-2222'],
          }),
        ],
      },
    });
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    const hrefOf = (label: string) =>
      Array.from(document.querySelectorAll('a'))
        .find((a) => a.textContent?.includes(label))
        ?.getAttribute('href');
    expect(hrefOf('상자 aaaaaaaa')).toBe(
      '/order/fulfillments/fo-77?shipmentId=aaaaaaaa-1111'
    );
    expect(hrefOf('상자 bbbbbbbb')).toBe(
      '/order/fulfillments/fo-77?shipmentId=bbbbbbbb-2222'
    );
  });

  it('상자 작업 조회가 실패하면 안내와 다시 불러오기를 보이고 빈 안내는 없다', () => {
    const refetch = jest.fn();
    mockOrder.mockReturnValue({
      isLoading: false,
      data: { businessTimeline: [] },
    });
    mockOperationsHook.mockReturnValue({
      data: undefined,
      isError: true,
      refetch,
    });
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('상자 작업 기록을 불러오지 못했어요.');
    expect(text).not.toContain('아직 기록된 업무 이력이 없습니다');

    fireEvent.click(
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('다시 불러오기')
      ) as HTMLButtonElement
    );
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('상자 작업 조회가 실패해도 연결 기록은 그대로 보인다', () => {
    mockOperationsHook.mockReturnValue({
      data: undefined,
      isError: true,
      refetch: jest.fn(),
    });
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('환불 접수 메모');
    expect(text).toContain('상자 작업 기록을 불러오지 못했어요.');
  });

  it('상자 작업을 불러오는 동안에는 불러오는 중으로 보인다', () => {
    mockOperationsHook.mockReturnValue({ data: undefined, isLoading: true });
    render(<BusinessTimelineModal order={row} open onOpenChange={jest.fn()} />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('불러오는 중');
    expect(text).not.toContain('아직 기록된 업무 이력이 없습니다');
  });
});

describe('주문 목록 조회 실패', () => {
  const renderTable = () =>
    render(
      <QueryClientProvider client={new QueryClient()}>
        <OrderTable />
      </QueryClientProvider>
    );

  beforeEach(() => {
    mockBankRefunds.mockReturnValue({ data: [] });
  });

  it('실패하면 빈 목록이라고 하지 않고 다시 시도를 준다', () => {
    const refetchList = jest.fn();
    mockRows.mockReturnValue({
      data: { items: [] },
      total: 0,
      lineTotal: 0,
      pageCount: 0,
      listFailed: true,
      listRetrying: false,
      refetchList,
    });
    renderTable();

    expect(screen.getByRole('alert').textContent).toContain(
      '주문 목록을 불러오지 못했어요.'
    );
    expect(screen.getByText('주문을 불러오지 못했어요.')).toBeTruthy();
    expect(screen.queryByText(/이 조건에 맞는 주문이 없어요/)).toBeNull();
    expect(screen.queryByText(/"검색" 버튼을 눌러/)).toBeNull();
    expect(document.body.textContent).toContain('총 주문 -건');
    expect(document.body.textContent).not.toContain('전체 0건');

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));

    expect(refetchList).toHaveBeenCalledTimes(1);
  });

  it('다시 불러오는 동안에도 실패 안내를 두고 단추만 막는다', () => {
    mockRows.mockReturnValue({
      data: { items: [] },
      total: 0,
      lineTotal: 0,
      pageCount: 0,
      listFailed: true,
      listRetrying: true,
      refetchList: jest.fn(),
    });
    renderTable();

    expect(screen.getByRole('alert')).toBeTruthy();
    expect(
      (
        screen.getByRole('button', {
          name: '다시 불러오는 중…',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });

  it('성공했는데 비었으면 지금 조건에 맞는 주문이 없다고 한다', () => {
    mockRows.mockReturnValue({
      data: { items: [] },
      total: 0,
      lineTotal: 0,
      pageCount: 0,
      listFailed: false,
    });
    renderTable();

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText('이 조건에 맞는 주문이 없어요.')).toBeTruthy();
    expect(document.body.textContent).toContain('총 주문 0건');
  });

  it('주소에 남은 쪽이 지금 결과보다 뒤면 마지막 쪽으로 옮긴다', () => {
    mockPage = 3;
    mockSetPage.mockClear();
    mockRows.mockReturnValue({
      data: { items: [] },
      total: 60,
      lineTotal: 60,
      pageCount: 2,
      listFailed: false,
      listSettled: true,
    });
    try {
      renderTable();

      expect(mockSetPage).toHaveBeenCalledWith(1);
    } finally {
      mockPage = 0;
    }
  });

  it('지금 조건의 목록을 받는 중이면 앞 결과의 쪽 수로 옮기지 않는다', () => {
    mockPage = 4;
    mockSetPage.mockClear();
    mockRows.mockReturnValue({
      data: { items: [] },
      total: 60,
      lineTotal: 60,
      pageCount: 2,
      listFailed: false,
      listSettled: false,
    });
    try {
      renderTable();

      expect(mockSetPage).not.toHaveBeenCalled();
    } finally {
      mockPage = 0;
    }
  });

  it('결과가 없으면 첫 쪽으로 돌아간다', () => {
    mockPage = 4;
    mockSetPage.mockClear();
    mockRows.mockReturnValue({
      data: { items: [] },
      total: 0,
      lineTotal: 0,
      pageCount: 0,
      listFailed: false,
      listSettled: true,
    });
    try {
      renderTable();

      expect(mockSetPage).toHaveBeenCalledWith(0);
    } finally {
      mockPage = 0;
    }
  });
});
