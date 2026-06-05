/**
 * Fulfillment Events Consumer
 *
 * WMS에서 발행하는 이행(Fulfillment) 이벤트를 구독하여
 * 해당 판매채널(네이버, 쿠팡)에 송장 정보 및 상태를 동기화합니다.
 *
 * 이벤트 흐름:
 * WMS (FulfillmentShipped) → Kafka → Channel Adapter → 채널 API (송장 업데이트)
 * WMS (FulfillmentCancelled) → Kafka → Channel Adapter → 채널 API (취소 처리)
 */

import { Controller, Logger, UseInterceptors } from '@nestjs/common';
import { OnEvent, EventPayload, EventEnvelope } from '@app/events';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { FulfillmentShippedPayload, FulfillmentCancelledPayload, FulfillmentDeliveredPayload, SalesOrderCancelledPayload } from '@packages/event-contracts/streams';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { inboxEvents } from '../schema';
import type { ChannelAdapterSchema } from '../types';
import { ChannelAdapterFactory } from '../adapters/channel-adapter.factory';

type SalesChannel = 'naver' | 'coupang' | 'medusa' | '3pl';

@Controller()
@UseInterceptors(EventTypeGuard)
export class FulfillmentEventsConsumer {
  private readonly logger = new Logger(FulfillmentEventsConsumer.name);

  constructor(
    private readonly channelAdapterFactory: ChannelAdapterFactory,
    private readonly dbService: DbService<ChannelAdapterSchema>,
  ) {
    this.logger.log('🚚 FulfillmentEventsConsumer 초기화 완료');
  }

  /**
   * 출고 완료 이벤트 핸들러
   *
   * WMS에서 FO가 출고 완료되면, 해당 채널에 송장 정보를 전달합니다.
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
      await this.syncShipmentToChannels(payload);

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
      this.logger.error(`❌ [FulfillmentDelivered] Inbox 저장 실패: fulfillmentId=${payload.fulfillmentId}`, error.stack);
      throw error;
    }
  }

  /**
   * 이행 취소 이벤트 핸들러
   *
   * WMS에서 FO가 취소되면, 해당 채널에 취소 상태를 전달합니다.
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

    try {
      // 취소 상태를 채널에 전파
      await this.syncCancellationToChannels(payload);

      this.logger.log(`✅ [FulfillmentCancelled] Processed: fulfillmentId=${payload.fulfillmentId}`);
    } catch (error) {
      this.logger.error(`❌ [FulfillmentCancelled] Failed: fulfillmentId=${payload.fulfillmentId}`, error.stack);
      throw error;
    }
  }

  /**
   * 출고 정보를 채널들에 동기화
   */
  private async syncShipmentToChannels(payload: FulfillmentShippedPayload): Promise<void> {
    const channels: Array<'naver_smartstore' | 'coupang'> = ['naver_smartstore', 'coupang'];

    const syncPromises = channels.map(async (channel) => {
      try {
        const adapter = this.channelAdapterFactory.getAdapter(channel);

        // 발송 처리 명령 실행
        const result = await adapter.executeCommand({
          type: 'dispatch.ship',
          orderId: payload.orderId,
          tracking: {
            companyCode: payload.trackingInfo.carrier,
            number: payload.trackingInfo.trackingNumber,
          },
          dispatchedAt: payload.shippedAt,
        });

        if (result.success) {
          this.logger.log(`✅ [${channel}] 송장 정보 동기화 성공: ${payload.orderId}`, {
            trackingNumber: payload.trackingInfo.trackingNumber,
          });
        } else {
          this.logger.warn(`⚠️ [${channel}] 송장 정보 동기화 실패: ${payload.orderId}`, { errors: result.errors });
        }

        return result;
      } catch (error) {
        this.logger.error(`❌ [${channel}] 송장 정보 동기화 오류: ${payload.orderId}`, error.message);
        return { success: false, errors: [{ message: error.message }] };
      }
    });

    await Promise.allSettled(syncPromises);
  }

  /**
   * 취소 정보를 채널들에 동기화
   */
  private async syncCancellationToChannels(payload: FulfillmentCancelledPayload): Promise<void> {
    const channels: Array<'naver_smartstore' | 'coupang'> = ['naver_smartstore', 'coupang'];

    const syncPromises = channels.map(async (channel) => {
      try {
        const adapter = this.channelAdapterFactory.getAdapter(channel);

        // 주문 취소 명령 실행
        const result = await adapter.executeCommand({
          type: 'order.cancel',
          orderId: payload.orderId,
          reason: payload.reasonDetail ?? payload.reason,
        });

        if (result.success) {
          this.logger.log(`✅ [${channel}] 취소 상태 동기화 성공: ${payload.orderId}`);
        } else {
          this.logger.warn(`⚠️ [${channel}] 취소 상태 동기화 실패: ${payload.orderId}`, { errors: result.errors });
        }

        return result;
      } catch (error) {
        this.logger.error(`❌ [${channel}] 취소 상태 동기화 오류: ${payload.orderId}`, error.message);
        return { success: false, errors: [{ message: error.message }] };
      }
    });

    await Promise.allSettled(syncPromises);
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
      this.logger.log(`[SALES_ORDER_CANCELLED] 부분취소 - 외부채널 동기화 제외 (internal_manual_review_only): orderId=${orderId}`);
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
