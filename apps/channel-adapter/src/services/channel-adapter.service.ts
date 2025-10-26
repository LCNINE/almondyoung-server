import { Injectable, Logger } from '@nestjs/common';
import { ChannelType } from './adapters/channel-adapter.factory';
import {
  DataType,
  InternalOrderEvent,
  SyncResult,
  SyncToChannelPayload,
  OrderQuery,
} from '../types';
import { ChannelCommand, ChannelQuery } from '../types';
import { ChannelDataReader } from './channel-data.reader';
import { ChannelSyncManager } from './channel-sync.manager';
import { ChannelCommandManager } from './channel-command.manager';
import { WmsIntegrationManager } from './wms-integration.manager';
import { ChannelsConfig } from '../config/channels.config';

/**
 * 판매채널 어댑터 메인 서비스
 *
 * 외부에서 사용할 수 있는 간단한 인터페이스를 제공하는 파사드 서비스입니다.
 * 내부적으로 AdapterOrchestrationService를 호출하여 실제 작업을 수행합니다.
 *
 * @example
 * ```typescript
 * // 네이버에서 주문 데이터 폴링
 * const events = await channelAdapter.poll('naver_smartstore', 'orders');
 *
 * // 웹훅 이벤트 처리
 * const processedEvents = await channelAdapter.incoming('coupang', webhookData);
 *
 * // 발송처리 명령 실행
 * const result = await channelAdapter.command('naver_smartstore', {
 *   type: 'dispatch.confirm',
 *   orderId: '12345',
 *   tracking: { companyCode: 'CJ', number: '123456789' }
 * });
 * ```
 */
@Injectable()
export class ChannelAdapterService {
  private readonly logger = new Logger(ChannelAdapterService.name);

  constructor(
    private readonly channelReader: ChannelDataReader,
    private readonly syncManager: ChannelSyncManager,
    private readonly commandManager: ChannelCommandManager,
    private readonly wmsManager: WmsIntegrationManager,
  ) {
    this.logger.log('📋 채널 어댑터 서비스 초기화 완료 (리팩토링 버전)');
  }

  /**
   * 외부 채널에서 데이터 폴링 (조합)
   *
   * 흐름: 조회 → 처리 → 완료
   *
   * @param channel - 대상 판매채널
   * @param dataType - 동기화할 데이터 타입
   * @returns 동기화된 내부 이벤트 배열
   *
   * @example
   * ```typescript
   * // 네이버 스마트스토어에서 주문 데이터 동기화
   * const orderEvents = await channelAdapter.poll('naver_smartstore', 'orders');
   * console.log(`${orderEvents.length}건의 주문이 동기화되었습니다.`);
   *
   * // 쿠팡에서 재고 데이터 동기화
   * const inventoryEvents = await channelAdapter.poll('coupang', 'inventory');
   * ```
   */
  async poll(
    channel: ChannelType,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    try {
      // 1. 채널에서 데이터 가져오기
      const events = await this.channelReader.fetchFromChannel(
        channel,
        dataType,
      );

      // 2. 동기화 처리 (검증 + 저장 + 이벤트)
      await this.syncManager.processInboundSync(events, channel, dataType);

      return events;
    } catch (error) {
      throw new Error(
        `Failed to poll ${dataType} from ${channel}: ${error.message}`,
      );
    }
  }

  /**
   * 외부 채널에서 수신된 웹훅/이벤트 처리 (위임)
   *
   * @param channel - 이벤트를 발송한 판매채널
   * @param payload - 수신된 이벤트 페이로드
   * @returns 처리된 내부 이벤트 배열
   *
   * @example
   * ```typescript
   * // 쿠팡에서 수신된 웹훅 처리
   * const events = await channelAdapter.incoming('coupang', {
   *   orderId: '12345',
   *   status: 'SHIPPED',
   *   timestamp: '2023-01-01T10:00:00Z'
   * });
   *
   * // 네이버에서 수신된 상태 변경 이벤트 처리
   * const naverEvents = await channelAdapter.incoming('naver_smartstore', webhookPayload);
   * ```
   */
  async incoming(
    channel: ChannelType,
    payload: any,
  ): Promise<InternalOrderEvent[]> {
    return await this.channelReader.processWebhook(channel, payload);
  }

