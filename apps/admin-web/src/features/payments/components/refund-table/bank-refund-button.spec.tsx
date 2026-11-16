/** @jest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BankRefundButton, BankRefundForm } from './bank-refund-button';
import type { RefundDto } from '@/lib/types/dto/wallet';

import { walletApi } from '@/lib/api/domains/wallet';
import { toast } from 'sonner';
import { listBankRefunds } from './bank-refund';
import { Dialog, DialogContent } from '@/components/ui/dialog';

const mutate = jest.fn();
const confirm = jest.fn();
const useQueryMock = jest.fn();
let allowed = true;
let pending = false;
jest.mock('@/lib/services/wallet', () => ({
  useConfirmRefund: () => ({ mutate: confirm, isPending: false }),
  useExecuteBankRefund: () => ({ mutate, isPending: pending }),
  walletQueryKeys: { refundList: (query: unknown) => ['refunds', query] },
}));
jest.mock('@/lib/api/domains/wallet', () => ({
  walletApi: { listRefunds: jest.fn() },
}));
jest.mock('@tanstack/react-query', () => ({
  useQuery: (...args: unknown[]) => useQueryMock(...args),
}));
jest.mock('@/hooks/use-permission', () => ({
  usePermissionCheck: () => ({ can: () => allowed, canRun: () => allowed }),
}));
jest.mock('@/components/auth/can', () => ({
  Can: ({ children }: { children: React.ReactNode }) =>
    allowed ? children : null,
}));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const refund: RefundDto = {
  id: 'rf-1',
  intentId: 'pi-1',
  chargeId: 'ch-1',
  status: 'PENDING',
  execution: 'MANUAL',
  amount: 1000,
  currency: 'KRW',
  reasonCode: 'MEDUSA_REFUND',
  reasonMessage: null,
  createdAt: new Date().toISOString(),
  manualConfirmable: true,
  paymentMethodType: 'BANK_TRANSFER',
  refundReceiveAccount: {
    bank: '06',
    accountNumber: '1234567890',
    holderName: '테스트',
  },
};

afterEach(() => {
  jest.useRealTimers();
});

beforeEach(() => {
  jest.clearAllMocks();
  mutate.mockReset();
  allowed = true;
  pending = false;
  useQueryMock.mockReturnValue({
    data: [refund],
    isLoading: false,
  });
});

it('저장 계좌를 기본값으로 쓰고 기존 환불 한 건만 실행한다', async () => {
  const user = userEvent.setup();
  render(<BankRefundButton refund={refund} />);
  await user.click(screen.getByRole('button', { name: '계좌로 환불' }));

  expect((screen.getByLabelText('환불 은행') as HTMLSelectElement).value).toBe(
    '06'
  );
  expect(
    (screen.getByLabelText('환불 계좌번호') as HTMLInputElement).value
  ).toBe('1234567890');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '계좌로 환불',
    })
  );
  expect(mutate).toHaveBeenCalledWith(
    {
      refundId: 'rf-1',
      intentId: 'pi-1',
      account: refund.refundReceiveAccount,
    },
    expect.anything()
  );
});

it('마스킹된 계좌를 숫자로 오인해 보내지 않고 새 입력을 받는다', async () => {
  const user = userEvent.setup();
  render(
    <BankRefundButton
      refund={{
        ...refund,
        refundReceiveAccount: {
          bank: '06',
          accountNumber: '12****90',
          holderName: '테*트',
        },
      }}
    />
  );
  await user.click(screen.getByRole('button', { name: '계좌로 환불' }));

  expect(
    (screen.getByLabelText('환불 계좌번호') as HTMLInputElement).value
  ).toBe('');
  expect((screen.getByLabelText('예금주명') as HTMLInputElement).value).toBe(
    ''
  );
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '계좌로 환불',
    })
  );
  expect(mutate).not.toHaveBeenCalled();
  await user.type(screen.getByLabelText('환불 계좌번호'), '123-456');
  await user.type(screen.getByLabelText('예금주명'), '홍길동');
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: '계좌로 환불',
    })
  );
  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({
      account: { bank: '06', accountNumber: '123456', holderName: '홍길동' },
    }),
    expect.anything()
  );
});

it.each([
  { execution: 'AUTO' as const },
  { status: 'SUCCEEDED' },
  { paymentMethodType: 'TOSS' },
  { status: 'FAILED', failureCode: 'INVALID_REFUND_ACCOUNT_INFO' },
])('대상이 아니면 버튼을 숨긴다: %s', (fields) => {
  render(<BankRefundButton refund={{ ...refund, ...fields }} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('권한이 없으면 실행 버튼을 숨긴다', () => {
  allowed = false;
  render(<BankRefundButton refund={refund} />);
  expect(screen.queryByRole('button')).toBeNull();
});

it('결과 불명인 환불은 같은 계좌 재확인을 안내한다', async () => {
  const user = userEvent.setup();
  render(
    <BankRefundButton
      refund={{
        ...refund,
        status: 'FAILED',
        execution: 'AUTO',
        failureCode: 'PROVIDER_EXCEPTION',
      }}
    />
  );
  await user.click(screen.getByRole('button', { name: '계좌로 환불' }));
  expect(screen.getByText(/이전 요청과 같은 계좌/)).toBeTruthy();
});

it('환불 행이 없으면 1.5초 간격으로 5회 확인한 뒤 안내하고 닫는다', async () => {
  jest.useFakeTimers();
  useQueryMock.mockReturnValue({ data: [] });
  jest
    .mocked(walletApi.listRefunds)
    .mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });
  const close = jest.fn();
  render(
    <Dialog open>
      <DialogContent>
        <BankRefundForm
          intentId="pi-1"
          savedAccount={refund.refundReceiveAccount}
          onClose={close}
        />
      </DialogContent>
    </Dialog>
  );
  fireEvent.click(screen.getByRole('button', { name: '계좌로 환불' }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });

  expect(walletApi.listRefunds).toHaveBeenCalledTimes(5);
  expect(toast.info).toHaveBeenCalledWith(
    '환불을 준비하고 있어요. 잠시 뒤 주문내역에서 다시 눌러 주세요.'
  );
  expect(close).toHaveBeenCalledTimes(1);
  expect(mutate).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it('재조회에 새 환불이 도착하면 이전 부분 환불을 제외하고 새 건을 실행한다', async () => {
  jest.useFakeTimers();
  useQueryMock.mockReturnValue({ data: [] });
  jest
    .mocked(walletApi.listRefunds)
    .mockReset()
    .mockResolvedValueOnce({ data: [refund], total: 1, page: 1, limit: 100 })
    .mockResolvedValue({
      data: [refund, { ...refund, id: 'rf-2' }],
      total: 2,
      page: 1,
      limit: 100,
    });
  render(
    <Dialog open>
      <DialogContent>
        <BankRefundForm
          intentId="pi-1"
          excludedRefundIds={['rf-1']}
          savedAccount={refund.refundReceiveAccount}
          onClose={jest.fn()}
        />
      </DialogContent>
    </Dialog>
  );
  fireEvent.click(screen.getByRole('button', { name: '계좌로 환불' }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1500);
  });

  expect(mutate).toHaveBeenCalledWith(
    expect.objectContaining({ refundId: 'rf-2' }),
    expect.anything()
  );
  jest.useRealTimers();
});

it('직접 송금은 확인 한 번 뒤 기존 완료 처리 경로를 쓴다', async () => {
  const user = userEvent.setup();
  render(<BankRefundButton refund={refund} />);
  await user.click(screen.getByRole('button', { name: '계좌로 환불' }));
  await user.click(screen.getByRole('button', { name: '직접 송금했어요' }));
  expect(confirm).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: '송금 완료 확인' }));
  expect(confirm).toHaveBeenCalledWith(
    { refundId: 'rf-1', intentId: 'pi-1' },
    expect.anything()
  );
});

it('재시도 중 닫으면 환불을 실행하지 않는다', async () => {
  jest.useFakeTimers();
  useQueryMock.mockReturnValue({ data: [] });
  jest
    .mocked(walletApi.listRefunds)
    .mockResolvedValue({ data: [], total: 0, page: 1, limit: 100 });
  const view = render(
    <Dialog open>
      <DialogContent>
        <BankRefundForm
          intentId="pi-1"
          savedAccount={refund.refundReceiveAccount}
          onClose={jest.fn()}
        />
      </DialogContent>
    </Dialog>
  );
  fireEvent.click(screen.getByRole('button', { name: '계좌로 환불' }));
  await act(async () => {
    await jest.advanceTimersByTimeAsync(0);
  });
  view.unmount();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(6000);
  });
  expect(mutate).not.toHaveBeenCalled();
  jest.useRealTimers();
});

it('묶음 조회는 다음 페이지까지 읽고 다른 결제수단을 제외한다', async () => {
  jest
    .mocked(walletApi.listRefunds)
    .mockReset()
    .mockResolvedValueOnce({
      data: [{ ...refund, paymentMethodType: 'TOSS' }],
      total: 2,
      page: 1,
      limit: 100,
    })
    .mockResolvedValueOnce({ data: [refund], total: 2, page: 2, limit: 100 });

  expect(await listBankRefunds({ intentIds: ['pi-1', 'pi-2'] })).toEqual([
    refund,
  ]);
  expect(walletApi.listRefunds).toHaveBeenNthCalledWith(2, {
    intentIds: ['pi-1', 'pi-2'],
    page: 2,
    limit: 100,
  });
});

it('총 개수가 남아 있어도 빈 페이지면 묶음 조회를 멈춘다', async () => {
  jest
    .mocked(walletApi.listRefunds)
    .mockReset()
    .mockResolvedValueOnce({ data: [refund], total: 2, page: 1, limit: 100 })
    .mockResolvedValueOnce({ data: [], total: 2, page: 2, limit: 100 });

  expect(await listBankRefunds({ intentIds: ['pi-1'] })).toEqual([refund]);
  expect(walletApi.listRefunds).toHaveBeenCalledTimes(2);
});

it('다음 페이지 조회가 실패하면 불완전한 목록을 성공으로 반환하지 않는다', async () => {
  jest
    .mocked(walletApi.listRefunds)
    .mockReset()
    .mockResolvedValueOnce({ data: [refund], total: 2, page: 1, limit: 100 })
    .mockRejectedValueOnce(new Error('unavailable'));

  await expect(listBankRefunds({ intentIds: ['pi-1'] })).rejects.toThrow(
    'unavailable'
  );
});
