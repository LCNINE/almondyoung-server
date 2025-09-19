import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventPublisherService } from '@app/events';
import {
  ChannelStrategyFactory,
  ChannelType,
} from './strategies/channel-strategy.factory';
import { SyncStatusService } from './sync-status.service';
import {
  DataType,
  SyncResult,
  SyncToChannelPayload,
  NewEventLog,
  NewSyncHistory,
} from '../types';
import { InternalOrderEvent } from '../types';
import { ChannelCommand } from '../types';
import { ChannelAdapterEvents } from '../events/channel-events';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import * as schema from '../schema';
/**
 * 판매채널 어댑터 오케스트레이션 서비스
 *
 * 외부 판매채널과 내부 시스템 간의 데이터 동기화를 조율하는 핵심 서비스입니다.
 * 각 채널별 전략을 통해 데이터를 수집, 변환, 발행하는 역할을 담당합니다.
 *
 * @example
 * ```typescript
 * // 네이버 스마트스토어에서 주문 데이터 동기화
 * const events = await orchestrationService.pollAndPublish('naver_smartstore', 'orders');
 *
 * // 웹훅으로 수신된 이벤트 처리
 * const processedEvents = await orchestrationService.handleIncoming('coupang', webhookPayload);
 *
 * // 채널별 명령 실행 (발송처리, 취소승인 등)
 * const result = await orchestrationService.execute('naver_smartstore', {
 *   type: 'dispatch.confirm',
 *   orderId: '12345',
 *   tracking: { companyCode: 'CJ', number: '123456789' }
 * });
 * ```
 */
@Injectable()
export class AdapterOrchestrationService {
  private readonly logger = new Logger(AdapterOrchestrationService.name);

  constructor(
    private readonly factory: ChannelStrategyFactory,
    private readonly syncStatusService: SyncStatusService,
    @Optional()
    private readonly eventPublisher: EventPublisherService<ChannelAdapterEvents>,
    private readonly db: DbService<typeof schema>,
  ) {
    const eventStatus = this.eventPublisher ? '이벤트 발행 + ' : '';
    this.logger.log(
      `🎼 어댑터 오케스트레이션 서비스 초기화 완료 (${eventStatus}DB 연동)`,
    );
  }

  /**
   * 외부 채널에서 데이터를 폴링하고 내부 이벤트로 발행
   *
   * @param channel - 대상 판매채널 ('naver_smartstore', 'coupang' 등)
   * @param dataType - 동기화할 데이터 타입 ('orders', 'products', 'inventory' 등)
   * @returns 변환된 내부 이벤트 배열
   *
   * @example
   * ```typescript
   * // 네이버 스마트스토어에서 최근 24시간 주문 변경 사항 조회
   * const events = await pollAndPublish('naver_smartstore', 'orders');
   * console.log(`${events.length}건의 주문 이벤트가 동기화되었습니다.`);
   * ```
   */
  async pollAndPublish(
    channel: ChannelType,
    dataType: DataType,
  ): Promise<InternalOrderEvent[]> {
    const startTime = Date.now();
    this.logger.log(`🔄 [${channel}] ${dataType} 데이터 동기화 시작`);

    const sessionId = await this.syncStatusService.recordSyncStart(
      channel,
      dataType,
    );

    try {
      const strategy = this.factory.getStrategy(channel);
      const events = await strategy.syncFromChannel(dataType);
      const duration = Date.now() - startTime;
      const completedAt = new Date();

      this.logger.log(
        `✅ [${channel}] ${events.length}건의 ${dataType} 이벤트 동기화 완료 (${duration}ms)`,
      );

      // 🗃️ DB에 동기화 히스토리 기록
      await this.logSyncHistoryToDb(
        channel,
        dataType,
        { success: true, processedCount: events.length, failedCount: 0 },
        new Date(startTime),
        completedAt,
      );

      // 🗃️ 각 이벤트를 DB에 기록
      for (const event of events) {
        await this.logEventToDb(
          channel,
          `${dataType}_received`,
          event.externalOrderId,
          event, // rawData로 전체 이벤트 저장
          event, // transformedData로도 동일하게 저장 (이미 변환된 상태)
          event.externalProductOrderId,
        );
      }

      await this.syncStatusService.recordSyncComplete(channel, dataType, {
        eventCount: events.length,
        processingTime: duration,
        sessionId,
      });

      // // 🎯 주문 동기화 완료 이벤트 발행
      // if (dataType === 'orders' && events.length > 0) {
      //   await this.eventPublisher.publishEvent('order.sync.completed', {
      //     channelType: channel,
      //     syncType: 'inbound', // 외부에서 내부로 가져오는 동기화
      //     orderCount: events.length,
      //     orders: events,
      //     syncDurationMs: duration,
      //   });

      //   this.logger.log(
      //     `📡 [${channel}] 주문 동기화 완료 이벤트 발행: ${events.length}건 - DB 기록 완료`,
      //   );
      // }

      // TODO: 중복검사(Redis) 구현 예정

      return events;
    } catch (error) {
      const duration = Date.now() - startTime;
      const completedAt = new Date();

      this.logger.error(
        `❌ [${channel}] ${dataType} 동기화 실패 (${duration}ms):`,
        error.message,
      );

      // 🗃️ DB에 실패 히스토리 기록
      await this.logSyncHistoryToDb(
        channel,
        dataType,
        {
          success: false,
          processedCount: 0,
          failedCount: 1,
          errors: [{ message: error.message }],
        },
        new Date(startTime),
        completedAt,
      );

      await this.syncStatusService.recordSyncFailure(channel, dataType, {
        message: error.message,
        processingTime: duration,
        sessionId,
      });

      // // 🚨 동기화 실패 이벤트 발행
      // await this.eventPublisher.publishEvent('sync.failure', {
      //   channelType: channel,
      //   syncType: 'orders',
      //   failureReason: error.message,
      //   retryCount: 0, // 첫 번째 실패
      //   maxRetries: 3, // 최대 재시도 횟수 (설정값)
      // });

      this.logger.log(
        `🚨 [${channel}] ${dataType} 동기화 실패 이벤트 발행 - DB 기록 완료`,
      );

      throw new Error(`${channel} ${dataType} 동기화 실패: ${error.message}`);
    }
  }

