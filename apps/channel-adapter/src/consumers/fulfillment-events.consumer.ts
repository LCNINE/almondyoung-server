/**
 * Fulfillment Events Consumer
 *
 * V1 fulfillment 호환 이벤트를 구독해 full-order Medusa projection만 저장합니다.
 * 외부 판매채널 발송은 shipment-events.consumer + durable worker가 단독 소유합니다.
 *
 * 이벤트 흐름:
 * WMS (FulfillmentShipped/Delivered) → Kafka → inbox → Medusa full-order projection
 */

import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { EventPayload, EventEnvelope, On } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { DbService } from '@app/db';
import { inboxEvents } from '../schema';
import type { ChannelAdapterSchema } from '../types';
import { FULFILLMENT_STREAM } from '@packages/event-contracts/streams/fulfillments.stream';
import { EventPayloadOf, EnvelopeOf } from '@packages/event-contracts/types';

@Controller()
@UseInterceptors(EventTypeGuard)
export class FulfillmentEventsConsumer {
  private readonly logger = new Logger(FulfillmentEventsConsumer.name);

  constructor(private readonly dbService: DbService<ChannelAdapterSchema>) {
    this.logger.log('🚚 FulfillmentEventsConsumer 초기화 완료');
  }

  /**
   * 출고 완료 이벤트 핸들러
   *
   * V1 이벤트는 FO 전체 완료의 Medusa 호환 projection만 담당한다.
   * 실제 외부 채널 발송은 ShipmentShipped consumer가 소유한다.
   */
  @On(FULFILLMENT_STREAM, 'FulfillmentShipped')
  async handleFulfillmentShipped(
    @EventPayload() payload: EventPayloadOf<typeof FULFILLMENT_STREAM, 'FulfillmentShipped'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof FULFILLMENT_STREAM, 'FulfillmentShipped'>,
  ) {
    this.logger.log(`🚚 [FulfillmentShipped] Received: fulfillmentId=${payload.fulfillmentId}`, {
      correlationId: envelope.correlationId,
      orderId: payload.orderId,
      trackingNumber: payload.trackingInfo?.trackingNumber,
    });

    try {
      // Medusa projection: inbox에 저장 → InboxWorkerService가 Medusa order metadata 갱신
      // wms_order_mappings에서 medusa 채널 매핑이 없으면 InboxWorker가 조용히 스킵
      await this.dbService.db.insert(inboxEvents).values({
        eventType: 'CoreFulfillmentShipped',
        aggregateType: 'Fulfillment',
        aggregateId: payload.fulfillmentId,
        partitionKey: payload.orderId,
        payload: payload as unknown as Record<string, unknown>,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      this.logger.log(`✅ [FulfillmentShipped] Processed: fulfillmentId=${payload.fulfillmentId}`);
    } catch (error) {
      this.logger.error(`❌ [FulfillmentShipped] Failed: fulfillmentId=${payload.fulfillmentId}`, error.stack);
      throw error;
    }
  }

  /**
   * 배송 완료 이벤트 핸들러
   *
   * Core WMS에서 배송 완료가 확인되면 Medusa order metadata를 갱신합니다.
   * 네이버/쿠팡은 자체 배송 추적을 하므로 여기서는 Medusa projection만 처리합니다.
   */
  @On(FULFILLMENT_STREAM, 'FulfillmentDelivered')
  async handleFulfillmentDelivered(
    @EventPayload() payload: EventPayloadOf<typeof FULFILLMENT_STREAM, 'FulfillmentDelivered'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof FULFILLMENT_STREAM, 'FulfillmentDelivered'>,
  ) {
    this.logger.log(`📦 [FulfillmentDelivered] Received: fulfillmentId=${payload.fulfillmentId}`, {
      correlationId: envelope.correlationId,
      orderId: payload.orderId,
      deliveredAt: payload.deliveredAt,
    });

    try {
      await this.dbService.db.insert(inboxEvents).values({
        eventType: 'CoreFulfillmentDelivered',
        aggregateType: 'Fulfillment',
        aggregateId: payload.fulfillmentId,
        partitionKey: payload.orderId,
        payload: payload as unknown as Record<string, unknown>,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      this.logger.log(`✅ [FulfillmentDelivered] Inbox 저장 완료: fulfillmentId=${payload.fulfillmentId}`);
    } catch (error) {
      this.logger.error(
        `❌ [FulfillmentDelivered] Inbox 저장 실패: fulfillmentId=${payload.fulfillmentId}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * 이행 취소 이벤트 핸들러
   *
   * V1 fulfillment cancellation은 외부 채널 명령을 소유하지 않는다.
   * 채널 주문 취소는 core 가 `CancelChannelOrder` 명령으로만 요청한다(ADR-0042).
   */
  @On(FULFILLMENT_STREAM, 'FulfillmentCancelled')
  async handleFulfillmentCancelled(
    @EventPayload() payload: EventPayloadOf<typeof FULFILLMENT_STREAM, 'FulfillmentCancelled'>,
    @EventEnvelope() envelope: EnvelopeOf<typeof FULFILLMENT_STREAM, 'FulfillmentCancelled'>,
  ) {
    this.logger.log(`❌ [FulfillmentCancelled] Received: fulfillmentId=${payload.fulfillmentId}`, {
      correlationId: envelope.correlationId,
      orderId: payload.orderId,
      reason: payload.reason,
    });

    this.logger.log(
      `ℹ️ [FulfillmentCancelled] Compatibility event acknowledged without channel command: fulfillmentId=${payload.fulfillmentId}`,
    );
  }
}
