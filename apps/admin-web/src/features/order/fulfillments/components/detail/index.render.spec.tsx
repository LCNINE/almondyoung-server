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

describe('출고주문 상세 머리 정보', () => {
  it('내부 번호·영어 값 없이 주문번호·쇼핑몰·수량·상자를 보인다', () => {
    mockOrder.mockReturnValue({
      data: {
        ...order(null),
        id: '5713b78b-a6e3-4237-81c5-706ed0cf0faf',
        salesOrderId: '9e3a8c1d-0000-4000-8000-000000000001',
        displayOrderNo: '6275',
        salesChannel: 'medusa',
        warehouseName: '샘플 창고',
        totalItems: 2,
        totalQty: 3,
        totalReservedQty: 2,
        shipments: [
          {
            id: 'ship-1',
            status: 'draft',
            manifestVersion: 1,
            reservationVersion: 1,
            shippingProfileId: null,
            qty: 3,
            reservedQty: 2,
          },
        ],
        progress: {
          status: 'ready',
          totalQty: 3,
          shippedQty: 0,
          canceledQty: 0,
          outstandingQty: 3,
          confirmedReservedQty: 2,
          items: [],
        },
        items: [
          {
            id: 'item-1',
            skuId: 'sku-1',
            skuCode: 'SAMPLE-RED',
            skuName: '샘플 상품 (빨강)',
            qty: 3,
            reservedQty: 2,
            pickedQty: 0,
            shippedQty: 0,
            status: 'partially_reserved',
          },
        ] as unknown as FulfillmentOrderDetail['items'],
      },
      isLoading: false,
    });

    const { container } = render(<FulfillmentDetail id="fo-1" />);
    const text = container.textContent ?? '';

    for (const expected of [
      '#6275',
      '아몬드영 (자사몰)',
      '2종 · 3개 · 재고 확보 2개',
      '1개',
      '출고 0 · 취소 0 · 남음 3',
      '보낼 상품 (1)',
      '부분 확보',
      '출고 방식',
    ]) {
      expect(text).toContain(expected);
    }
    expect(text).not.toMatch(
      /5713b78b|9e3a8c1d|V2|shipment|SO\)|medusa|partially_reserved|아이템|운영 액션/
    );
  });
});

it('끝난 출고주문은 풀린 재고 확보 수량을 보이지 않는다', () => {
  mockOrder.mockReturnValue({
    data: { ...order(null), status: 'completed', totalReservedQty: 0 },
    isLoading: false,
  });

  const { container } = render(<FulfillmentDetail id="fo-1" />);

  expect(container.textContent).toContain('1종 · 1개');
  expect(container.textContent).not.toContain('재고 확보 0개');
});