  /**
   * 외부 채널에서 수신된 웹훅/이벤트 처리
   *
   * @param channel - 이벤트를 발송한 판매채널
   * @param payload - 수신된 이벤트 페이로드
   * @returns 변환된 내부 이벤트 배열
   *
   * @example
   * ```typescript
   * // 쿠팡에서 수신된 웹훅 처리
   * const events = await handleIncoming('coupang', {
   *   orderId: '12345',
   *   status: 'SHIPPED',
   *   timestamp: '2023-01-01T10:00:00Z'
   * });
   * ```
   */
  async handleIncoming(
    channel: ChannelType,
    payload: any,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(`📨 [${channel}] 웹훅 이벤트 수신`, {
      payloadKeys: Object.keys(payload || {}),
    });

    try {
      // 1. 채널별 전략 가져오기
      const strategy = this.factory.getStrategy(channel);

      // 2. 외부 이벤트를 내부 표준 형식으로 변환
      const events = await strategy.processIncomingEvent(payload);

      this.logger.log(
        `✅ [${channel}] ${events.length}건의 웹훅 이벤트 처리 완료`,
      );

      // TODO: 중복검사 구현 예정
      // TODO: 이벤트 브로커 발행 구현 예정

      return events;
    } catch (error) {
      this.logger.error(
        `❌ [${channel}] 웹훅 이벤트 처리 실패:`,
        error.message,
      );
      throw new Error(`${channel} 웹훅 처리 실패: ${error.message}`);
    }
  }

