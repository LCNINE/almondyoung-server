import { ArrearsPaymentConsumer } from '../arrears-payment.consumer';
import { ArrearsRepaymentService } from '../../services/arrears/arrears-repayment.service';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';
import type { EventPayloadOf } from '@packages/event-contracts/types';

type IntentCapturedPayload = EventPayloadOf<typeof PAYMENT_STREAM, 'payment.intent.captured'>;

function capturedPayload(overrides: Partial<IntentCapturedPayload>): IntentCapturedPayload {
  return {
    intentId: 'i1',
    userId: 'u1',
    status: 'CAPTURED',
    payableAmount: 4990,
    currency: 'KRW',
    occurredAt: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('ArrearsPaymentConsumer', () => {
  const settleFromCapturedIntent = jest.fn();
  let consumer: ArrearsPaymentConsumer;

  beforeEach(() => {
    settleFromCapturedIntent.mockReset().mockResolvedValue(undefined);
    consumer = new ArrearsPaymentConsumer({ settleFromCapturedIntent } as unknown as ArrearsRepaymentService);
  });

  it('미수 청산 결제면 청산을 부른다', async () => {
    await consumer.onIntentCaptured(
      capturedPayload({ metadata: { type: 'MEMBERSHIP_FEE', membershipPaymentKind: 'ARREARS' } }),
    );
    expect(settleFromCapturedIntent).toHaveBeenCalledWith('i1');
  });

  it('가입 결제는 건드리지 않는다', async () => {
    await consumer.onIntentCaptured(capturedPayload({ metadata: { type: 'MEMBERSHIP_FEE', planId: 'p1' } }));
    expect(settleFromCapturedIntent).not.toHaveBeenCalled();
  });

  it('metadata 가 없으면 무시한다', async () => {
    await consumer.onIntentCaptured(capturedPayload({ metadata: null }));
    expect(settleFromCapturedIntent).not.toHaveBeenCalled();
  });
});
