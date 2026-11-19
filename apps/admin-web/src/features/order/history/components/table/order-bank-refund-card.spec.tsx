/** @jest-environment jsdom */
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { walletApi } from '@/lib/api/domains/wallet';
import { walletQueryKeys } from '@/lib/services/wallet';
import { OrderBankRefundCard } from './order-bank-refund-card';
import {
  bankRefundsForRow,
  useOrderBankRefunds,
} from '../../hooks/use-order-bank-refunds';
import type { OrderLineRow } from '../../hooks/use-order-rows';
import type { RefundDto } from '@/lib/types/dto/wallet';

jest.mock(
  '@/features/payments/components/refund-table/bank-refund-button',
  () => ({
    BankRefundButton: () => <button>계좌로 환불</button>,
  })
);
jest.mock('@/features/payments/components/refund-table/confirm-cell', () => ({
  RefundConfirmCell: () => <button>직접 송금했어요</button>,
}));
jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ can: () => allowed }),
}));
jest.mock('@/lib/api/domains/wallet', () => ({
  walletApi: { listRefunds: jest.fn() },
}));

let allowed = true;

beforeEach(() => {
  allowed = true;
  jest.mocked(walletApi.listRefunds).mockReset();
});

function queryWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return {
    client,
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}

const refund: RefundDto = {
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
const row: OrderLineRow = {
  rowId: 'row-1',
  rowSeq: 1,
  orderId: 'so-1',
  lineId: 'line-1',
  lineIndex: 1,
  orderLineCount: 1,
  isFirstOfOrder: true,
  orderNo: 'A-1',
  channelOrderId: 'order-1',
  orderDate: '',
  channel: 'medusa',
  cancelRequest: null,
  orderStatus: 'cancelled',
  memoLoaded: true,
  walletIntentId: 'pi-1',
  variantId: 'v-1',
  productName: '상품',
  quantity: 1,
  warehouseCancelPendingQty: 0,
  isMatched: true,
  isDirect: false,
  shipmentPhase: null,
  lines: [],
};

it('무통장 PENDING+MANUAL 행은 계좌 필요 배지와 두 동작을 표시한다', () => {
  expect(bankRefundsForRow(row, [refund])).toEqual([refund]);
  render(<OrderBankRefundCard refund={refund} />);
  expect(screen.getByText('1,000원')).toBeTruthy();
  expect(screen.getByText('환불 계좌 필요')).toBeTruthy();
  expect(screen.getByRole('button', { name: '계좌로 환불' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '직접 송금했어요' })).toBeTruthy();
});

it.each([
  { paymentMethodType: 'TOSS' },
  { execution: 'AUTO' as const },
  { status: 'FAILED' },
  { intentId: 'pi-2' },
])('카드·자동처리·실패·다른 결제는 상자로 바꾸지 않는다: %s', (fields) => {
  expect(bankRefundsForRow(row, [{ ...refund, ...fields }])).toEqual([]);
});

it.each([
  { channel: '3pl' },
  { isFirstOfOrder: false },
  { orderStatus: 'confirmed' },
])('대상 주문만 표시한다: %s', (fields) => {
  expect(bankRefundsForRow({ ...row, ...fields }, [refund])).toEqual([]);
});

it('다른 사유의 manual_pending을 무통장 대기로 간주하지 않는다', () => {
  expect(
    bankRefundsForRow(
      {
        ...row,
        refundStatus: 'manual_pending',
        manualReason: 'NO_WALLET_INTENT',
      },
      []
    )
  ).toEqual([]);
});

it('환불이 끝나면 같은 상자에 완료 배지만 남는다', () => {
  const done = { ...refund, status: 'SUCCEEDED' };
  expect(bankRefundsForRow(row, [done])).toEqual([done]);
  render(<OrderBankRefundCard refund={done} />);
  expect(screen.getByText('환불 완료')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

it('부분 취소로 주문이 살아 있어도 환불 상자를 표시한다', () => {
  expect(
    bankRefundsForRow(
      {
        ...row,
        orderStatus: 'confirmed',
        cancelRequest: {
          id: 'req-1',
          status: 'applied',
          scope: 'partial',
          convertedFromFull: false,
          requestedAt: '',
          rejection: null,
          outcome: null,
          settlement: null,
          refundMode: 'auto',
          lines: [],
        },
      },
      [refund]
    )
  ).toEqual([refund]);
});

it('한 페이지의 결제는 중복 제거한 묶음으로 읽고 페이지를 바꿔도 이전 환불을 섞지 않는다', async () => {
  const second = { ...refund, id: 'rf-2', intentId: 'pi-2' };
  jest.mocked(walletApi.listRefunds).mockResolvedValueOnce({
    data: [refund, second],
    total: 2,
    page: 1,
    limit: 100,
  });
  const { wrapper } = queryWrapper();
  const { result, rerender } = renderHook(
    ({ rows }) => useOrderBankRefunds(rows),
    {
      wrapper,
      initialProps: { rows: [row, row, { ...row, walletIntentId: 'pi-2' }] },
    }
  );

  await waitFor(() => expect(result.current.data).toEqual([refund, second]));
  expect(walletApi.listRefunds).toHaveBeenCalledTimes(1);
  expect(walletApi.listRefunds).toHaveBeenCalledWith({
    intentIds: ['pi-1', 'pi-2'],
    page: 1,
    limit: 100,
  });

  let resolveNext!: (
    value: Awaited<ReturnType<typeof walletApi.listRefunds>>
  ) => void;
  jest.mocked(walletApi.listRefunds).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveNext = resolve;
    })
  );
  rerender({ rows: [{ ...row, walletIntentId: 'pi-3' }] });

  expect(result.current.data).toBeUndefined();
  expect(walletApi.listRefunds).toHaveBeenLastCalledWith({
    intentIds: ['pi-3'],
    page: 1,
    limit: 100,
  });

  const third = { ...refund, id: 'rf-3', intentId: 'pi-3' };
  await act(async () =>
    resolveNext({ data: [third], total: 1, page: 1, limit: 100 })
  );
  await waitFor(() => expect(result.current.data).toEqual([third]));
});

it.each([
  { rows: [], permitted: true },
  { rows: [{ ...row, walletIntentId: null }], permitted: true },
  { rows: [{ ...row, channel: '3pl' }], permitted: true },
  { rows: [row], permitted: false },
])(
  '대상 결제나 조회 권한이 없으면 wallet을 부르지 않는다: %s',
  ({ rows, permitted }) => {
    allowed = permitted;
    const { wrapper } = queryWrapper();
    renderHook(() => useOrderBankRefunds(rows), { wrapper });

    expect(walletApi.listRefunds).not.toHaveBeenCalled();
  }
);

it('완료 처리와 계좌 환불이 무효화하는 환불 목록 키로 묶음도 다시 읽는다', async () => {
  jest
    .mocked(walletApi.listRefunds)
    .mockResolvedValueOnce({ data: [refund], total: 1, page: 1, limit: 100 })
    .mockResolvedValue({
      data: [{ ...refund, status: 'SUCCEEDED' }],
      total: 1,
      page: 1,
      limit: 100,
    });
  const { client, wrapper } = queryWrapper();
  const { result } = renderHook(() => useOrderBankRefunds([row]), { wrapper });

  await waitFor(() => expect(result.current.data?.[0].status).toBe('PENDING'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: walletQueryKeys.refunds() });
  });

  await waitFor(() =>
    expect(result.current.data?.[0].status).toBe('SUCCEEDED')
  );
  expect(walletApi.listRefunds).toHaveBeenCalledTimes(2);
});

it('초기 재조회 뒤 늦게 도착한 환불도 1분 뒤 묶음으로 다시 읽는다', async () => {
  jest.useFakeTimers();
  const { wrapper } = queryWrapper();
  jest.mocked(walletApi.listRefunds).mockResolvedValue({
    data: [],
    total: 0,
    page: 1,
    limit: 100,
  });
  const { result, unmount } = renderHook(() => useOrderBankRefunds([row]), {
    wrapper,
  });

  try {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(6500);
    });

    expect(walletApi.listRefunds).toHaveBeenCalledTimes(5);
    jest.mocked(walletApi.listRefunds).mockResolvedValue({
      data: [refund],
      total: 1,
      page: 1,
      limit: 100,
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(60_000);
    });

    expect(walletApi.listRefunds).toHaveBeenCalledTimes(6);
    await waitFor(() => expect(result.current.data).toEqual([refund]));
  } finally {
    unmount();
    jest.useRealTimers();
  }
});
