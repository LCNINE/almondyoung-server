import { BillingResultConsumer } from '../billing-result.consumer';

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
    await consumer.onIntentCanceled({
      intentId: 'intent-1',
      subscriberType: 'MEMBERSHIP',
      subscriberRef: 'contract-1',
    });
    expect(billingOutcomeHandler.handleCanceled).toHaveBeenCalledWith('contract-1', 'intent-1');
  });

  it('subscriberType 이 MEMBERSHIP 이 아니거나 subscriberRef 가 없으면 무시한다', async () => {
    const { consumer, billingOutcomeHandler } = makeConsumer();
    await consumer.onIntentCanceled({ intentId: 'intent-2', subscriberType: 'ORDER', subscriberRef: 'x' });
    await consumer.onIntentCanceled({ intentId: 'intent-3', subscriberType: 'MEMBERSHIP' });
    expect(billingOutcomeHandler.handleCanceled).not.toHaveBeenCalled();
  });
});
