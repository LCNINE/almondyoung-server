import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { SubscriptionService } from '../services/subscription.service';
import { SubscriptionContractReader } from '../services/subscription/subscription-contract.reader';
import { RefundEventHandler } from '../services/refund-event-handler.service';

interface RefundEventPayload {
  intentId?: string;
  amount?: number;
  refundId?: string;
  occurredAt?: string;
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

  constructor(
    private readonly subscriptionService: SubscriptionService,
    private readonly contractReader: SubscriptionContractReader,
    private readonly refundEventHandler: RefundEventHandler,
  ) {}

  @OnEvent('payments.events.v1', 'gateway.refund.succeeded')
  async onRefundSucceeded(@EventPayload() payload: RefundEventPayload) {
    if (!payload.intentId) return;

    this.logger.log(`[MembershipRefund] 환불 성공 감지: intentId=${payload.intentId}`);
    await this.subscriptionService.voidByPaymentIntent(payload.intentId, '결제 환불');

    // 환불 완료 기록. 해지 시점에 PENDING(무통장 수동송금 대기)이던 건이 실제로 완료되는 지점이 여기다.
    // 이 기록이 없으면 refund_completed 가 영구히 false 로 남아 미완료 환불을 추적할 수 없다.
    const contract = await this.contractReader.findByPaymentIntentId(payload.intentId);
    if (contract) {
      await this.refundEventHandler.handleRefundCompleted({
        contractId: contract.id,
        userId: contract.userId,
        amount: payload.amount ?? contract.eligibleRefundAmount ?? 0,
        walletTransactionId: payload.refundId ?? payload.intentId,
        completedAt: payload.occurredAt ?? new Date().toISOString(),
      });
    }

    this.logger.log(`[MembershipRefund] 회수 처리 완료(또는 대상 아님): intentId=${payload.intentId}`);
  }
}
