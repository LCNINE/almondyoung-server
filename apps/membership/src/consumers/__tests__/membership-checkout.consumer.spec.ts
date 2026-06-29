import { MembershipCheckoutConsumer } from '../membership-checkout.consumer';
import { SubscriptionService } from '../../services/subscription.service';
import { ActiveSubscriptionExistsException } from '../../shared/exceptions/subscription.exceptions';

describe('MembershipCheckoutConsumer', () => {
  let consumer: MembershipCheckoutConsumer;
  const confirmCheckoutIntent = jest.fn();

  beforeEach(() => {
    confirmCheckoutIntent.mockReset();
    consumer = new MembershipCheckoutConsumer({ confirmCheckoutIntent } as unknown as SubscriptionService);
  });

  it('멤버십 결제가 아니면 무시한다', async () => {
    await consumer.onIntentCaptured({ intentId: 'i1', metadata: { type: 'ORDER' } });
    expect(confirmCheckoutIntent).not.toHaveBeenCalled();
  });

  it('metadata 가 없으면 무시한다', async () => {
    await consumer.onIntentCaptured({ intentId: 'i1', metadata: null });
    expect(confirmCheckoutIntent).not.toHaveBeenCalled();
  });

  it('멤버십 결제면 구독 생성을 호출한다', async () => {
    confirmCheckoutIntent.mockResolvedValue({ contractId: 'c1' });
    await consumer.onIntentCaptured({ intentId: 'i1', metadata: { type: 'MEMBERSHIP_FEE' } });
    expect(confirmCheckoutIntent).toHaveBeenCalledWith('i1');
  });

  it('이미 구독이 있으면 멱등하게 스킵한다', async () => {
    confirmCheckoutIntent.mockRejectedValue(new ActiveSubscriptionExistsException());
    await expect(
      consumer.onIntentCaptured({ intentId: 'i1', metadata: { type: 'MEMBERSHIP_FEE' } }),
    ).resolves.toBeUndefined();
  });

  it('그 외 에러는 재던진다(재시도/DLQ 대상)', async () => {
    confirmCheckoutIntent.mockRejectedValue(new Error('boom'));
    await expect(
      consumer.onIntentCaptured({ intentId: 'i1', metadata: { type: 'MEMBERSHIP_FEE' } }),
    ).rejects.toThrow('boom');
  });
});
