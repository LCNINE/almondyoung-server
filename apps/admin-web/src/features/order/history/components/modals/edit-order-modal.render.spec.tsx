/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import type { OrderLineRow } from '@/features/order/history/hooks/use-order-rows';
import { EditOrderModal } from './edit-order-modal';

function orderOf(overrides: Partial<OrderLineRow>): OrderLineRow {
  return {
    orderId: 'so-a',
    orderNo: 'A-1',
    channelOrderId: 'A-1',
    channel: 'medusa',
    orderStatus: 'pending',
    shipmentPhase: 'preparing',
    isMatched: true,
    receiverName: '받는분 가',
    phone: '010-0000-0001',
    address: '가 주소',
    lines: [
      { id: 'l-a', variantId: 'v-a', productName: '가 상품', quantity: 1 },
    ],
    ...overrides,
  } as OrderLineRow;
}

const ORDER_A = orderOf({});
const ORDER_B = orderOf({
  orderId: 'so-b',
  orderNo: 'B-2',
  channelOrderId: 'B-2',
  receiverName: '받는분 나',
  phone: '010-0000-0002',
  address: '나 주소',
  lines: [{ id: 'l-b', variantId: 'v-b', productName: '나 상품', quantity: 2 }],
});

describe('EditOrderModal', () => {
  it('열린 채로 다른 주문을 받으면 그 주문을 보여 준다', () => {
    const { rerender } = render(
      <EditOrderModal order={ORDER_A} open onOpenChange={jest.fn()} />
    );
    expect(screen.getByText('가 주소')).toBeTruthy();

    rerender(<EditOrderModal order={ORDER_B} open onOpenChange={jest.fn()} />);

    expect(screen.getByText('나 주소')).toBeTruthy();
    expect(screen.getByText('받는분 나')).toBeTruthy();
    expect(screen.getByText('나 상품')).toBeTruthy();
    expect(screen.queryByText('가 주소')).toBeNull();
  });

  it('하는 일에 맞는 제목을 쓰고 개발 메모를 보이지 않는다', () => {
    render(<EditOrderModal order={ORDER_A} open onOpenChange={jest.fn()} />);

    expect(screen.getByRole('heading', { name: '주문 보기' })).toBeTruthy();
    expect(screen.queryByText(/WMS API/)).toBeNull();
    expect(screen.queryByText(/PATCH/)).toBeNull();
  });

  it('주문 상태를 목록과 같은 이름으로 보여 준다', () => {
    render(<EditOrderModal order={ORDER_A} open onOpenChange={jest.fn()} />);

    expect(screen.getByText('준비중')).toBeTruthy();
    expect(screen.queryByText('pending')).toBeNull();
  });

  it('자사몰 비회원 주문을 외부채널 주문이라고 하지 않는다', () => {
    render(<EditOrderModal order={ORDER_A} open onOpenChange={jest.fn()} />);

    expect(
      screen.getByText(/비회원 주문이라 연결된 회원이 없어요/)
    ).toBeTruthy();
    expect(screen.queryByText(/외부채널/)).toBeNull();
  });

  it('수기·기타 주문은 외부 판매처라고 하지 않는다', () => {
    render(
      <EditOrderModal
        order={orderOf({ channel: '3pl' })}
        open
        onOpenChange={jest.fn()}
      />
    );

    expect(
      screen.getByText(/수기·기타 주문이라 연결된 회원이 없어요/)
    ).toBeTruthy();
  });

  it('외부 판매처 주문은 판매처 주문이라고 알려 준다', () => {
    render(
      <EditOrderModal
        order={orderOf({ channel: 'naver' })}
        open
        onOpenChange={jest.fn()}
      />
    );

    expect(
      screen.getByText(/외부 판매처 주문이라 연결된 회원이 없어요/)
    ).toBeTruthy();
  });
});