  /**
   * 특정 채널에 대한 명령 실행 (발송처리, 취소승인 등)
   *
   * @param channel - 대상 판매채널
   * @param command - 실행할 명령 객체
   * @returns 명령 실행 결과
   *
   * @example
   * ```typescript
   * // 네이버 스마트스토어에서 주문 발송처리
   * const result = await execute('naver_smartstore', {
   *   type: 'dispatch.confirm',
   *   orderId: '2025091550078121',
   *   productOrderIds: ['2025091565429621'],
   *   tracking: {
   *     companyCode: 'CJ',
   *     number: '123456789012'
   *   },
   *   dispatchedAt: '2023-01-01T15:00:00+09:00'
   * });
   *
   * if (result.success) {
   *   console.log('발송처리가 완료되었습니다.');
   * }
   * ```
   */
  async execute(
    channel: ChannelType,
    command: ChannelCommand,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    this.logger.log(`⚡ [${channel}] 명령 실행: ${command.type}`, {
      orderId: 'orderId' in command ? command.orderId : undefined,
      claimId: 'claimId' in command ? command.claimId : undefined,
    });

    try {
      // 1. 채널별 전략 가져오기
      const strategy = this.factory.getStrategy(channel);

      // 2. 명령 실행
      const result = await strategy.executeCommand(command);
      const duration = Date.now() - startTime;

      // 3. 명령 실행 완료 이벤트 발행
      const targetId = (
        'orderId' in command
          ? command.orderId
          : 'claimId' in command
            ? command.claimId
            : 'productOrderIds' in command
              ? command.productOrderIds?.[0]
              : 'unknown'
      ) as string;

      await this.eventPublisher.publishEvent('command.executed', {
        channelType: channel,
        commandType: command.type,
        targetId,
        executionResult: result.success ? 'success' : 'failed',
        processedCount: result.processedCount || 0,
        failedCount: result.failedCount || 0,
        errors: result.errors?.map((err) => ({
          id: err.id || 'unknown',
          message: err.message,
        })),
        executionDurationMs: duration,
      });

      if (result.success) {
        this.logger.log(
          `✅ [${channel}] 명령 실행 성공: ${command.type} (${duration}ms)`,
        );
      } else {
        this.logger.warn(
          `⚠️ [${channel}] 명령 실행 실패: ${command.type} (${duration}ms)`,
          {
            errors: result.errors,
          },
        );
      }

      this.logger.log(
        `📡 [${channel}] 명령 실행 완료 이벤트 발행: ${command.type}`,
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ [${channel}] 명령 실행 오류: ${command.type} (${duration}ms)`,
        error.message,
      );
      throw new Error(`${channel} 명령 실행 실패: ${error.message}`);
    }
  }

  /**
   * 🔄 내부 데이터를 외부 채널로 동기화 (송신)
   *
   * @param channel - 대상 판매채널
   * @param payload - 동기화할 데이터 페이로드
   * @returns 동기화 결과
   *
   * @example
   * ```typescript
   * // 재고 동기화
   * const result = await orchestrator.syncToChannel('naver_smartstore', {
   *   dataType: 'inventory',
   *   payload: { productId: '12345', stockQuantity: 100, isOptionProduct: false }
   * });
   * ```
   */
  async syncToChannel(
    channel: ChannelType,
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    const startTime = Date.now();
    this.logger.log(`📤 [${channel}] ${payload.dataType} 송신 동기화 시작`);

    try {
      const strategy = this.factory.getStrategy(channel);
      const result = await strategy.syncToChannel(payload);
      const duration = Date.now() - startTime;
      const completedAt = new Date();

      // 🗃️ DB에 동기화 히스토리 기록
      await this.logSyncHistoryToDb(
        channel,
        payload.dataType,
        result,
        new Date(startTime),
        completedAt,
      );

      // 🗃️ 송신 이벤트를 DB에 기록
      const targetId =
        payload.dataType === 'inventory'
          ? payload.payload.productId
          : payload.dataType === 'order_status'
            ? payload.payload.orderId
            : 'unknown';

      await this.logEventToDb(
        channel,
        `${payload.dataType}_sent`,
        targetId,
        payload, // rawData로 요청 페이로드 저장
        result, // transformedData로 응답 결과 저장
      );

      // 🎯 재고 동기화 완료 이벤트 발행
      if (payload.dataType === 'inventory') {
        await this.eventPublisher.publishEvent('inventory.sync.completed', {
          channelType: channel,
          productId: payload.payload.productId,
          syncType: payload.payload.isOptionProduct ? 'option' : 'single',
          stockQuantity: payload.payload.stockQuantity,
          syncResult: result.success ? 'success' : 'failed',
          errorMessage: result.success
            ? undefined
            : result.errors?.[0]?.message,
        });

        this.logger.log(
          `📡 [${channel}] 재고 동기화 완료 이벤트 발행: ${payload.payload.productId} - DB 기록 완료`,
        );
      }

      if (result.success) {
        this.logger.log(
          `✅ [${channel}] ${payload.dataType} 송신 동기화 성공 (${duration}ms) - DB 기록 완료`,
        );
      } else {
        this.logger.warn(
          `⚠️ [${channel}] ${payload.dataType} 송신 동기화 실패 (${duration}ms) - DB 기록 완료`,
          {
            errors: result.errors,
          },
        );
      }

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const completedAt = new Date();

      // 🗃️ DB에 실패 히스토리 기록
      await this.logSyncHistoryToDb(
        channel,
        payload.dataType,
        {
          success: false,
          processedCount: 0,
          failedCount: 1,
          errors: [{ message: error.message }],
        },
        new Date(startTime),
        completedAt,
      );

      this.logger.error(
        `❌ [${channel}] ${payload.dataType} 송신 동기화 오류 (${duration}ms) - DB 기록 완료:`,
        error.message,
      );

      // 🚨 동기화 실패 이벤트 발행
      await this.eventPublisher.publishEvent('sync.failure', {
        channelType: channel,
        syncType: 'inventory',
        failureReason: error.message,
        retryCount: 0,
        maxRetries: 3,
        affectedIds:
          payload.dataType === 'inventory'
            ? [payload.payload.productId]
            : undefined,
      });

      throw new Error(
        `${channel} ${payload.dataType} 송신 동기화 실패: ${error.message}`,
      );
    }
  }

  /**
   * 모든 활성 채널에서 특정 데이터 타입 동기화
   *
   * @param dataType - 동기화할 데이터 타입
   * @returns 채널별 동기화 결과
   *
   * @example
   * ```typescript
   * // 모든 채널에서 주문 데이터 동기화
   * const results = await syncAllChannels('orders');
   * results.forEach(result => {
   *   console.log(`${result.channel}: ${result.events.length}건 동기화`);
   * });
   * ```
   */
  async syncAllChannels(dataType: DataType): Promise<
    Array<{
      channel: ChannelType;
      events: InternalOrderEvent[];
      success: boolean;
      error?: string;
    }>
  > {
    const channels: ChannelType[] = ['naver_smartstore', 'coupang', 'medusa'];
    const results: Array<any> = [];

    this.logger.log(`🌐 전체 채널 ${dataType} 동기화 시작`);

    for (const channel of channels) {
      try {
        const events = await this.pollAndPublish(channel, dataType);
        results.push({ channel, events, success: true });
      } catch (error) {
        this.logger.error(`❌ [${channel}] 동기화 실패:`, error.message);
        results.push({
          channel,
          events: [],
          success: false,
          error: error.message,
        });
      }
    }

    const totalEvents = results.reduce((sum, r) => sum + r.events.length, 0);
    const successCount = results.filter((r) => r.success).length;

    this.logger.log(
      `🏁 전체 채널 동기화 완료: ${successCount}/${channels.length}개 채널, 총 ${totalEvents}건 이벤트`,
    );

    return results;
  }

  /**
   * 모든 활성 채널에 동일한 명령 실행
   *
   * 예: 내부 시스템에서 상품 가격 변경 시, 연결된 모든 채널에 가격 업데이트 명령 전송
   *
   * @param command - 실행할 명령 객체
   * @returns 채널별 명령 실행 결과
   *
   * @example
   * ```typescript
   * // 모든 채널에 상품 재고 업데이트
   * const results = await executeOnAllChannels({
   * type: 'inventory.update',
   * productId: 'INTERNAL-SKU-001',
   * quantity: 50
   * });
   * ```
   */
  async executeOnAllChannels(command: ChannelCommand): Promise<
    Array<{
      channel: ChannelType;
      result: SyncResult;
      success: boolean;
      error?: string;
    }>
  > {
    const channels: ChannelType[] = ['naver_smartstore', 'coupang', 'medusa'];
    const results: Array<any> = [];

    this.logger.log(`🌐 전체 채널에 명령 실행 시작: ${command.type}`);

    for (const channel of channels) {
      try {
        const result = await this.execute(channel, command);
        results.push({
          channel,
          result,
          success: result.success,
        });
      } catch (error) {
        this.logger.error(
          `❌ [${channel}] 명령 실행 중 오류 발생:`,
          error.message,
        );
        results.push({
          channel,
          result: { success: false, errors: [{ message: error.message }] },
          success: false,
          error: error.message,
        });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    this.logger.log(
      `🏁 전체 채널 명령 실행 완료: ${successCount}/${channels.length}개 채널 성공`,
    );

    return results;
  }

  // ===== DB 기록 관련 헬퍼 메서드들 =====

  /**
   * 🗃️ 이벤트 로그를 DB에 기록
   *
   * @param channelType - 채널 타입
   * @param eventType - 이벤트 타입 (order_created, inventory_updated 등)
   * @param externalOrderId - 외부 주문 ID
   * @param rawData - 원본 데이터
   * @param transformedData - 변환된 데이터
   * @param externalClaimId - 외부 클레임 ID (선택사항)
   * @returns 생성된 이벤트 로그 ID
   */
  private async logEventToDb(
    channelType: ChannelType,
    eventType: string,
    externalOrderId: string,
    rawData: any,
    transformedData?: any,
    externalClaimId?: string,
  ): Promise<string> {
    try {
      // 채널 타입을 UUID로 변환 (실제 환경에서는 채널 매핑 테이블 참조)
      const channelId = this.getChannelUuid(channelType);

      const eventLogData: NewEventLog = {
        channelId,
        eventType,
        externalOrderId,
        externalClaimId: externalClaimId || null,
        rawData,
        transformedData: transformedData || null,
        status: 'pending',
        retryCount: 0,
      };

      const [insertedLog] = await this.db.db
        .insert(schema.eventLogs)
        .values(eventLogData)
        .returning({ id: schema.eventLogs.id });

      this.logger.debug(
        `📝 이벤트 로그 기록: ${insertedLog.id} (${channelType}/${eventType})`,
      );
      return insertedLog.id;
    } catch (error) {
      this.logger.error(`❌ 이벤트 로그 기록 실패:`, error.message);
      throw new Error(`이벤트 로그 기록 실패: ${error.message}`);
    }
  }

  /**
   * 🗃️ 동기화 히스토리를 DB에 기록
   *
   * @param channelType - 채널 타입
   * @param syncType - 동기화 타입 (orders, inventory, products 등)
   * @param result - 동기화 결과
   * @param startedAt - 시작 시각
   * @param completedAt - 완료 시각
   * @returns 생성된 동기화 히스토리 ID
   */
  private async logSyncHistoryToDb(
    channelType: ChannelType,
    syncType: string,
    result: SyncResult,
    startedAt: Date,
    completedAt?: Date,
  ): Promise<string> {
    try {
      const channelId = this.getChannelUuid(channelType);

      const syncHistoryData: NewSyncHistory = {
        channelId,
        syncType,
        status: result.success
          ? 'success'
          : result.processedCount && result.processedCount > 0
            ? 'partial'
            : 'failed',
        totalCount: (result.processedCount || 0) + (result.failedCount || 0),
        successCount: result.processedCount || 0,
        failedCount: result.failedCount || 0,
        startedAt,
        completedAt: completedAt || null,
        errorDetails:
          result.errors && result.errors.length > 0 ? result.errors : null,
      };

      const [insertedHistory] = await this.db.db
        .insert(schema.syncHistories)
        .values(syncHistoryData)
        .returning({ id: schema.syncHistories.id });

      this.logger.debug(
        `📊 동기화 히스토리 기록: ${insertedHistory.id} (${channelType}/${syncType})`,
      );
      return insertedHistory.id;
    } catch (error) {
      this.logger.error(`❌ 동기화 히스토리 기록 실패:`, error.message);
      throw new Error(`동기화 히스토리 기록 실패: ${error.message}`);
    }
  }

  /**
   * 🗃️ 이벤트 로그 상태를 업데이트
   *
   * @param eventLogId - 이벤트 로그 ID
   * @param status - 새로운 상태 ('processed', 'failed')
   * @param errorMessage - 에러 메시지 (실패 시)
   */
  private async updateEventLogStatus(
    eventLogId: string,
    status: 'processed' | 'failed',
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.db.db
        .update(schema.eventLogs)
        .set({
          status,
          errorMessage: errorMessage || null,
          processedAt: status === 'processed' ? new Date() : null,
        })
        .where(eq(schema.eventLogs.id, eventLogId));

      this.logger.debug(
        `📝 이벤트 로그 상태 업데이트: ${eventLogId} → ${status}`,
      );
    } catch (error) {
      this.logger.error(`❌ 이벤트 로그 상태 업데이트 실패:`, error.message);
    }
  }

  /**
   * 채널 타입을 UUID로 변환
   * (실제 환경에서는 channels 테이블에서 조회해야 함)
   */
  private getChannelUuid(channelType: ChannelType): string {
    // TODO: 실제 환경에서는 channels 테이블에서 channelType으로 UUID를 조회
    const channelMapping: Record<ChannelType, string> = {
      naver_smartstore: '01234567-89ab-cdef-0123-456789abcdef',
      coupang: '11234567-89ab-cdef-0123-456789abcdef',
      medusa: '21234567-89ab-cdef-0123-456789abcdef',
    };
    return channelMapping[channelType];
  }
}
