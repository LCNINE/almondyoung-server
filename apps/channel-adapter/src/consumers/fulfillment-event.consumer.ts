import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapterService } from '../services/channel-adapter.service';
import { FulfillmentUpdatedEvent } from '../types';
import { RetryPolicy } from '../decorators/retry-policy.decorator';

/**
 * @deprecated 이 클래스는 adapter.module.ts에 등록되지 않은 초기 설계 프로토타입입니다.
 *
 * 실제 이행 이벤트 처리는 {@link FulfillmentEventsConsumer} (복수형, fulfillment-events.consumer.ts)에서 담당합니다.
 * - `FulfillmentShipped` / `FulfillmentDelivered` / `FulfillmentCancelled` Kafka 이벤트 핸들러 구현 완료
 * - Medusa projection 및 Naver/Coupang 채널 송장 동기화 처리
 *
 * 이 파일은 coupang-integration.spec.ts의 통합 테스트에서 수동 인스턴스로 참조됩니다.
 * 해당 테스트를 제거하기 전에는 이 파일을 삭제하지 마세요.
 */
@Injectable()
export class FulfillmentEventConsumer {
  private readonly logger = new Logger(FulfillmentEventConsumer.name);

  constructor(private readonly channelAdapterService: ChannelAdapterService) {
    this.logger.log('🚚 WMS 이행 이벤트 Consumer 초기화 완료');
  }

  /**
   * WMS 이행 상태 업데이트 이벤트 처리
   *
   * @param event WMS에서 발행한 이행 상태 업데이트 이벤트
   *
   * @example
   * ```typescript
   * // Kafka 메시지 처리 (실제 환경에서는 @KafkaSubscribe 데코레이터 사용)
   * await consumer.handleFulfillmentUpdated({
   *   orderId: 'ORDER-123',
   *   fulfillmentNo: 'F-01',
   *   status: 'SHIPPED',
   *   trackingNo: '123456789',
   *   carrier: 'CJ',
   *   eventVersion: 1695462345000,
   *   occurredAt: '2025-09-23T12:34:56Z'
   * });
   * ```
   */
  // TODO: 실제 Kafka 연동 시 @KafkaSubscribe('wms.fulfillment.updated') 데코레이터 추가
  @RetryPolicy({
    maxRetries: 3,
    backoffMs: [2000, 10000, 60000], // 이행 정보는 더 긴 간격으로 재시도
    dlqTopic: 'channel-adapter.fulfillment.dlq',
  })
  async handleFulfillmentUpdated(event: FulfillmentUpdatedEvent): Promise<void> {
    const startTime = Date.now();

    this.logger.log(`🚚 [WMS] 이행 상태 업데이트 이벤트 수신: ${event.orderId} → ${event.status}`, {
      fulfillmentNo: event.fulfillmentNo,
      trackingNo: event.trackingNo,
      carrier: event.carrier,
      eventVersion: event.eventVersion,
    });

    try {
      // 2. 이행 정보 검증 및 변환
      const fulfillmentData = this.transformToInternalFormat(event);

      // 3. 상태별 처리 로직
      await this.processByStatus(event, fulfillmentData);

      // 4. 모든 채널에 이행 상태 동기화
      const syncSuccess = await this.syncFulfillmentToAllChannels(event, fulfillmentData);

      // 5. 동기화 성공한 경우에만 멱등키 처리 완료 마킹

      const duration = Date.now() - startTime;
      this.logger.log(`✅ [WMS] 이행 상태 업데이트 처리 완료: ${event.orderId} (${duration}ms)`, {
        status: event.status,
        fulfillmentNo: event.fulfillmentNo,
      });
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(`❌ [WMS] 이행 상태 업데이트 처리 실패: ${event.orderId} (${duration}ms)`, {
        error: error.message,
        status: event.status,
        fulfillmentNo: event.fulfillmentNo,
      });

      // 실패 마킹 (재시도 횟수 증가)

      throw error; // RetryPolicy 데코레이터가 재시도 처리
    }
  }

