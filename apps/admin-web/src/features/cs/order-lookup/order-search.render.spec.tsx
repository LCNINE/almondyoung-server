/**
 * @jest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CsOrderLookup, { CsOrderSearch } from './index';

const mockGetSalesOrders = jest.fn<Promise<unknown>, unknown[]>();
const mockGetSalesOrder = jest.fn<Promise<unknown>, unknown[]>();
let mockSearchParams = '';

jest.mock('@/lib/api/domains', () => ({
  orders: {
    salesOrders: {
      getSalesOrders: (...args: unknown[]) => mockGetSalesOrders(...args),
      getSalesOrder: (...args: unknown[]) => mockGetSalesOrder(...args),
    },
  },
}));
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearchParams),
}));
jest.mock('@/components/auth/can', () => ({
  CanOpen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/lib/services/products', () => ({
  useVariantsBatch: () => ({ data: new Map() }),
}));
jest.mock('@/lib/services/medusa-customers/queries', () => ({
  useMedusaOrderById: () => ({ data: null }),
}));
jest.mock('./order-fulfillment-section', () => ({
  OrderFulfillmentSection: () => null,
}));

function showSearch() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CsOrderSearch />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockSearchParams = '';
  mockGetSalesOrders.mockReset();
  mockGetSalesOrder.mockReset();
  mockGetSalesOrders.mockResolvedValue({
    data: [
      {
        id: 'so-1',
        displayOrderNo: '20261127-1001',
        channelOrderId: 'order_123',
        salesChannel: 'medusa',
        customerName: '주문자',
        customerPhone: '010-0000-1234',
        shippingAddress: JSON.stringify({
          recipientName: '받는분',
          phone: '010-1111-2222',
        }),
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
    totalPages: 1,
  });
});

it.each([
  ['주문번호', 'orderNo', '20261127-1001'],
  ['받는 분', 'receiver', '받는분'],
  ['연락처', 'phone', '2222'],
])('%s로 찾고 CS 상세로 연다', async (label, type, keyword) => {
  showSearch();

  fireEvent.change(screen.getByLabelText('찾을 기준'), {
    target: { value: type },
  });
  fireEvent.change(screen.getByLabelText('검색어'), {
    target: { value: keyword },
  });
  fireEvent.click(screen.getByRole('button', { name: '찾기' }));

  await waitFor(() => {
    expect(mockGetSalesOrders).toHaveBeenCalledWith({
      keyword,
      keywordType: type,
      limit: 20,
      offset: 0,
    });
  });

  const link = await screen.findByRole('link', { name: /20261127-1001/ });
  expect(link.getAttribute('href')).toBe(
    '/cs?orderId=so-1&orderNo=20261127-1001'
  );
  expect(link.textContent).toContain('아몬드영 (자사몰)');
});

it('빈 검색어는 보내지 않고 조회 실패를 다시 시도할 수 있다', async () => {
  mockGetSalesOrders.mockRejectedValueOnce(new Error('offline'));
  showSearch();

  expect(
    screen.getByRole('button', { name: '찾기' }).hasAttribute('disabled')
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('검색어'), {
    target: { value: 'A-1' },
  });
  fireEvent.click(screen.getByRole('button', { name: '찾기' }));

  await screen.findByText('주문을 찾지 못했어요.');
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  await screen.findByRole('link', { name: /20261127-1001/ });
  expect(mockGetSalesOrders).toHaveBeenCalledTimes(2);
});

it('CS 상세에서 주문내역의 조건부 조치와 반품 진행 내역으로 잇는다', async () => {
  mockSearchParams = 'orderId=so-1';
  mockGetSalesOrder.mockResolvedValue({
    id: 'so-1',
    displayOrderNo: '1001',
    channelOrderId: 'order_123',
    orderDate: '2026-11-27T03:00:00.000Z',
    salesChannel: 'medusa',
    status: 'confirmed',
    totalAmount: 1000,
    shippingFee: 0,
    shippingAddress: '{}',
    lines: [],
    fulfillmentOrder: null,
  });

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CsOrderLookup />
    </QueryClientProvider>
  );

  expect(await screen.findByText('아몬드영 (자사몰)')).toBeTruthy();
  expect(
    screen
      .getByRole('link', { name: '주문내역에서 가능한 조치 확인' })
      .getAttribute('href')
  ).toBe('/order/history?orderNo=order_123');
  expect(
    screen
      .getByRole('link', { name: '반품·교환 진행 내역' })
      .getAttribute('href')
  ).toBe('/cs/return-exchange?q=order_123');
  expect(
    screen.getByText(
      '취소·메모·반품 접수는 주문 상태와 권한에 따라 표시됩니다.'
    )
  ).toBeTruthy();
  expect(screen.queryByText('내부 주문 ID')).toBeNull();
});
