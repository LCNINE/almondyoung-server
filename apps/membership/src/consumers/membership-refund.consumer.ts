import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { SubscriptionService } from '../services/subscription.service';

interface RefundEventPayload {
  intentId?: string;
}

/**
 * 멤버십 환불 회수 컨슈머 (MembershipCheckoutConsumer 의 역방향).
 *
 * forward(입금확인 → payment.intent.captured → 구독 생성)에 대칭으로, wallet/admin 측에서
 * 직접 시작한 환불(무통장 수동완료 포함)이 발행하는 gateway.refund.succeeded 를 받아
 * 해당 결제 intent 로 생성된 구독을 무효화한다. 멤버십이 먼저 시작한 취소는 이미 CANCELLED 라
 * voidByPaymentIntent 에서 멱등 스킵된다.
 */
@Controller()
@UseInterceptors(EventTypeGuard)
export class MembershipRefundConsumer {
  private readonly logger = new Logger(MembershipRefundConsumer.name);

  constructor(private readonly subscriptionService: SubscriptionService) {}

  @OnEvent('payments.events.v1', 'gateway.refund.succeeded')
  async onRefundSucceeded(@EventPayload() payload: RefundEventPayload) {
    if (!payload.intentId) return;

    this.logger.log(`[MembershipRefund] 환불 성공 감지: intentId=${payload.intentId}`);
    await this.subscriptionService.voidByPaymentIntent(payload.intentId, '결제 환불');
    this.logger.log(`[MembershipRefund] 회수 처리 완료(또는 대상 아님): intentId=${payload.intentId}`);
  }
}
