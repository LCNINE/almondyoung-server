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
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import {
  FulfillmentShippedPayload,
  FulfillmentCancelledPayload,
  FulfillmentDeliveredPayload,
  SalesOrderCancelledPayload,
} from '@packages/event-contracts/streams';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { inboxEvents } from '../schema';
import type { ChannelAdapterSchema } from '../types';

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
  @OnEvent('fulfillments.events.v1', 'FulfillmentShipped')
  async handleFulfillmentShipped(
    @EventPayload() payload: FulfillmentShippedPayload,
    @EventEnvelope() envelope: MessageEnvelope<FulfillmentShippedPayload>,
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
  @OnEvent('fulfillments.events.v1', 'FulfillmentDelivered')
  async handleFulfillmentDelivered(
    @EventPayload() payload: FulfillmentDeliveredPayload,
    @EventEnvelope() envelope: MessageEnvelope<FulfillmentDeliveredPayload>,
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
   * 주문 취소 projection은 SalesOrderCancelled의 단일 채널 경로가 담당한다.
   */
  @OnEvent('fulfillments.events.v1', 'FulfillmentCancelled')
  async handleFulfillmentCancelled(
    @EventPayload() payload: FulfillmentCancelledPayload,
    @EventEnvelope() envelope: MessageEnvelope<FulfillmentCancelledPayload>,
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

  /**
   * Core SalesOrderCancelled 핸들러
   *
   * Core 가 주문 취소를 완료한 뒤 core.orders.events.v1 으로 발행하는 SalesOrderCancelled 이벤트.
   * - cancellationScope === 'full': Medusa 전체 주문 취소 동기화 대상 → inbox_events 저장
   * - cancellationScope === 'partial': 채널(Medusa/Naver/Coupang) 동기화 대상 아님 → 무시
   *
   * 부분취소를 외부채널/Medusa에 전파하지 않는 이유:
   * 1. Medusa: cancelOrder는 주문 전체 취소 API이므로 부분취소에 사용 불가.
   * 2. Naver/Coupang: 채널별 부분취소 API 사용 여부 및 Wallet 환불과의 중복 방지 정책 미확정.
   *    정책 없이 자동 호출하면 채널 자체 환불 + Wallet 환불이 중복될 수 있음.
   * 3. 부분취소 환불 상태는 Core businessLink에 manual_pending으로 기록되고,
   *    운영자가 admin-web에서 수동 완료 처리한다.
   *
   * 외부채널 부분취소 자동 통보가 필요해지면 별도 핸들러를 추가하고,
   * Naver/Coupang 채널별 정책을 확정한 뒤 구현한다.
   *
   * 이벤트 발행 경로: Core sales-orders.service → outbox → core.orders.events.v1 (outbox dispatcher)
   */
  @OnEvent('core.orders.events.v1', 'SalesOrderCancelled')
  async handleCoreOrderCancelled(
    @EventPayload() payload: SalesOrderCancelledPayload,
    @EventEnvelope() envelope: MessageEnvelope,
  ): Promise<void> {
    const { orderId, cancellationScope } = payload;
    this.logger.log(`[SALES_ORDER_CANCELLED] Core 주문 취소 수신: orderId=${orderId}, scope=${cancellationScope}`, {
      correlationId: envelope.correlationId,
    });

    if (cancellationScope !== 'full') {
      // 부분취소: 외부채널/Medusa 자동 전파 없음 (정책 미확정). Core businessLink에 manual_pending 기록됨.
      this.logger.log(
        `[SALES_ORDER_CANCELLED] 부분취소 - 외부채널 동기화 제외 (internal_manual_review_only): orderId=${orderId}`,
      );
      return;
    }

    try {
      await this.dbService.db.insert(inboxEvents).values({
        eventType: 'CoreOrderCancelled',
        aggregateType: 'Order',
        aggregateId: orderId,
        partitionKey: orderId,
        payload: payload,
        metadata: {
          correlationId: envelope.correlationId,
          messageId: envelope.messageId,
        },
        status: 'pending',
        createdAt: new Date(),
      });

      this.logger.log(`[SALES_ORDER_CANCELLED] Inbox 저장 완료: orderId=${orderId}`);
    } catch (error) {
      this.logger.error(`[SALES_ORDER_CANCELLED] Inbox 저장 실패: orderId=${orderId}`, error.stack);
      throw error;
    }
  }
}
