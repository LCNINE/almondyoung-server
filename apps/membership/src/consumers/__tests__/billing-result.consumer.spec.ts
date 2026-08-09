import { BillingResultConsumer } from '../billing-result.consumer';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';
import type { EventPayloadOf } from '@packages/event-contracts/types';

type IntentCanceledPayload = EventPayloadOf<typeof PAYMENT_STREAM, 'payment.intent.canceled'>;

/**
 * 계약이 요구하는 공통 필드를 채운다. 이 테스트가 보는 것은 subscriberType/subscriberRef 라우팅뿐이지만,
 * payload 타입을 계약에서 도출한 뒤로는 나머지 필드도 실제 발행 형태를 갖춰야 한다 — 예전 로컬
 * 인터페이스가 느슨해서 3필드 stub 이 통과했을 뿐이다 (ADR-0029 §4).
 */
function intentPayload(overrides: Partial<IntentCanceledPayload>): IntentCanceledPayload {
  return {
    intentId: 'intent-0',
    userId: 'user-1',
    status: 'CANCELED',
    payableAmount: 4990,
    currency: 'KRW',
    occurredAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  };
}

function makeConsumer() {
  const billingOutcomeHandler = {
    handleSuccess: jest.fn().mockResolvedValue(undefined),
    handleFailure: jest.fn().mockResolvedValue(undefined),
    handleCanceled: jest.fn().mockResolvedValue(undefined),
  };
  const consumer = new BillingResultConsumer(billingOutcomeHandler as never);
  return { consumer, billingOutcomeHandler };
}

describe('BillingResultConsumer.onIntentCanceled', () => {
  it('멤버십 정기결제 취소 이벤트면 handleCanceled 로 선점을 해제한다', async () => {
    const { consumer, billingOutcomeHandler } = makeConsumer();
    await consumer.onIntentCanceled(
      intentPayload({ intentId: 'intent-1', subscriberType: 'MEMBERSHIP', subscriberRef: 'contract-1' }),
    );
    expect(billingOutcomeHandler.handleCanceled).toHaveBeenCalledWith('contract-1', 'intent-1');
  });

  it('subscriberType 이 MEMBERSHIP 이 아니거나 subscriberRef 가 없으면 무시한다', async () => {
    const { consumer, billingOutcomeHandler } = makeConsumer();
    await consumer.onIntentCanceled(
      intentPayload({ intentId: 'intent-2', subscriberType: 'ORDER', subscriberRef: 'x' }),
    );
    await consumer.onIntentCanceled(intentPayload({ intentId: 'intent-3', subscriberType: 'MEMBERSHIP' }));
    expect(billingOutcomeHandler.handleCanceled).not.toHaveBeenCalled();
  });
});
