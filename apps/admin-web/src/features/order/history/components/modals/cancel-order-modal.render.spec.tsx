/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { CancelOrderModal } from './cancel-order-modal';

const mutateAsync = jest.fn();
const getPaymentDetailMock = jest.fn();

jest.mock(
  '@/features/payments/components/refund-table/bank-refund-button',
  () => ({
    BankRefundForm: ({ intentId }: { intentId: string }) => (
      <div>
        <h2>주문을 취소했어요</h2>
        <button data-intent={intentId}>계좌로 환불</button>
      </div>
    ),
  })
);

jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ can: () => true }),
}));
jest.mock('@/lib/api/domains/wallet', () => ({
  walletApi: {
    getPaymentIntentDetail: (...args: unknown[]) =>
      getPaymentDetailMock(...args),
  },
}));
jest.mock('@/lib/services/orders', () => ({
  useAdminCancelSalesOrder: () => ({ mutateAsync, isPending: false }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/api/server-error', () => ({
  getServerDenyMessage: (_e: unknown, fallback: string) => fallback,
}));
jest.mock('@/lib/api/domains/orders/cancel-request.shape', () => ({
  cancelRequestToast: () => '취소했습니다. 환불은 채널이 처리합니다.',
  isCancelRequested: (value: object) => 'requestId' in value,
}));

const ORDER = {
  orderId: 'so-1',
  orderNo: 'A-1',
  walletIntentId: 'intent-1',
  channel: 'medusa',
  orderStatus: 'confirmed',
  lines: [{ id: 'l1', quantity: 2, productName: '상품', optionName: null }],
} as never;

function renderModal() {
  return render(
    <CancelOrderModal order={ORDER} open onOpenChange={jest.fn()} />
  );
}

describe('CancelOrderModal 요청 경로', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mutateAsync.mockReset();
    getPaymentDetailMock.mockResolvedValue({
      id: 'intent-1',
      refunds: [],
      paymentMethod: { type: 'TOSS' },
    });
    mutateAsync.mockResolvedValue({ refundStatus: 'succeeded' });
  });

  it.each(['전체', '부분'])(
    '무통장 %s 취소 성공은 토스트 없이 같은 창에서 계좌 입력으로 바뀐다',
    async (scope) => {
      mutateAsync.mockResolvedValue({ requestId: 'req-1' });
      getPaymentDetailMock.mockResolvedValue({
        id: 'intent-1',
        refunds: [],
        paymentMethod: { type: 'BANK_TRANSFER' },
      });
      const user = userEvent.setup();
      const onOpenChange = jest.fn();
      render(
        <CancelOrderModal order={ORDER} open onOpenChange={onOpenChange} />
      );
      if (scope === '부분')
        await user.click(screen.getByRole('button', { name: '부분 취소' }));
      await user.click(screen.getByRole('radio', { name: '전화' }));
      await user.click(
        screen.getByRole('button', { name: `${scope} 취소 실행` })
      );

      expect(await screen.findByText('주문을 취소했어요')).toBeTruthy();
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(
        screen
          .getByRole('button', { name: '계좌로 환불' })
          .getAttribute('data-intent')
      ).toBe('intent-1');
      expect(toast.success).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(mutateAsync.mock.calls[0][0].body).not.toHaveProperty(
        'refundReceiveAccount'
      );
    }
  );

  it('카드 취소는 기존 토스트를 띄우고 닫는다', async () => {
    mutateAsync.mockResolvedValue({ requestId: 'req-1' });
    const user = userEvent.setup();
    const onOpenChange = jest.fn();
    render(<CancelOrderModal order={ORDER} open onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.click(screen.getByRole('button', { name: '전체 취소 실행' }));

    expect(toast.success).toHaveBeenCalledWith(
      '취소했습니다. 환불은 채널이 처리합니다.'
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('주문을 취소했어요')).toBeNull();
  });

  it('core 정산의 manual_pending은 기존 환불 결정 안내를 유지한다', async () => {
    mutateAsync.mockResolvedValue({ refundStatus: 'manual_pending' });
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.click(screen.getByRole('button', { name: '전체 취소 실행' }));

    expect(
      await screen.findByText('주문 취소 완료 · 환불 결정 필요')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: '계좌로 환불' })).toBeNull();
  });

  it('경로를 고르기 전에 취소를 누르면 안내가 뜨고 요청은 나가지 않는다', async () => {
    const user = userEvent.setup();
    renderModal();
    expect(
      screen.getByRole('radio', { name: '전화' }).getAttribute('aria-checked')
    ).toBe('false');
    await user.click(screen.getByRole('button', { name: '전체 취소 실행' }));
    expect(screen.getByRole('alert').textContent).toBe(
      '고객이 요청한 경로를 골라 주세요.'
    );
    expect(mutateAsync).not.toHaveBeenCalled();
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.click(screen.getByRole('button', { name: '전체 취소 실행' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].body.requestChannel).toBe('phone');
  });

  it('전화를 고르면 본문에 requestChannel 이 실린다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.click(screen.getByRole('button', { name: '전체 취소 실행' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    expect(mutateAsync.mock.calls[0][0].body).toMatchObject({
      reasonCode: 'CUSTOMER_REQUEST',
      requestChannel: 'phone',
    });
  });

  it('다른 사유로 바꾸면 경로 칸이 사라지고 본문에 키가 없다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.selectOptions(screen.getByRole('combobox'), 'OUT_OF_STOCK');
    expect(screen.queryByRole('radio', { name: '전화' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '전체 취소 실행' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const body = mutateAsync.mock.calls[0][0].body;
    expect(body.reasonCode).toBe('OUT_OF_STOCK');
    expect('requestChannel' in body).toBe(false);
  });

  it('고객 요청으로 돌아오면 경로가 비어 있다', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.click(screen.getByRole('radio', { name: '전화' }));
    await user.selectOptions(screen.getByRole('combobox'), 'OUT_OF_STOCK');
    await user.selectOptions(screen.getByRole('combobox'), 'CUSTOMER_REQUEST');
    expect(
      screen.getByRole('radio', { name: '전화' }).getAttribute('aria-checked')
    ).toBe('false');
  });
});