  /**
   * WMS 이행 이벤트를 내부 표준 형식으로 변환
   *
   * @param event WMS 이행 이벤트
   * @returns 내부 표준 이행 데이터
   */
  private transformToInternalFormat(event: FulfillmentUpdatedEvent) {
    return {
      orderId: event.orderId,
      status: this.mapWmsStatusToInternal(event.status),
      trackingInfo:
        event.trackingNo && event.carrier
          ? {
              companyCode: this.mapCarrierCode(event.carrier),
              trackingNumber: event.trackingNo,
            }
          : undefined,
      shippedAt: event.shippedAt,
      deliveredAt: event.deliveredAt,
      updatedAt: event.occurredAt,
    };
  }

  /**
   * WMS 상태를 내부 표준 상태로 매핑
   *
   * @param wmsStatus WMS 이행 상태
   * @returns 내부 표준 상태
   */
  private mapWmsStatusToInternal(wmsStatus: FulfillmentUpdatedEvent['status']): string {
    const statusMap = {
      PREPARING: 'PREPARING',
      SHIPPED: 'SHIPPED',
      DELIVERED: 'DELIVERED',
      RETURNED: 'RETURNED',
    } as const;

    return statusMap[wmsStatus] || wmsStatus;
  }

  /**
   * 택배사 코드 표준화
   *
   * @param carrier WMS 택배사 코드
   * @returns 표준화된 택배사 코드
   */
  private mapCarrierCode(carrier: string): string {
    const carrierMap: Record<string, string> = {
      CJ: 'CJ',
      HANJIN: 'HANJIN',
      LOTTE: 'LOTTE',
      LOGEN: 'LOGEN',
      KDEXP: 'KDEXP',
      CJGLS: 'CJGLS',
    };

    return carrierMap[carrier.toUpperCase()] || carrier;
  }

  /**
   * 이행 상태별 특별 처리 로직
   *
   * @param event 원본 이벤트
   * @param fulfillmentData 변환된 이행 데이터
   */
  private async processByStatus(event: FulfillmentUpdatedEvent, fulfillmentData: any): Promise<void> {
    switch (event.status) {
      case 'SHIPPED':
        await this.handleShippedStatus(event, fulfillmentData);
        break;

      case 'DELIVERED':
        await this.handleDeliveredStatus(event, fulfillmentData);
        break;

      case 'RETURNED':
        await this.handleReturnedStatus(event, fulfillmentData);
        break;

      case 'PREPARING':
        await this.handlePreparingStatus(event, fulfillmentData);
        break;

      default:
        this.logger.debug(`📋 [WMS] 일반 이행 상태 처리: ${event.status}`);
    }
  }

  /**
   * 출고 완료 상태 처리
   */
  private async handleShippedStatus(event: FulfillmentUpdatedEvent, fulfillmentData: any): Promise<void> {
    this.logger.log(`📦 [WMS] 출고 완료 처리: ${event.orderId}`, {
      trackingNo: event.trackingNo,
      carrier: event.carrier,
      shippedAt: event.shippedAt,
    });

    // 출고 완료 시 특별 처리 로직
    // 예: 고객 알림, 배송 추적 시작 등
  }

  /**
   * 배송 완료 상태 처리
   */
  private async handleDeliveredStatus(event: FulfillmentUpdatedEvent, fulfillmentData: any): Promise<void> {
    this.logger.log(`🎯 [WMS] 배송 완료 처리: ${event.orderId}`, {
      deliveredAt: event.deliveredAt,
    });

    // 배송 완료 시 특별 처리 로직
    // 예: 구매 확정 처리, 리뷰 요청 등
  }

  /**
   * 반품 처리
   */
  private async handleReturnedStatus(event: FulfillmentUpdatedEvent, fulfillmentData: any): Promise<void> {
    this.logger.log(`↩️ [WMS] 반품 처리: ${event.orderId}`, {
      fulfillmentNo: event.fulfillmentNo,
    });

    // 반품 시 특별 처리 로직
    // 예: 재고 복구, 환불 처리 등
  }

