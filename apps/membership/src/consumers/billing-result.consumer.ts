import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { BillingOutcomeHandler } from '../services/billing/billing-outcome.handler';

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

  constructor(
    private readonly billingOutcomeHandler: BillingOutcomeHandler,
  ) {}

  @OnEvent('payments.events.v1', 'payment.intent.authorized')
  async onIntentAuthorized(@EventPayload() payload: IntentEventPayload) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    const contractId = payload.subscriberRef;
    this.logger.log(`[BillingResult] CHARGE_SUCCESS: contractId=${contractId}, intentId=${payload.intentId}`);

    await this.billingOutcomeHandler.handleSuccess(contractId, payload.payableAmount ?? null, payload.intentId);
  }

  @OnEvent('payments.events.v1', 'payment.intent.failed')
  async onIntentFailed(@EventPayload() payload: IntentEventPayload) {
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
}
