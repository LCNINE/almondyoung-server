import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { BillingOutcomeHandler } from '../services/billing/billing-outcome.handler';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';
import { EventPayloadOf } from '@packages/event-contracts/types';

interface IntentEventPayload {
  intentId: string;
  payableAmount?: number;
  subscriberRef?: string;
  subscriberType?: string;
  errorCode?: string;
  errorMessage?: string;
}

@Controller()
@UseInterceptors(EventTypeGuard)
export class BillingResultConsumer {
  private readonly logger = new Logger(BillingResultConsumer.name);

  constructor(private readonly billingOutcomeHandler: BillingOutcomeHandler) {}

  @On(PAYMENT_STREAM, 'payment.intent.authorized')
  async onIntentAuthorized(
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'payment.intent.authorized'>,
  ) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    const contractId = payload.subscriberRef;
    this.logger.log(`[BillingResult] CHARGE_SUCCESS: contractId=${contractId}, intentId=${payload.intentId}`);

    await this.billingOutcomeHandler.handleSuccess(contractId, payload.payableAmount ?? null, payload.intentId);
  }

  @On(PAYMENT_STREAM, 'payment.intent.failed')
  async onIntentFailed(@EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'payment.intent.failed'>) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    const contractId = payload.subscriberRef;
    this.logger.log(`[BillingResult] CHARGE_FAIL: contractId=${contractId}, errorCode=${payload.errorCode}`);

    await this.billingOutcomeHandler.handleFailure(
      contractId,
      payload.errorCode ?? null,
      payload.errorMessage ?? null,
      payload.intentId,
    );
  }

  // CMS 정산대기 intent 가 취소되면 wallet 은 canceled 만 발행한다. 이를 처리하지 않으면 billingInProgress
  // 선점이 풀리지 않아 계약이 이후 청구/만료에서 영구 제외된다(Finding 2). 성공/실패와 동일하게 subscriberRef 로
  // 계약을 라우팅한다 — wallet 취소/만료 경로가 intent.metadata 의 subscriberRef/Type 을 payload 에 실어준다.
  @On(PAYMENT_STREAM, 'payment.intent.canceled')
  async onIntentCanceled(@EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'payment.intent.canceled'>) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    const contractId = payload.subscriberRef;
    this.logger.log(`[BillingResult] CHARGE_CANCELED: contractId=${contractId}, intentId=${payload.intentId}`);

    await this.billingOutcomeHandler.handleCanceled(contractId, payload.intentId);
  }
}
