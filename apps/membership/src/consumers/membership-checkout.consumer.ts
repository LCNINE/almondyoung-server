import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { SubscriptionService } from '../services/subscription.service';
import { ActiveSubscriptionExistsException } from '../shared/exceptions/subscription.exceptions';

interface CapturedEventPayload {
  intentId: string;
  metadata?: { type?: string } | null;
}

/**
 * 무통장입금 멤버십 신규가입 보정 컨슈머.
 *
 * 카드 결제는 결제 즉시 intent 가 AUTHORIZED/CAPTURED 라 storefront 의 동기
 * confirm-checkout-intent 호출로 구독이 생성된다. 하지만 무통장입금은 결제 시점에
 * intent 가 AWAITING_DEPOSIT 에 머물러 그 동기 호출이 실패한다. 입금확인은 나중에
 * admin 이 처리하며 이때 payment.intent.captured 가 발행되므로, 그 이벤트를 받아
 * 멤버십 건이면 동일한 구독 생성 로직을 비동기로 마저 처리한다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class MembershipCheckoutConsumer {
  private readonly logger = new Logger(MembershipCheckoutConsumer.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  @OnEvent('payments.events.v1', 'payment.intent.captured')
  async onIntentCaptured(@EventPayload() payload: CapturedEventPayload) {
    if (payload.metadata?.type !== 'MEMBERSHIP_FEE') return;

    this.logger.log(`[MembershipCheckout] CAPTURED 멤버십 결제 감지: intentId=${payload.intentId}`);

    try {
      await this.subscriptionService.confirmCheckoutIntent(payload.intentId);
      this.logger.log(`[MembershipCheckout] 구독 생성 완료: intentId=${payload.intentId}`);
    } catch (err) {
      // 이미 구독이 있으면(동기 경로가 먼저 처리했거나 이벤트 중복) 멱등 처리.
      if (err instanceof ActiveSubscriptionExistsException) {
        this.logger.log(`[MembershipCheckout] 이미 구독 존재, 스킵: intentId=${payload.intentId}`);
        return;
      }
      throw err;
    }
  }
}
