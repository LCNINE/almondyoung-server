import { PointsPaymentProvider } from './points.provider';
import { RefundParams } from '../payment-provider.interface';

const refundParams = (): RefundParams => ({
  refundId: 'rf-1',
  chargeId: 'cap-1',
  authorizeChargeId: 'auth-1',
  intentId: 'in-1',
  userId: 'u-1',
  amount: 3000,
  currency: 'KRW',
  idempotencyKey: 'wallet:refund:rf-1',
  correlationId: 'c-1',
});

function providerFailingWith(reasonCode: string) {
  const db = { db: { transaction: (fn: (tx: unknown) => unknown) => fn({}) } };
  const ledger = { refund: jest.fn().mockResolvedValue({ resultStatus: 'FAILED', raw: { reasonCode } }) };
  return new PointsPaymentProvider(db as never, ledger as never);
}

describe('PointsPaymentProvider.refund — 실패 분류', () => {
  it('원장에 확정 사용이 없으면(NO_CAPTURED_REDEEM) 영구 — 다시 불러도 같다', async () => {
    expect(await providerFailingWith('NO_CAPTURED_REDEEM').refund(refundParams())).toMatchObject({
      status: 'FAILED',
      errorCode: 'NO_CAPTURED_REDEEM',
      retryable: false,
    });
  });

  it('남은 금액 초과는 경합이라 일시', async () => {
    expect(await providerFailingWith('REFUND_AMOUNT_EXCEEDS_REMAINING').refund(refundParams())).toMatchObject({
      status: 'FAILED',
      errorCode: 'REFUND_AMOUNT_EXCEEDS_REMAINING',
      retryable: true,
    });
  });
});
