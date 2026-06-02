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
import { FulfillmentShippedPayload, FulfillmentCancelledPayload, SalesOrderCancelledPayload } from '@packages/event-contracts/streams';
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
      // 1. 채널 정보 추출 (payload에서 salesChannel 직접 사용 불가 - orderId로 조회 필요)
      // FulfillmentShippedPayload에는 salesChannel이 없으므로 orderId를 통해 조회해야 함
      // 현재는 모든 채널에 전파하는 방식으로 구현
      await this.syncShipmentToChannels(payload);

      this.logger.log(`✅ [FulfillmentShipped] Processed: fulfillmentId=${payload.fulfillmentId}`);
    } catch (error) {
      this.logger.error(`❌ [FulfillmentShipped] Failed: fulfillmentId=${payload.fulfillmentId}`, error.stack);
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
   * - cancellationScope === 'partial': 부분취소는 Medusa cancelOrder 대상이 아님 → 무시
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
      this.logger.debug(`[SALES_ORDER_CANCELLED] 부분취소 - Medusa 동기화 제외: orderId=${orderId}`);
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
