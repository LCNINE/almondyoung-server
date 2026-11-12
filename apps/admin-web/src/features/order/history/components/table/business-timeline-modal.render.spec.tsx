/**
 * @jest-environment jsdom
 */
import { fireEvent, render } from '@testing-library/react';
import type {
  SalesOrderBusinessTimelineItemDto,
  SalesOrderShipmentOperationDto,
} from '@/lib/types/dto/orders';
import type { OrderLineRow } from '../../hooks/use-order-rows';

const mockOperationsHook = jest.fn();
const mockOrder = jest.fn();

jest.mock('@/lib/services/orders', () => ({
  useSalesOrder: (id: string) => mockOrder(id),
  useSalesOrderAmendments: () => ({ data: [], isError: false }),
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
  MergedDataTable: () => null,
}));
jest.mock('@/components/admin-ui-experimental/common/table/table', () => ({
  Table: () => null,
}));
jest.mock('@/features/order/cancel-settlement/settlement-actions', () => ({
  SettlementActions: () => null,
}));
jest.mock('../purchase-satisfaction-section', () => ({
  PurchaseSatisfactionSection: () => null,
}));
jest.mock('@/hooks/use-permission', () => ({
  useCan: () => ({ status: 'ready', allowed: true }),
  usePermissionCheck: () => ({ can: () => true }),
}));
jest.mock('../../contexts/filter.context', () => ({
  useOrderHistoryFilter: () => ({}),
}));
jest.mock('../../hooks/use-order-rows', () => ({
  useSalesOrderRows: () => ({}),
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

import { BusinessTimelineModal } from './index';

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
