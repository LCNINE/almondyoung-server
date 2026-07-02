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
});
