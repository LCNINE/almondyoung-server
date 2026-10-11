import { TossPaymentProvider } from './toss.provider';
import { TossBillingProvider } from './toss-billing.provider';
import { TossApiClient } from './toss-api.client';
import { PaymentProvider, RefundParams } from '../payment-provider.interface';

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

const refusing = (code: string, message = '거절') =>
  ({ cancelPayment: jest.fn().mockResolvedValue({ ok: false, error: { code, message }, statusCode: 400 }) }) as unknown as TossApiClient;

const refundParams = (): RefundParams => ({
  refundId: 'rf-1',
  chargeId: 'ch-1',
  intentId: 'in-1',
  userId: 'u-1',
  amount: 5000,
  currency: 'KRW',
  idempotencyKey: 'wallet:refund:rf-1',
  correlationId: 'c-1',
});

describe.each<[string, (db: never, api: TossApiClient) => PaymentProvider, string]>([
  ['TossPaymentProvider', (db, api) => new TossPaymentProvider(db, api), 'TOSS_PAYMENT_KEY_NOT_FOUND'],
  ['TossBillingProvider', (db, api) => new TossBillingProvider(db, api, null as never), 'TOSS_BILLING_PAYMENT_KEY_NOT_FOUND'],
])('%s.refund — 실패 분류', (_name, make, missingKeyCode) => {
  it('토스 영구 오류는 retryable=false, 코드·메시지는 그대로', async () => {
    const provider = make(dbWithCharge({ providerTransactionId: 'pk_1' }), refusing('ALREADY_CANCELED_PAYMENT', '이미 취소된 결제 입니다.'));
    expect(await provider.refund(refundParams())).toEqual({
      status: 'FAILED',
      errorCode: 'ALREADY_CANCELED_PAYMENT',
      errorMessage: '이미 취소된 결제 입니다.',
      retryable: false,
    });
  });

  it('토스 일시 오류·모르는 코드는 retryable=true', async () => {
    const transient = make(dbWithCharge({ providerTransactionId: 'pk_1' }), refusing('PROVIDER_ERROR'));
    expect(await transient.refund(refundParams())).toMatchObject({ status: 'FAILED', retryable: true });
    const unknown = make(dbWithCharge({ providerTransactionId: 'pk_1' }), refusing('BRAND_NEW_CODE'));
    expect(await unknown.refund(refundParams())).toMatchObject({ status: 'FAILED', retryable: true });
  });

  it('결제 키가 없으면 토스를 못 부른다 — retryable=false', async () => {
    const api = refusing('UNUSED');
    const provider = make(dbWithCharge({ providerTransactionId: null }), api);
    expect(await provider.refund(refundParams())).toEqual({ status: 'FAILED', errorCode: missingKeyCode, retryable: false });
  });
});
