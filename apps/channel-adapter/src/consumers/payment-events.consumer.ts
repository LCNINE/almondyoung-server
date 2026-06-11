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
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import { wmsOrderMappings } from '../schema';
import type { ChannelAdapterSchema } from '../types';

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
    private readonly dbService: DbService<ChannelAdapterSchema>,
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

  // ─── Wallet outbox dispatcher 타입 (payment.intent.* / gateway.*) ──────────
  // Wallet OutboxDispatcherService 는 envelope.messageType 에 outbox eventType
  // (dot-notation)을 그대로 싣는다. EventTypeGuard 가 messageType 단위로 필터링하므로
  // 타입별 핸들러가 없으면 조용히 버려져 Medusa projection 이 끊긴다 (#407).

  @OnEvent('payments.events.v1', 'payment.intent.created')
  async handleIntentCreated(@EventEnvelope() envelope: MessageEnvelope) {
    await this.forwardToMedusa(envelope);
  }

  @OnEvent('payments.events.v1', 'payment.intent.authorized')
  async handleIntentAuthorized(@EventEnvelope() envelope: MessageEnvelope) {
    await this.forwardToMedusa(envelope);
  }

  @OnEvent('payments.events.v1', 'payment.intent.captured')
  async handleIntentCaptured(@EventEnvelope() envelope: MessageEnvelope) {
    await this.forwardToMedusa(envelope);
  }

  /** legacy 타입 — wallet GatewayEventType.INTENT_SUCCEEDED 가 backward compat 으로 남아 있음 */
  @OnEvent('payments.events.v1', 'payment.intent.succeeded')
  async handleIntentSucceeded(@EventEnvelope() envelope: MessageEnvelope) {
    await this.forwardToMedusa(envelope);
  }

  @OnEvent('payments.events.v1', 'payment.intent.failed')
  async handleIntentFailed(@EventEnvelope() envelope: MessageEnvelope) {
    await this.forwardToMedusa(envelope);
  }

  @OnEvent('payments.events.v1', 'payment.intent.canceled')
  async handleIntentCanceled(@EventEnvelope() envelope: MessageEnvelope) {
    await this.forwardToMedusa(envelope);
  }

  @OnEvent('payments.events.v1', 'gateway.charge.captured')
  async handleChargeCaptured(@EventEnvelope() envelope: MessageEnvelope) {
    await this.forwardToMedusa(envelope);
  }

  @OnEvent('payments.events.v1', 'gateway.refund.succeeded')
  async handleGatewayRefundSucceeded(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardRefundToMedusa(envelope, payload);
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
   * channelOrderId를 조회해 Medusa hook에 함께 전달한다.
   */
  @OnEvent('payments.events.v1', 'RefundApproved')
  async handleRefundApproved(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardRefundToMedusa(envelope, payload);
  }

  /**
   * PaymentRefundCompleted — 환불 완료 이벤트.
   * channelOrderId를 조회해 Medusa hook에 함께 전달한다 (order-level refund projection용).
   */
  @OnEvent('payments.events.v1', 'PaymentRefundCompleted')
  async handlePaymentRefundCompleted(
    @EventPayload() payload: Record<string, unknown>,
    @EventEnvelope() envelope: MessageEnvelope,
  ) {
    await this.forwardRefundToMedusa(envelope, payload);
  }

  // ─── Medusa webhook delivery ────────────────────────────────────────────────

  /**
   * 환불 이벤트를 Medusa에 전달할 때 wms_order_mappings에서 channelOrderId를 조회해 보강한다.
   *
   * Wallet/payment 이벤트에는 Core 주문 ID(orderId)가 있으나 Medusa 주문 ID(channelOrderId)는 없다.
   * channel-adapter가 wms_order_mappings를 보유하므로 여기서 변환한다.
   * 조회 실패는 Medusa 전달을 막지 않는다 — channelOrderId 없이 payment metadata만 갱신된다.
   */
  private async forwardRefundToMedusa(envelope: MessageEnvelope, payload: Record<string, unknown>): Promise<void> {
    const coreOrderId = payload?.orderId as string | undefined;
    let channelOrderId: string | undefined;

    if (coreOrderId) {
      try {
        const [mapping] = await this.dbService.db
          .select({ channelOrderId: wmsOrderMappings.channelOrderId })
          .from(wmsOrderMappings)
          .where(and(
            eq(wmsOrderMappings.wmsOrderId, coreOrderId),
            eq(wmsOrderMappings.salesChannel, 'medusa'),
          ))
          .limit(1);
        channelOrderId = mapping?.channelOrderId ?? undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[RefundEvent] channelOrderId 조회 실패, 없이 진행: coreOrderId=${coreOrderId}, error=${msg}`);
      }
    }

    const enrichedPayload: Record<string, unknown> = channelOrderId
      ? { ...((envelope.payload as Record<string, unknown>) ?? {}), channelOrderId }
      : (envelope.payload as Record<string, unknown>) ?? {};

    await this.forwardToMedusa(envelope, enrichedPayload);
  }

  private async forwardToMedusa(envelope: MessageEnvelope, payloadOverride?: Record<string, unknown>): Promise<void> {
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
            payload: payloadOverride ?? envelope.payload,
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
