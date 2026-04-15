/**
 * Payment Events Consumer
 *
 * Wallet 서비스에서 발행하는 결제 이벤트(payments.events.v1)를 구독하여
 * Medusa 백엔드에 웹훅으로 전달합니다.
 *
 * 이벤트 흐름:
 * Wallet (Outbox → Kafka) → Channel Adapter → Medusa (HTTP POST)
 */

import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { firstValueFrom } from 'rxjs';

/** Medusa에 전달할 결제 이벤트 타입 목록 */
const MEDUSA_PAYMENT_EVENT_TYPES = [
  'payment.intent.created',
  'payment.intent.authorized',
  'payment.intent.captured',
  'payment.intent.succeeded',
  'payment.intent.failed',
  'payment.intent.canceled',
  'gateway.charge.captured',
  'gateway.refund.succeeded',
] as const;

type MedusaPaymentEventType = (typeof MEDUSA_PAYMENT_EVENT_TYPES)[number];

function isMedusaPaymentEvent(eventType: string): eventType is MedusaPaymentEventType {
  return (MEDUSA_PAYMENT_EVENT_TYPES as readonly string[]).includes(eventType);
}

@Controller()
@UseInterceptors(EventTypeGuard)
export class PaymentEventsConsumer {
  private readonly logger = new Logger(PaymentEventsConsumer.name);
  private readonly medusaWebhookUrl: string | null;

  constructor(
    private readonly httpService: HttpService,
    configService: ConfigService,
  ) {
    const medusaApiUrl = configService.get<string>('MEDUSA_API_URL') ?? '';
    this.medusaWebhookUrl = medusaApiUrl ? `${medusaApiUrl}/hooks/payment-events` : null;

    if (this.medusaWebhookUrl) {
      this.logger.log(`PaymentEventsConsumer initialized: webhookUrl=${this.medusaWebhookUrl}`);
    } else {
      this.logger.warn('PaymentEventsConsumer: MEDUSA_API_URL not set, events will be logged only');
    }
  }

  /**
   * PaymentCaptured — 결제 확정 이벤트.
   * Medusa에서 주문 결제 상태 업데이트에 사용.
   */
  @OnEvent('payments.events.v1', 'PaymentCaptured')
  async handlePaymentCaptured(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * PaymentAuthorized — 결제 승인 이벤트.
   */
  @OnEvent('payments.events.v1', 'PaymentAuthorized')
  async handlePaymentAuthorized(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * PaymentFailed — 결제 실패 이벤트.
   */
  @OnEvent('payments.events.v1', 'PaymentFailed')
  async handlePaymentFailed(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * PaymentCancelled — 결제 취소 이벤트.
   */
  @OnEvent('payments.events.v1', 'PaymentCancelled')
  async handlePaymentCancelled(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * RefundApproved — 환불 승인 이벤트.
   */
  @OnEvent('payments.events.v1', 'RefundApproved')
  async handleRefundApproved(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * PaymentRefundCompleted — 환불 완료 이벤트.
   */
  @OnEvent('payments.events.v1', 'PaymentRefundCompleted')
  async handlePaymentRefundCompleted(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardToMedusa(envelope);
  }

  // ─── Medusa webhook delivery ────────────────────────────────────────────────

  private async forwardToMedusa(envelope: MessageEnvelope): Promise<void> {
    const eventType = envelope.messageType;

    if (!this.medusaWebhookUrl) {
      this.logger.debug(
        `[PaymentEvent] Log-only (no webhook): messageType=${eventType}, messageId=${envelope.messageId}`,
      );
      return;
    }

    // outbox dispatcher 이벤트 타입(payment.intent.*)은 Medusa 전달 대상인지 체크
    const outboxEventType = (envelope.payload as Record<string, unknown>)?.eventType as string | undefined;
    const effectiveType = outboxEventType ?? eventType;

    if (!isMedusaPaymentEvent(effectiveType)) {
      this.logger.debug(
        `[PaymentEvent] Skipped (not a Medusa event): messageType=${eventType}, effectiveType=${effectiveType}`,
      );
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(
          this.medusaWebhookUrl,
          {
            messageId: envelope.messageId,
            messageType: envelope.messageType,
            source: envelope.source,
            payload: envelope.payload,
            occurredAt: envelope.occurredAt ?? envelope.timestamp,
            correlationId: envelope.correlationId,
          },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10_000,
          },
        ),
      );

      this.logger.debug(
        `[PaymentEvent] Forwarded to Medusa: messageType=${eventType}, messageId=${envelope.messageId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[PaymentEvent] Medusa webhook failed: messageType=${eventType}, messageId=${envelope.messageId}, error=${msg}`,
      );
      // Throw to trigger DLQ retry
      throw err;
    }
  }
}
