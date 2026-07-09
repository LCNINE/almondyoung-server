import { Controller, Logger, UseFilters, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventsExceptionFilter } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  InvoicePaidPayload,
  InvoicePaymentFailedPayload,
  InvoiceUncollectiblePayload,
  InvoiceVoidedPayload,
  MandateRejectedPayload,
} from '@packages/event-contracts/streams/payment.stream';
import { InvoiceOutcomeHandler } from '../services/billing/invoice-outcome.handler';

/**
 * ADR-0027 §4-2. wallet 인보이스 결과 이벤트 컨슈머 — 인보이스 경로(billing_path=INVOICE)의
 * 자격 연장/회수. 레거시 BillingResultConsumer(payment.intent.*)와 달리 인보이스 경로 intent 는
 * subscriberRef 를 싣지 않으므로 두 컨슈머가 같은 청구를 이중 처리하지 않는다.
 */
@Controller()
@UseFilters(EventsExceptionFilter)
@UseInterceptors(EventTypeGuard)
export class InvoiceResultConsumer {
  private readonly logger = new Logger(InvoiceResultConsumer.name);

  constructor(private readonly invoiceOutcomeHandler: InvoiceOutcomeHandler) {}

  @OnEvent('payments.events.v1', 'invoice.paid')
  async onInvoicePaid(@EventPayload() payload: InvoicePaidPayload) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef || !payload.periodEnd) return;

    this.logger.log(
      `[InvoiceResult] PAID: contractId=${payload.subscriberRef}, invoiceId=${payload.invoiceId}, periodEnd=${payload.periodEnd}`,
    );
    await this.invoiceOutcomeHandler.handlePaid(
      payload.subscriberRef,
      payload.invoiceId,
      payload.periodEnd,
      payload.amount ?? null,
      payload.intentId ?? undefined,
    );
  }

  @OnEvent('payments.events.v1', 'invoice.payment_failed')
  async onInvoicePaymentFailed(@EventPayload() payload: InvoicePaymentFailedPayload) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    this.logger.log(
      `[InvoiceResult] PAYMENT_FAILED: contractId=${payload.subscriberRef}, invoiceId=${payload.invoiceId}, attempt=${payload.attemptCount}, errorCode=${payload.errorCode}`,
    );
    await this.invoiceOutcomeHandler.handlePaymentFailed(
      payload.subscriberRef,
      payload.invoiceId,
      payload.intentId ?? null,
      payload.attemptCount ?? 0,
      payload.errorCode ?? null,
      payload.errorMessage ?? null,
    );
  }

  @OnEvent('payments.events.v1', 'invoice.uncollectible')
  async onInvoiceUncollectible(@EventPayload() payload: InvoiceUncollectiblePayload) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    this.logger.warn(
      `[InvoiceResult] UNCOLLECTIBLE: contractId=${payload.subscriberRef}, invoiceId=${payload.invoiceId}, errorCode=${payload.errorCode}`,
    );
    await this.invoiceOutcomeHandler.handleUncollectible(
      payload.subscriberRef,
      payload.invoiceId,
      payload.errorCode ?? null,
    );
  }

  @OnEvent('payments.events.v1', 'invoice.voided')
  async onInvoiceVoided(@EventPayload() payload: InvoiceVoidedPayload) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    this.logger.warn(
      `[InvoiceResult] VOIDED: contractId=${payload.subscriberRef}, invoiceId=${payload.invoiceId}, reason=${payload.reason}`,
    );
    await this.invoiceOutcomeHandler.handleVoided(payload.subscriberRef, payload.invoiceId, payload.reason ?? null);
  }

  @OnEvent('payments.events.v1', 'mandate.rejected')
  async onMandateRejected(@EventPayload() payload: MandateRejectedPayload) {
    if (payload.subscriberType !== 'MEMBERSHIP' || !payload.subscriberRef) return;

    this.logger.warn(
      `[InvoiceResult] MANDATE_REJECTED: contractId=${payload.subscriberRef}, invoiceId=${payload.invoiceId ?? '-'}, reasonCode=${payload.reasonCode}`,
    );
    await this.invoiceOutcomeHandler.handleMandateRejected(
      payload.subscriberRef,
      payload.invoiceId ?? null,
      payload.reasonCode ?? null,
    );
  }
}