  /**
   * 준비 중 상태 처리
   */
  private async handlePreparingStatus(event: FulfillmentUpdatedEvent, fulfillmentData: any): Promise<void> {
    this.logger.log(`⏳ [WMS] 출고 준비 중: ${event.orderId}`, {
      fulfillmentNo: event.fulfillmentNo,
    });

    // 출고 준비 시 특별 처리 로직
  }

  /**
   * 모든 채널에 이행 상태 동기화
   *
   * @param event 이행 이벤트
   * @param fulfillmentData 변환된 이행 데이터
   * @returns 동기화 성공 여부
   */
  private async syncFulfillmentToAllChannels(event: FulfillmentUpdatedEvent, fulfillmentData: any): Promise<boolean> {
    const channels = ['naver_smartstore', 'coupang'] as const; // 메두사 제외
    const syncResults: Array<{
      channel: string;
      success: boolean;
      error?: string;
    }> = [];

    this.logger.log(`🌐 [WMS] 전체 채널 이행 상태 동기화 시작: ${event.orderId} → ${event.status}`);

    // 병렬로 모든 채널에 동기화
    const syncPromises = channels.map(async (channel) => {
      try {
        const result = await this.channelAdapterService.syncToChannelOrAll(channel, {
          dataType: 'order_status',
          payload: fulfillmentData,
        });

        syncResults.push({ channel, success: result.success });

        if (result.success) {
          this.logger.log(`✅ [${channel}] 이행 상태 동기화 성공: ${event.orderId}`);
        } else {
          this.logger.warn(`⚠️ [${channel}] 이행 상태 동기화 실패: ${event.orderId}`, {
            errors: result.errors,
          });
        }
      } catch (error) {
        syncResults.push({
          channel,
          success: false,
          error: error.message,
        });

        this.logger.error(`❌ [${channel}] 이행 상태 동기화 오류: ${event.orderId}`, error.message);
      }
    });

    await Promise.all(syncPromises);

    // ✅ 필수 채널 목록 (env 기반)
    const required = (process.env.ADAPTER_REQUIRED_CHANNELS ?? 'coupang,naver_smartstore')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // ✅ 필수 채널이 모두 성공했는지 판단
    const ok = required.every((req) => syncResults.some((r) => r.channel === req && r.success === true));

    const successCount = syncResults.filter((r) => r.success).length;
    const totalCount = syncResults.length;

    this.logger.debug(
      `🔍 [WMS] 채널별 이행 상태 동기화 결과: ${successCount}/${totalCount} 성공 (필수:${required.join(',')})`,
      syncResults,
    );

    return ok;
  }

  /**
   * DLQ로 메시지 전송 (RetryPolicy 데코레이터에서 호출)
   *
   * @param dlqTopic DLQ 토픽명
   * @param originalEvent 원본 이벤트
   * @param lastError 마지막 에러
   * @param retryCount 재시도 횟수
   */
  async sendToDLQ(
    dlqTopic: string,
    originalEvent: FulfillmentUpdatedEvent,
    lastError: Error,
    retryCount: number,
  ): Promise<void> {
    const dlqMessage = {
      originalTopic: 'wms.fulfillment.updated',
      originalEvent,
      lastError: {
        message: lastError.message,
        stack: lastError.stack,
      },
      retryCount,
      failedAt: new Date().toISOString(),
      consumer: 'FulfillmentEventConsumer',
    };

    this.logger.error(`📤 [DLQ] 이행 이벤트 DLQ 전송: ${originalEvent.orderId} → ${dlqTopic}`, { dlqMessage });

    // TODO: 실제 Kafka DLQ 전송 로직 구현
    // await this.kafkaProducer.send({
    //   topic: dlqTopic,
    //   messages: [{ value: JSON.stringify(dlqMessage) }]
    // });
  }

  /**
   * Consumer 상태 확인 (헬스체크용)
   *
   * @returns Consumer 상태 정보
   */
  getHealthStatus() {
    return {
      consumer: 'FulfillmentEventConsumer',
      topic: 'wms.fulfillment.updated',
      status: 'active',
      lastProcessedAt: new Date().toISOString(),
    };
  }
}
