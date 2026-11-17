/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { OrderFulfillmentSection } from './order-fulfillment-section';
import { salesOrderStatusLabel } from './order-status-label';

const mockShipments = jest.fn();
let mockPermissions: string[] = [];

jest.mock('@/lib/services/orders/queries', () => ({
  useFulfillmentShipments: (...args: unknown[]) => mockShipments(...args),
}));

let mockGateStatus: 'ready' | 'loading' | 'error' = 'ready';

jest.mock('@/features/main/read-gate', () => ({
  useReadGate: (anyOf: readonly string[]) => {
    const allowed = anyOf.some((p) => mockPermissions.includes(p));
    const ready = mockGateStatus === 'ready';
    return {
      enabled: ready && allowed,
      pending: mockGateStatus === 'loading',
      failed: mockGateStatus === 'error',
      hiddenReason: ready && !allowed ? 'x' : null,
    };
  },
}));

jest.mock('next/dynamic', () => ({
  __esModule: true,
  default: () =>
    function TimelineStub({
      order,
    }: {
      order: { orderId: string; orderNo: string };
    }) {
      return (
        <div>
          이력 창 {order.orderId} {order.orderNo}
        </div>
      );
    },
}));

const fo = { id: 'fo-1', status: 'shipped' };

beforeEach(() => {
  mockShipments.mockReset();
  mockGateStatus = 'ready';
  mockPermissions = ['fulfillment.order.read', 'fulfillment.shipment.read'];
  mockShipments.mockReturnValue({
    data: [
      { id: 'aaaaaaaa-1111', status: 'shipped' },
      { id: 'bbbbbbbb-2222', status: 'superseded' },
    ],
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  });
});

it('출고주문과 상자로 바로 가는 링크를 보이고 쓰지 않는 상자는 뺀다', () => {
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
    />
  );

  expect(mockShipments).toHaveBeenCalledWith('fo-1', { enabled: true });
  expect(screen.getByText('출고완료')).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '출고주문 상세' }).getAttribute('href')
  ).toBe('/order/fulfillments/fo-1');
  const box = screen.getByRole('link', { name: /상자 aaaaaaaa · 출고 완료/ });
  expect(box.getAttribute('href')).toBe(
    '/order/fulfillments/fo-1?shipmentId=aaaaaaaa-1111'
  );
  expect(screen.queryByText(/bbbbbbbb/)).toBeNull();
});

it('주문 이력 보기를 누르면 이 주문의 이력 창을 연다', () => {
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
    />
  );
  expect(screen.queryByText(/이력 창/)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '주문 이력 보기' }));

  expect(screen.getByText('이력 창 so-1 AY-1')).toBeTruthy();
});

it('출고주문이 없으면 없다고 보인다', () => {
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={null}
    />
  );

  expect(screen.getByText('아직 출고주문이 없어요.')).toBeTruthy();
  expect(mockShipments).not.toHaveBeenCalled();
});

it('창고 상품이 없는 주문은 출고주문이 생길 것처럼 말하지 않는다', () => {
  mockPermissions = ['fulfillment.order.read', 'order.order.read'];
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={null}
      lineRouteCounts={{ warehouse: 0, outsourced: 1, digital: 1 }}
    />
  );

  expect(
    screen.getByText('창고에서 내보낼 상품이 없는 주문이에요.')
  ).toBeTruthy();
  expect(screen.queryByText('아직 출고주문이 없어요.')).toBeNull();
  expect(
    screen.getByText(/인쇄소가 고객에게 바로 보내요\. 진행은 아래/)
  ).toBeTruthy();
  expect(screen.getByText(/디지털 상품은 배송 없이/)).toBeTruthy();
});

it('인쇄 정보를 볼 권한이 없으면 인쇄 정보로 안내하지 않는다', () => {
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={null}
      lineRouteCounts={{ warehouse: 0, outsourced: 1, digital: 0 }}
    />
  );

  expect(screen.getByText(/인쇄소가 고객에게 바로 보내요/)).toBeTruthy();
  expect(screen.queryByText(/진행은 아래/)).toBeNull();
});

it('창고 상품이 있는데 출고주문이 없으면 아직 없다고 보인다', () => {
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={null}
      lineRouteCounts={{ warehouse: 1, outsourced: 0, digital: 0 }}
    />
  );

  expect(screen.getByText('아직 출고주문이 없어요.')).toBeTruthy();
  expect(screen.queryByRole('listitem')).toBeNull();
});

it('출고주문이 있어도 거기 들어가지 않는 인쇄 상품을 알린다', () => {
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
      lineRouteCounts={{ warehouse: 1, outsourced: 1, digital: 0 }}
    />
  );

  expect(screen.getByRole('link', { name: '출고주문 상세' })).toBeTruthy();
  expect(screen.getByText(/인쇄 상품은 출고주문에 들어가지 않고/)).toBeTruthy();
  expect(screen.queryByText(/디지털 상품/)).toBeNull();
});

it('출고주문을 싣지 않는 옛 응답이면 없다고 단정하지 않는다', () => {
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={undefined}
    />
  );

  expect(screen.queryByText('아직 출고주문이 없어요.')).toBeNull();
  expect(screen.getByRole('button', { name: '주문 이력 보기' })).toBeTruthy();
});

it('상자를 불러오지 못하면 다시 시도할 수 있다', () => {
  const refetch = jest.fn();
  mockShipments.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch,
  });
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(refetch).toHaveBeenCalled();
});

it('출고주문 권한이 없으면 링크 대신 이유를 보인다', () => {
  mockPermissions = [];
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
    />
  );

  expect(screen.getByText('출고주문을 볼 권한이 없어요.')).toBeTruthy();
  expect(screen.queryByRole('link', { name: '출고주문 상세' })).toBeNull();
});

it('상자 권한이 없으면 상자를 조회하지 않는다', () => {
  mockPermissions = ['fulfillment.order.read'];
  render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
    />
  );

  expect(mockShipments).toHaveBeenCalledWith('fo-1', { enabled: false });
  expect(screen.queryByRole('link', { name: /상자/ })).toBeNull();
});

it('주문상태는 결제 대기가 아니라 접수로 읽는다', () => {
  expect(salesOrderStatusLabel('pending')).toBe('접수');
  expect(salesOrderStatusLabel('cancelled')).toBe('취소');
  expect(salesOrderStatusLabel('새값')).toBe('새값');
  expect(salesOrderStatusLabel(undefined)).toBe('-');
});

it('권한을 확인하는 중이거나 확인하지 못하면 권한이 없다고 단정하지 않는다', () => {
  mockGateStatus = 'loading';
  const { rerender } = render(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
    />
  );
  expect(screen.queryByText('출고주문을 볼 권한이 없어요.')).toBeNull();

  mockGateStatus = 'error';
  rerender(
    <OrderFulfillmentSection
      orderId="so-1"
      orderNo="AY-1"
      fulfillmentOrder={fo}
    />
  );
  expect(screen.queryByText('출고주문을 볼 권한이 없어요.')).toBeNull();
  expect(screen.getByText(/권한을 확인하지 못해/)).toBeTruthy();
});