  /**
   * 특정 채널에 대한 명령 실행 (위임)
   *
   * 단순한 흐름이므로 Manager에 위임
   *
   * @param channel - 대상 판매채널
   * @param cmd - 실행할 명령 객체
   * @returns 명령 실행 결과
   *
   * @example
   * ```typescript
   * // 네이버에서 발송처리
   * const dispatchResult = await channelAdapter.command('naver_smartstore', {
   *   type: 'dispatch.confirm',
   *   orderId: '2025091550078121',
   *   productOrderIds: ['2025091565429621'],
   *   tracking: {
   *     companyCode: 'CJ',
   *     number: '123456789012'
   *   }
   * });
   *
   * // 쿠팡에서 취소 승인
   * const cancelResult = await channelAdapter.command('coupang', {
   *   type: 'cancel.approve',
   *   orderId: '67890'
   * });
   * ```
   */
  async command(
    channel: ChannelType,
    cmd: ChannelCommand,
  ): Promise<SyncResult> {
    return await this.commandManager.execute(channel, cmd);
  }

  /**
   * 특정 채널에 대한 조회 실행 (CQRS 패턴) (위임)
   *
   * @param channel - 대상 판매채널
   * @param query - 실행할 조회 객체
   * @returns 표준 내부 모델로 번역된 조회 결과
   *
   * @example
   * ```typescript
   * // 쿠팡 교환 요청 목록 조회 (표준 내부 모델로 반환)
   * const exchanges = await channelAdapter.query('coupang', {
   *   type: 'exchange.requests',
   *   dateFrom: '2025-01-01T00:00:00',
   *   dateTo: '2025-01-07T23:59:59',
   *   status: 'RECEIPT'
   * });
   * // 반환: InternalExchangeEvent[] (SSOT 원칙)
   *
   * // 반품 철회 이력 조회
   * const withdrawals = await channelAdapter.query('coupang', {
   *   type: 'return.withdrawal_history',
   *   dateFrom: '2025-01-01T00:00:00',
   *   dateTo: '2025-01-07T23:59:59'
   * });
   *
   * // 배송 히스토리 조회
   * const deliveryHistory = await channelAdapter.query('coupang', {
   *   type: 'delivery.history',
   *   orderId: 'ORDER_12345'
   * });
   * ```
   */
  async query(channel: ChannelType, query: ChannelQuery): Promise<any> {
    return await this.channelReader.executeQuery(channel, query);
  }

  /**
   * 모든 채널에서 특정 데이터 타입 동기화 (위임)
   *
   * @param dataType - 동기화할 데이터 타입
   * @returns 채널별 동기화 결과
   *
   * @example
   * ```typescript
   * // 모든 채널에서 주문 데이터 동기화
   * const results = await channelAdapter.syncAll('orders');
   *
   * results.forEach(result => {
   *   if (result.success) {
   *     console.log(`${result.channel}: ${result.events.length}건 동기화 성공`);
   *   } else {
   *     console.error(`${result.channel}: 동기화 실패 - ${result.error}`);
   *   }
   * });
   * ```
   */
  async syncAll(dataType: DataType) {
    return await this.syncManager.syncAllChannels(dataType);
  }

  /**
   * 내부 데이터를 외부 채널로 동기화 (송신) (조합)
   *
   * 흐름: 전송 → 로깅
   *
   * @param channel - 대상 판매채널
   * @param payload - 동기화할 데이터 페이로드
   * @returns 동기화 처리 결과
   *
   * @example
   * ```typescript
   * // 네이버 스마트스토어에 재고 업데이트
   * const result = await channelAdapter.syncToChannel('naver_smartstore', {
   *   dataType: 'inventory',
   *   payload: {
   *     productId: '12345',
   *     stockQuantity: 100,
   *     isOptionProduct: false
   *   }
   * });
   *
   * // 옵션 상품 재고 업데이트
   * const optionResult = await channelAdapter.syncToChannel('naver_smartstore', {
   *   dataType: 'inventory',
   *   payload: {
   *     productId: '67890',
   *     stockQuantity: 50,
   *     isOptionProduct: true,
   *     optionInfo: {
   *       optionCombinations: [{ id: 1001, stockQuantity: 25 }]
   *     }
   *   }
   * });
   * ```
   */
  async syncToChannel(
    channel: ChannelType,
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    try {
      // 1. 채널에 데이터 전송
      const result = await this.channelReader.sendToChannel(channel, payload);

      // 2. 동기화 로그
      await this.syncManager.logOutboundSync(channel, payload, result);

      return result;
    } catch (error) {
      throw new Error(
        `Failed to sync ${payload.dataType} to ${channel}: ${error.message}`,
      );
    }
  }

  // ========================================
  // 🔍 조회
  // ========================================

  /**
   * 주문 조회 (위임)
   *
   * @param channel - 대상 채널
   * @param query - 조회 쿼리
   * @returns 내부 표준 이벤트 배열
   */
  async findOrders(
    channel: ChannelType,
    query: OrderQuery,
  ): Promise<InternalOrderEvent[]> {
    return await this.channelReader.findOrders(channel, query);
  }

