/**
 * @jest-environment jsdom
 */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { RefundDto } from '@/lib/types/dto/wallet';
import type { SettlementView } from '@/lib/api/domains/orders/cancel-request.shape';

const mockListRefunds = jest.fn();
const mockConfirmRefund = jest.fn();
const mockPermission = jest.fn();

jest.mock('@/lib/api/domains/wallet', () => ({
  walletApi: {
    listRefunds: (q: unknown) => mockListRefunds(q),
    confirmRefund: (id: string) => mockConfirmRefund(id),
  },
}));
jest.mock('@/hooks/use-permission', () => ({
  useCan: () => mockPermission(),
  useCanOpen: () => mockPermission(),
  useCanRun: () => mockPermission(),
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

import { PendingTransfers } from './pending-transfers';
import { StageBand } from './stage-band';
import { ManualRefundTodo } from '@/features/order/cancel-settlement/manual-refund-todo';

const NOW = new Date('2026-11-16T03:00:00.000Z');

const refund = (over: Partial<RefundDto> = {}): RefundDto => ({
  id: 'rf-1',
  chargeId: 'ch-1',
  intentId: 'pi-1',
  status: 'PENDING',
  amount: 12000,
  currency: 'KRW',
  reasonCode: null,
  reasonMessage: null,
  kind: 'ITEM_CANCEL',
  createdAt: '2026-11-16T01:00:00.000Z',
  manualConfirmable: true,
  execution: 'MANUAL',
  ...over,
});

const page = (rows: RefundDto[], total = rows.length) => ({
  data: rows,
  total,
  page: 1,
  limit: 100,
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockListRefunds.mockReset();
  mockConfirmRefund.mockReset();
  mockPermission.mockReturnValue({ status: 'ready', allowed: true });
});

describe('정체 보드 «송금 대기 환불»', () => {
  it('사람이 닫을 대기 환불만 보이고, 그 결제·환불 내역으로 간다', async () => {
    mockListRefunds.mockResolvedValue(
      page([
        refund(),
        refund({ id: 'rf-card', manualConfirmable: false, execution: 'AUTO' }),
      ])
    );
    renderWithClient(<PendingTransfers now={NOW} />);

    expect(await screen.findByText('송금 대기 환불 1건')).toBeTruthy();
    expect(mockListRefunds).toHaveBeenCalledWith({
      status: 'PENDING',
      page: 1,
      limit: 100,
    });
    expect(screen.getByText('12,000원')).toBeTruthy();
    expect(screen.getByText('2시간 전 접수')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '결제 보기' }).getAttribute('href')
    ).toBe('/payments/pi-1');
    expect(
      screen.getByRole('link', { name: '환불 내역' }).getAttribute('href')
    ).toBe('/payments/refunds?intentId=pi-1');
  });

  it('[완료 처리]를 하면 목록을 다시 읽어 그 환불이 빠진다', async () => {
    mockListRefunds
      .mockResolvedValueOnce(page([refund()]))
      .mockResolvedValue(page([]));
    mockConfirmRefund.mockResolvedValue(
      refund({ status: 'SUCCEEDED', manualConfirmable: false })
    );
    renderWithClient(<PendingTransfers now={NOW} />);

    fireEvent.click(await screen.findByRole('button', { name: '완료 처리' }));
    await act(async () => {
      fireEvent.click(
        await screen.findByRole('button', { name: '송금 완료 확인' })
      );
    });

    await waitFor(() =>
      expect(screen.queryByText('송금 대기 환불 1건')).toBeNull()
    );
    expect(mockConfirmRefund).toHaveBeenCalledWith('rf-1');
    expect(mockListRefunds).toHaveBeenCalledTimes(2);
  });

  it('보드가 열린 동안 1분마다 다시 읽어, 취소가 반영되며 생긴 송금 대기를 보인다', async () => {
    jest.useFakeTimers();
    try {
      mockListRefunds
        .mockResolvedValueOnce(page([]))
        .mockResolvedValue(page([refund()]));
      renderWithClient(<PendingTransfers now={NOW} />);
      await waitFor(() => expect(mockListRefunds).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('송금 대기 환불 1건')).toBeNull();

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });
      expect(await screen.findByText('송금 대기 환불 1건')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('조회 권한이 없으면 부르지 않고 이유를 보인다', async () => {
    mockPermission.mockReturnValue({ status: 'ready', allowed: false });
    renderWithClient(<PendingTransfers now={NOW} />);

    expect(
      screen.getByText(/송금 대기 환불 · .*권한이 있어야 보입니다/)
    ).toBeTruthy();
    expect(mockListRefunds).not.toHaveBeenCalled();
  });

  it('불러오지 못하면 없는 것으로 숨기지 않고 다시 확인을 준다', async () => {
    mockListRefunds
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue(page([refund()]));
    renderWithClient(<PendingTransfers now={NOW} />);

    fireEvent.click(await screen.findByRole('button', { name: '다시 확인' }));
    expect(await screen.findByText('송금 대기 환불 1건')).toBeTruthy();
  });

  it('대기 환불이 한 번에 읽는 수보다 많으면 환불 내역으로 이어 준다', async () => {
    mockListRefunds.mockResolvedValue(page([refund()], 101));
    renderWithClient(<PendingTransfers now={NOW} />);

    const more = await screen.findByRole('link', {
      name: /대기 환불이 더 있습니다/,
    });
    expect(more.getAttribute('href')).toBe('/payments/refunds?status=PENDING');
  });

  it('송금 대기가 없으면 아무것도 그리지 않는다', async () => {
    mockListRefunds.mockResolvedValue(
      page([refund({ manualConfirmable: false })])
    );
    const { container } = renderWithClient(<PendingTransfers now={NOW} />);
    await waitFor(() => expect(mockListRefunds).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('위쪽 띠의 덧붙인 줄', () => {
  it('취소 요청 칸이 0 이어도 송금 대기가 있으면 흐리게 두지 않고 그 수를 보인다', () => {
    render(
      <StageBand
        cells={[
          {
            key: 'cancel_request',
            open: 0,
            stuck: 0,
            gaveUp: 0,
            oldestAt: null,
          },
        ]}
        selected="accept"
        onSelect={() => {}}
        now={NOW}
        notes={{ cancel_request: '송금 대기 2' }}
      />
    );
    const card = screen.getByText('송금 대기 2').closest('button');
    expect(card?.className).not.toContain('opacity-50');
  });
});

describe('계좌 송금으로 바꾼 행의 할 일', () => {
  const manual: SettlementView = {
    requestId: 'r1',
    phase: 'delayed',
    mode: 'manual',
    confirmedAt: '2026-11-16T01:00:00.000Z',
    startedAt: '2026-11-16T02:00:00.000Z',
    deadlineAt: '2026-11-19T01:00:00.000Z',
    lastFailure: null,
    marketRequest: false,
  };

  it('할 일과 그 결제의 환불 내역 링크', () => {
    render(<ManualRefundTodo settlement={manual} walletIntentId="pi-9" />);
    expect(
      screen.getByText(/고객 계좌로 송금한 뒤 \[완료 처리\]/)
    ).toBeTruthy();
    expect(
      screen.getByRole('link', { name: '환불 내역 보기' }).getAttribute('href')
    ).toBe('/payments/refunds?intentId=pi-9');
  });

  it('자동 정산 행에는 그리지 않는다', () => {
    const { container } = render(
      <ManualRefundTodo
        settlement={{ ...manual, mode: 'auto' }}
        walletIntentId="pi-9"
      />
    );
    expect(container.textContent).toBe('');
  });
});
