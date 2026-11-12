/**
 * @jest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CancelOrderModal } from './cancel-order-modal';

const mutateAsync = jest.fn();

jest.mock('@/lib/services/orders', () => ({
  useAdminCancelSalesOrder: () => ({ mutateAsync, isPending: false }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/lib/api/server-error', () => ({
  getServerDenyMessage: (_e: unknown, fallback: string) => fallback,
}));
jest.mock('@/lib/api/domains/orders/cancel-request.shape', () => ({
  cancelRequestToast: () => '',
  isCancelRequested: () => false,
}));

const ORDER = {
  orderId: 'so-1',
  orderNo: 'A-1',
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
    mutateAsync.mockReset();
    mutateAsync.mockResolvedValue({ refundStatus: 'succeeded' });
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
