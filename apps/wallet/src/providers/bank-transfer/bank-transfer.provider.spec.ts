import { BankTransferPaymentProvider } from './bank-transfer.provider';
import { TossApiClient } from '../toss/toss-api.client';
import { ChargeParams } from '../payment-provider.interface';

describe('BankTransferPaymentProvider', () => {
  it('declares offline-wait action mode (deposit is not a short interactive redirect)', () => {
    const provider = new BankTransferPaymentProvider(null as never, null as never);
    expect(provider.actionMode).toBe('offline-wait');
    expect(provider.providerType).toBe('BANK_TRANSFER');
  });

  const chargeParams = (): ChargeParams => ({
    chargeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    intentId: 'i1',
    paymentMethodId: 'm1',
    userId: 'u1',
    amount: 10000,
    currency: 'KRW',
    idempotencyKey: 'k1',
    correlationId: 'c1',
    metadata: { orderName: '테스트주문', customerName: '홍길동' },
  });

  it('issues a Toss virtual account and maps it into BANK_TRANSFER_PENDING nextAction', async () => {
    process.env.TOSS_VIRTUAL_ACCOUNT_BANK = '04';
    process.env.TOSS_VIRTUAL_ACCOUNT_BANK_NAME = '국민은행';
    const issueVirtualAccount = jest.fn().mockResolvedValue({
      ok: true,
      data: {
        paymentKey: 'pk_1',
        orderId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee',
        status: 'WAITING_FOR_DEPOSIT',
        totalAmount: 10000,
        secret: 'sk_1',
        virtualAccount: { accountType: '일반', accountNumber: '1234567890', bankCode: '04', customerName: '홍길동', dueDate: '2026-07-05T00:00:00+09:00' },
      },
    });
    const provider = new BankTransferPaymentProvider(null as never, { issueVirtualAccount } as unknown as TossApiClient);

    const result = await provider.authorize(chargeParams());

    // orderId 는 chargeId 하이픈 제거값이어야 웹훅 복원이 성립한다.
    expect(issueVirtualAccount).toHaveBeenCalledWith(expect.objectContaining({ orderId: 'aaaaaaaabbbbccccddddeeeeeeeeeeee', bank: '04', amount: 10000 }));
    expect(result.status).toBe('REQUIRES_ACTION');
    expect(result.providerTransactionId).toBe('pk_1');
    expect(result.nextAction).toMatchObject({ type: 'BANK_TRANSFER_PENDING', bankName: '국민은행', accountNumber: '1234567890' });
  });

  it('fails clearly when the issuing bank is not configured', async () => {
    delete process.env.TOSS_VIRTUAL_ACCOUNT_BANK;
    const provider = new BankTransferPaymentProvider(null as never, {} as unknown as TossApiClient);
    const result = await provider.authorize(chargeParams());
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('BANK_TRANSFER_BANK_NOT_CONFIGURED');
  });

  /** charge 한 건을 돌려주는 최소 DbService 스텁 (getPaymentKey 조회용). */
  const dbWithCharge = (row: Record<string, unknown> | undefined) =>
    ({
      db: {
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
          }),
        }),
      },
    }) as never;

  it('closes the Toss virtual account when the charge is canceled', async () => {
    const cancelPayment = jest.fn().mockResolvedValue({ ok: true, data: {} });
    const provider = new BankTransferPaymentProvider(
      dbWithCharge({ providerTransactionId: null, responsePayload: { paymentKey: 'pk_1' } }),
      { cancelPayment } as unknown as TossApiClient,
    );

    const result = await provider.cancel(chargeParams());

    // 계좌를 닫지 않으면 고객이 옛 계좌로 입금해 돈만 들어오고 주문이 안 생긴다.
    expect(cancelPayment).toHaveBeenCalledWith('pk_1', '결제 취소', undefined, 'cancel:k1');
    expect(result.status).toBe('SUCCEEDED');
  });

  it('fails the cancel when Toss refuses to close the account', async () => {
    const cancelPayment = jest.fn().mockResolvedValue({ ok: false, error: { code: 'ALREADY_DEPOSITED', message: '입금 완료' } });
    const provider = new BankTransferPaymentProvider(
      dbWithCharge({ providerTransactionId: null, responsePayload: { paymentKey: 'pk_1' } }),
      { cancelPayment } as unknown as TossApiClient,
    );

    // 실패를 SUCCEEDED 로 삼키면 살아있는 계좌가 취소된 것처럼 기록된다.
    const result = await provider.cancel(chargeParams());
    expect(result.status).toBe('FAILED');
    expect(result.errorCode).toBe('ALREADY_DEPOSITED');
  });

  it('succeeds without calling Toss when no account was ever issued', async () => {
    const cancelPayment = jest.fn();
    const provider = new BankTransferPaymentProvider(dbWithCharge(undefined), {
      cancelPayment,
    } as unknown as TossApiClient);

    const result = await provider.cancel(chargeParams());
    expect(cancelPayment).not.toHaveBeenCalled();
    expect(result.status).toBe('SUCCEEDED');
  });

  it('환불을 토스가 영구 거절하면(계좌·예금주 불일치) retryable=false', async () => {
    const cancelPayment = jest.fn().mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_REFUND_ACCOUNT_INFO', message: '환불 계좌번호와 예금주명이 일치하지 않습니다.' },
      statusCode: 400,
    });
    const provider = new BankTransferPaymentProvider(
      dbWithCharge({ providerTransactionId: null, responsePayload: { paymentKey: 'pk_1' } }),
      { cancelPayment } as unknown as TossApiClient,
    );

    const result = await provider.refund({
      refundId: 'rf-1',
      chargeId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      intentId: 'i1',
      userId: 'u1',
      amount: 10000,
      currency: 'KRW',
      idempotencyKey: 'k1',
      correlationId: 'c1',
      refundReceiveAccount: { bank: '06', accountNumber: '1234567890', holderName: '홍길동' },
    });

    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'INVALID_REFUND_ACCOUNT_INFO', retryable: false });
  });

  it('환불계좌가 없으면 PG 를 부르지 않고 «수동 송금» PENDING — manualTransfer 로 표시한다', async () => {
    const cancelPayment = jest.fn();
    const provider = new BankTransferPaymentProvider(
      dbWithCharge({ providerTransactionId: null, responsePayload: { paymentKey: 'pk_1' } }),
      { cancelPayment } as unknown as TossApiClient,
    );

    const result = await provider.refund({
      refundId: 'rf-1',
      chargeId: 'ch-1',
      intentId: 'in-1',
      userId: 'u-1',
      amount: 1000,
      currency: 'KRW',
      idempotencyKey: 'wallet:refund:rf-1',
      correlationId: 'c-1',
    });

    expect(result).toEqual({ status: 'PENDING', manualTransfer: true });
    expect(cancelPayment).not.toHaveBeenCalled();
  });

  it('paymentKey 스냅샷이 없는 옛 건도 같은 폴백 — manualTransfer', async () => {
    const cancelPayment = jest.fn();
    const provider = new BankTransferPaymentProvider(dbWithCharge(undefined), {
      cancelPayment,
    } as unknown as TossApiClient);

    const result = await provider.refund({
      refundId: 'rf-2',
      chargeId: 'ch-2',
      intentId: 'in-2',
      userId: 'u-2',
      amount: 1000,
      currency: 'KRW',
      idempotencyKey: 'wallet:refund:rf-2',
      correlationId: 'c-2',
      refundReceiveAccount: { bank: '06', accountNumber: '1234567890', holderName: '홍길동' },
    });

    expect(result).toEqual({ status: 'PENDING', manualTransfer: true });
    expect(cancelPayment).not.toHaveBeenCalled();
  });
});
