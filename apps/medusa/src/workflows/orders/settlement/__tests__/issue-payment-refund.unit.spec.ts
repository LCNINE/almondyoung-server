const run = jest.fn();
jest.mock('@medusajs/medusa/core-flows', () => ({ refundPaymentWorkflow: jest.fn(() => ({ run })) }));

import { issuePaymentRefund } from '../issue-payment-refund';

/**
 * 정산의 환불 한 번(#1016 36번 재설계 §6.2·§6.3). 결제 잠금 안이라 투영이 돌고 있지 않다 — 그래서 매 시도의 첫 쓰기가
 * 표식 셋을 모두 이번 시도의 값으로 맞춘다. 앞 시도가 죽으며 남긴 표식이 이번 환불을 바꾸지 못하게.
 */
describe('issuePaymentRefund — 표식 정규화', () => {
  const makeContainer = (data: Record<string, unknown>) => {
    const payment = {
      retrievePayment: jest.fn().mockResolvedValue({ id: 'pay_1', data }),
      updatePayment: jest.fn().mockResolvedValue({}),
    };
    const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
    // Medusa 컨테이너 키는 문자열 토큰이다: Modules.PAYMENT='payment', ContainerRegistrationKeys.LOGGER='logger'
    const container = { resolve: jest.fn((key: string) => (key === 'payment' ? payment : logger)) } as any;
    return { container, payment, logger };
  };
  const input = (mode: 'auto' | 'manual') => ({ paymentId: 'pay_1', amount: 3000, note: 'channel-cancel:o1', mode });

  beforeEach(() => run.mockReset());

  it('자동 시도는 남은 수동 표식(같은 금액)을 null 로 지우고 쓴다 — 앞 시도가 죽으며 남긴 표식이 MANUAL 로 새지 않게', async () => {
    const { container, payment } = makeContainer({ intentId: 'i1', manualRefund: { requestId: 'channel-cancel:o1', amount: 3000 } });
    run.mockResolvedValue({});
    await issuePaymentRefund(container, input('auto'));
    expect(payment.updatePayment.mock.calls[0][0]).toEqual({
      id: 'pay_1',
      data: {
        intentId: 'i1',
        refundAttempt: { note: 'channel-cancel:o1', amount: 3000 },
        externalRefund: null,
        manualRefund: null,
      },
    });
  });

  it('남은 외부 환불 표식도 null 로 — 있으면 provider 가 wallet 을 건너뛰고 나가지 않은 환불을 장부에 넣는다', async () => {
    const { container, payment } = makeContainer({ intentId: 'i1', externalRefund: { walletRefundId: 'wr9', amount: 3000 } });
    run.mockResolvedValue({});
    await issuePaymentRefund(container, input('auto'));
    expect(payment.updatePayment.mock.calls[0][0].data).toEqual(expect.objectContaining({ externalRefund: null, manualRefund: null }));
  });

  it('수동 시도는 수동 표식을 이번 메모·금액으로 쓴다', async () => {
    const { container, payment } = makeContainer({ intentId: 'i1', externalRefund: { walletRefundId: 'wr9', amount: 3000 } });
    run.mockResolvedValue({});
    await issuePaymentRefund(container, input('manual'));
    expect(payment.updatePayment.mock.calls[0][0].data).toEqual({
      intentId: 'i1',
      refundAttempt: { note: 'channel-cancel:o1', amount: 3000 },
      externalRefund: null,
      manualRefund: { requestId: 'channel-cancel:o1', amount: 3000 },
    });
  });

  it('수동 시도가 실패하면 수동 표식을 지우고 원래 오류를 던진다', async () => {
    const { container, payment } = makeContainer({ intentId: 'i1' });
    const original = new Error('wallet 502');
    run.mockRejectedValue(original);
    await expect(issuePaymentRefund(container, input('manual'))).rejects.toBe(original);
    expect(payment.updatePayment).toHaveBeenLastCalledWith({ id: 'pay_1', data: { manualRefund: null } });
  });

  it('실패 뒤 표식 지우기가 실패해도 원래 오류를 던진다 — 지우기 실패는 로그로 남긴다', async () => {
    const { container, payment, logger } = makeContainer({ intentId: 'i1' });
    const original = new Error('wallet 502');
    run.mockRejectedValue(original);
    payment.updatePayment.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('db down'));
    await expect(issuePaymentRefund(container, input('manual'))).rejects.toBe(original);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('db down'));
  });
});
