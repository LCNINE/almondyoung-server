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
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { MessageEnvelope, EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';
import { firstValueFrom } from 'rxjs';
import { DbService } from '@app/db';
import { eq, and } from 'drizzle-orm';
import { wmsOrderMappings } from '../schema';
import type { ChannelAdapterSchema } from '../types';
import { PAYMENT_STREAM } from '@packages/event-contracts/streams/payment.stream';

/** Medusa에 전달할 결제 이벤트 타입 목록 */
const MEDUSA_PAYMENT_EVENT_TYPES = [
  'payment.intent.created',
  'payment.intent.authorized',
  'payment.intent.captured',
  'payment.intent.awaiting_deposit',
  'payment.intent.refund_requested',
  'payment.intent.refund_request_rejected',
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
  @On(PAYMENT_STREAM, 'PaymentCaptured')
  async handlePaymentCaptured(
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentCaptured'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentCaptured'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  // ─── Wallet outbox dispatcher 타입 (payment.intent.* / gateway.*) ──────────
  // Wallet OutboxDispatcherService 는 envelope.messageType 에 outbox eventType
  // (dot-notation)을 그대로 싣는다. EventTypeGuard 가 messageType 단위로 필터링하므로
  // 타입별 핸들러가 없으면 조용히 버려져 Medusa projection 이 끊긴다 (#407).

  @On(PAYMENT_STREAM, 'payment.intent.created')
  async handleIntentCreated(@EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.created'>) {
    await this.forwardToMedusa(envelope);
  }

  @On(PAYMENT_STREAM, 'payment.intent.authorized')
  async handleIntentAuthorized(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.authorized'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  @On(PAYMENT_STREAM, 'payment.intent.captured')
  async handleIntentCaptured(@EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.captured'>) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * 무통장입금 입금 대기 진입 — Medusa 가 주문을 '입금확인중' 으로 선생성하도록 전달
   */
  @On(PAYMENT_STREAM, 'payment.intent.awaiting_deposit')
  async handleIntentAwaitingDeposit(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.awaiting_deposit'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * 무통장 환불 '신청'(REQUESTED) — Medusa 가 주문에 refund_status='requested' marker 를 달아
   * 승인 전까지 WMS 수집/발송에서 제외하도록 전달. 거절 시 marker 해제 이벤트로 복원.
   * intentId 기반이라 별도 channelOrderId 보강 불필요(Medusa hook 이 intent→order 역추적).
   */
  @On(PAYMENT_STREAM, 'payment.intent.refund_requested')
  async handleIntentRefundRequested(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.refund_requested'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  @On(PAYMENT_STREAM, 'payment.intent.refund_request_rejected')
  async handleIntentRefundRequestRejected(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.refund_request_rejected'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /** legacy 타입 — wallet GatewayEventType.INTENT_SUCCEEDED 가 backward compat 으로 남아 있음 */
  @On(PAYMENT_STREAM, 'payment.intent.succeeded')
  async handleIntentSucceeded(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.succeeded'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  @On(PAYMENT_STREAM, 'payment.intent.failed')
  async handleIntentFailed(@EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.failed'>) {
    await this.forwardToMedusa(envelope);
  }

  @On(PAYMENT_STREAM, 'payment.intent.canceled')
  async handleIntentCanceled(@EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'payment.intent.canceled'>) {
    await this.forwardToMedusa(envelope);
  }

  @On(PAYMENT_STREAM, 'gateway.charge.captured')
  async handleChargeCaptured(@EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'gateway.charge.captured'>) {
    await this.forwardToMedusa(envelope);
  }

  @On(PAYMENT_STREAM, 'gateway.refund.succeeded')
  async handleGatewayRefundSucceeded(
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'gateway.refund.succeeded'>,
  ) {
    // gateway 환불 payload 에는 core orderId 가 없다 — intentId 기반이라 Medusa hook 이 역추적한다.
    await this.forwardRefundToMedusa(envelope);
  }

  /**
   * PaymentAuthorized — 결제 승인 이벤트.
   */
  @On(PAYMENT_STREAM, 'PaymentAuthorized')
  async handlePaymentAuthorized(
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentAuthorized'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentAuthorized'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * PaymentFailed — 결제 실패 이벤트.
   */
  @On(PAYMENT_STREAM, 'PaymentFailed')
  async handlePaymentFailed(
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentFailed'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentFailed'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * PaymentCancelled — 결제 취소 이벤트.
   */
  @On(PAYMENT_STREAM, 'PaymentCancelled')
  async handlePaymentCancelled(
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentCancelled'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentCancelled'>,
  ) {
    await this.forwardToMedusa(envelope);
  }

  /**
   * RefundApproved — 환불 승인 이벤트.
   * channelOrderId를 조회해 Medusa hook에 함께 전달한다.
   */
  @On(PAYMENT_STREAM, 'RefundApproved')
  async handleRefundApproved(
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'RefundApproved'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'RefundApproved'>,
  ) {
    await this.forwardRefundToMedusa(envelope, payload.orderId);
  }

  /**
   * PaymentRefundCompleted — 환불 완료 이벤트.
   * channelOrderId를 조회해 Medusa hook에 함께 전달한다 (order-level refund projection용).
   */
  @On(PAYMENT_STREAM, 'PaymentRefundCompleted')
  async handlePaymentRefundCompleted(
    @EventPayload() payload: EventPayloadOf<typeof PAYMENT_STREAM, 'PaymentRefundCompleted'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof PAYMENT_STREAM, 'PaymentRefundCompleted'>,
  ) {
    await this.forwardRefundToMedusa(envelope, payload.orderId);
  }

  // ─── Medusa webhook delivery ────────────────────────────────────────────────

  /**
   * 환불 이벤트를 Medusa에 전달할 때 wms_order_mappings에서 channelOrderId를 조회해 보강한다.
   *
   * Wallet/payment 이벤트에는 Core 주문 ID(orderId)가 있으나 Medusa 주문 ID(channelOrderId)는 없다.
   * channel-adapter가 wms_order_mappings를 보유하므로 여기서 변환한다.
   * 조회 실패는 Medusa 전달을 막지 않는다 — channelOrderId 없이 payment metadata만 갱신된다.
   */
  // 이 헬퍼가 payload 에서 실제로 쓰는 것은 orderId 하나뿐이므로 그것만 받는다. 계약에서 타입을 도출하고
  // 나니 세 호출부의 payload 타입이 서로 다르고(RefundApprovedPayload · PaymentRefundCompletedPayload ·
  // GatewayRefundEventPayload) **gateway.refund.succeeded 에는 orderId 가 아예 없다**는 사실이 드러났다
  // (buildRefundEventPayload 는 refundId·chargeId·intentId 만 싣는다). 그 경로는 예전부터 조회를 건너뛰고
  // 있었고 — payload.orderId 가 늘 undefined 였다 — 동작은 그대로다. 달라진 건 그것이 타입에 보인다는 것뿐이다.
  private async forwardRefundToMedusa(envelope: MessageEnvelope, coreOrderId?: string): Promise<void> {
    let channelOrderId: string | undefined;

    if (coreOrderId) {
      try {
        const [mapping] = await this.dbService.db
          .select({ channelOrderId: wmsOrderMappings.channelOrderId })
          .from(wmsOrderMappings)
          .where(and(eq(wmsOrderMappings.wmsOrderId, coreOrderId), eq(wmsOrderMappings.salesChannel, 'medusa')))
          .limit(1);
        channelOrderId = mapping?.channelOrderId ?? undefined;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`[RefundEvent] channelOrderId 조회 실패, 없이 진행: coreOrderId=${coreOrderId}, error=${msg}`);
      }
    }

    const enrichedPayload: Record<string, unknown> = channelOrderId
      ? { ...((envelope.payload as Record<string, unknown>) ?? {}), channelOrderId }
      : ((envelope.payload as Record<string, unknown>) ?? {});

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