  /**
   * 채널 쿼리 실행 (위임)
   *
   * @param channel - 대상 채널
   * @param query - 실행할 쿼리
   * @returns 쿼리 결과
   */
  async executeQuery(channel: ChannelType, query: ChannelQuery): Promise<any> {
    return await this.channelReader.executeQuery(channel, query);
  }

  // ========================================
  // 🏭 WMS 연동
  // ========================================

  /**
   * WMS 주문 생성 (위임)
   *
   * @param channel - 대상 채널
   * @param orderEvent - 주문 이벤트
   * @returns WMS 주문 정보
   */
  async forwardToWms(channel: ChannelType, orderEvent: InternalOrderEvent) {
    return await this.wmsManager.createOrder(channel, orderEvent);
  }

  /**
   * WMS 주문 취소 (위임)
   *
   * @param channel - 대상 채널
   * @param orderEvent - 주문 이벤트
   * @param reason - 취소 사유
   * @returns WMS 주문 정보
   */
  async cancelInWms(
    channel: ChannelType,
    orderEvent: InternalOrderEvent,
    reason?: string,
  ) {
    return await this.wmsManager.cancelOrder(channel, orderEvent, reason);
  }

  /**
   * WMS 교환 처리 (위임)
   *
   * @param channel - 대상 채널
   * @param exchangeEvent - 교환 이벤트
   * @returns WMS 주문 정보
   */
  async processExchangeInWms(
    channel: ChannelType,
    exchangeEvent: InternalOrderEvent,
  ) {
    return await this.wmsManager.processExchange(channel, exchangeEvent);
  }

  /**
   * 전체 채널 명령 실행 (위임)
   *
   * @param command - 실행할 명령
   * @returns 채널별 실행 결과
   */
  async executeOnAllChannels(command: ChannelCommand) {
    return await this.commandManager.executeOnAllChannels(command);
  }

  /**
   * 채널 또는 전체 채널에 데이터 동기화
   *
   * @param channelOrAll - 대상 채널 또는 'all'
   * @param payload - 동기화할 데이터
   * @returns 동기화 결과
   */
  async syncToChannelOrAll(
    channelOrAll: ChannelType | 'all',
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    if (channelOrAll === 'all') {
      return await this.syncToAllChannelsInternal(payload);
    } else {
      return await this.syncToChannel(channelOrAll, payload);
    }
  }

  /**
   * 모든 채널에 동일한 데이터 동기화 (내부 메서드)
   *
   * @param payload - 동기화할 데이터
   * @returns 통합 동기화 결과
   */
  private async syncToAllChannelsInternal(
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    const channels = ChannelsConfig.getActiveChannels();

    this.logger.log(`🌐 모든 채널 ${payload.dataType} 동기화 시작`);

    // 병렬 처리로 성능 개선
    const settledResults = await Promise.allSettled(
      channels.map((channel) => this.syncToChannel(channel, payload)),
    );

    const results: SyncResult[] = settledResults.map((settled) => {
      if (settled.status === 'fulfilled') {
        return settled.value;
      } else {
        return {
          success: false,
          failedCount: 1,
          errors: [{ message: settled.reason?.message || 'Unknown error' }],
        };
      }
    });

    const totalProcessed = results.reduce(
      (sum, r) => sum + (r.processedCount || 0),
      0,
    );
    const totalFailed = results.reduce(
      (sum, r) => sum + (r.failedCount || 0),
      0,
    );
    const allErrors = results.flatMap((r) => r.errors || []);
    const overallSuccess = results.every((r) => r.success);

    const consolidatedResult: SyncResult = {
      success: overallSuccess,
      processedCount: totalProcessed,
      failedCount: totalFailed,
      errors: allErrors.length > 0 ? allErrors : undefined,
    };

    this.logger.log(
      `🎯 모든 채널 ${payload.dataType} 동기화 완료: ${totalProcessed}건 성공, ${totalFailed}건 실패`,
    );

    return consolidatedResult;
  }

  /**
   * 서비스 상태 확인 (헬스체크용)
   *
   * @returns 서비스 상태 정보
   *
   * @example
   * ```typescript
   * const status = await channelAdapter.getHealthStatus();
   * console.log('서비스 상태:', status.isHealthy ? '정상' : '비정상');
   * ```
   */
  async getHealthStatus() {
    return {
      service: 'ChannelAdapterService',
      isHealthy: true,
      timestamp: new Date().toISOString(),
      version: '2.0.0-refactored',
    };
  }
}
