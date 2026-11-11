/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import type { FulfillmentOrderDetail } from '@/lib/types/dto/fulfillment';
import { FulfillmentDetail } from './index';

const mockOrder = jest.fn<
  { data: FulfillmentOrderDetail; isLoading: boolean },
  [string]
>();

jest.mock('@/lib/services/orders/queries', () => ({
  useFulfillmentOrder: (id: string) => mockOrder(id),
}));

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ can: () => true, canRun: () => false }),
}));

jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('@/lib/services/orders/line-composition', () => ({
  useAssignLineComposition: Object.assign(() => ({}), { permission: [] }),
}));

jest.mock('../../detail/inventory-tab', () => ({ InventoryTab: () => null }));
jest.mock('../../detail/shipment-tab', () => ({ ShipmentTab: () => null }));
jest.mock('../../detail/history-tab', () => ({ HistoryTab: () => null }));
jest.mock('../../detail/line-compositions', () => ({
  LineCompositions: () => null,
}));

const order = (
  consolidation: FulfillmentOrderDetail['consolidation']
): FulfillmentOrderDetail => ({
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
  consolidation,
});

describe('출고주문 상세 정보 블록', () => {
  it('상자 링크로 들어오면 배송 탭을 연다', () => {
    mockOrder.mockReturnValue({ data: order(null), isLoading: false });

    render(<FulfillmentDetail id="fo-1" shipmentId="src" />);

    expect(
      screen.getByRole('tab', { name: '배송' }).getAttribute('aria-selected')
    ).toBe('true');
  });

  it('합친 주문이면 상자 줄에 같이 담긴 주문을 보인다', () => {
    mockOrder.mockReturnValue({
      data: order({ state: 'merged', partnerOrderNos: ['6275'] }),
      isLoading: false,
    });

    render(<FulfillmentDetail id="fo-1" />);

    expect(screen.getByText('상자')).toBeTruthy();
    expect(screen.getByText('#6275와 한 상자')).toBeTruthy();
  });

  it('합포장 정보가 없으면 상자 줄을 그리지 않는다', () => {
    mockOrder.mockReturnValue({ data: order(null), isLoading: false });

    render(<FulfillmentDetail id="fo-1" />);

    expect(screen.queryByText('상자')).toBeNull();
  });

  it('수량 줄은 이 주문 기준이라고 밝힌다', () => {
    mockOrder.mockReturnValue({ data: order(null), isLoading: false });

    render(<FulfillmentDetail id="fo-1" />);

    expect(screen.getByText('이 주문 수량')).toBeTruthy();
  });
});
