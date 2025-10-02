import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { StreamPublisher } from '@app/events';
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
  NewProcessedEvent,
  ChannelAdapterSchema,
} from '../types';
import { InternalOrderEvent, OrderQuery } from '../types';
import { ChannelCommand, ChannelQuery } from '../types';
import { ChannelAdapterEvents } from '@app/shared/streams';
import { DbService } from '@app/db';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../schema';
import { channelAdapterSchema } from '../schema';
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
    private readonly eventPublisher: StreamPublisher<ChannelAdapterEvents>,

    private readonly db: DbService<typeof channelAdapterSchema>,

  ) {
    this.logger.log(
      `🎼 어댑터 오케스트레이션 서비스 초기화 완료 (이벤트 발행 + DB 연동 + 멱등키 처리)`,
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

      // 🗃️ 트랜잭션으로 동기화 히스토리와 모든 이벤트 로그를 원자적으로 처리
      await this.db.db.transaction(async (tx) => {
        // 동기화 히스토리 기록
        await tx.insert(schema.syncHistories).values({
          channelId: channel, // 실제 UUID가 필요하지만 임시로 channel 문자열 사용
          syncType: dataType,
          status: 'completed',
          startedAt: new Date(startTime),
          completedAt,
          totalCount: events.length,
          successCount: events.length,
          failedCount: 0,
        });

        // 모든 이벤트를 한 번에 기록 (배치 처리)
        if (events.length > 0) {
          const eventLogEntries = events.map((event) => ({
            channelId: channel, // 실제 UUID가 필요하지만 임시로 channel 문자열 사용
            eventType: `${dataType}_received`,
            externalOrderId: event.externalOrderId,
            rawData: event, // rawData로 전체 이벤트 저장
            transformedData: event, // transformedData로도 동일하게 저장 (이미 변환된 상태)
            processedAt: completedAt,
          }));

          await tx.insert(schema.eventLogs).values(eventLogEntries);
        }

        this.logger.log(
          `🔒 [${channel}] 트랜잭션 완료: 동기화 히스토리 1건 + 이벤트 로그 ${events.length}건 기록`,
        );
      });

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

      // 🗃️ 트랜잭션으로 실패 히스토리 기록
      await this.db.db.transaction(async (tx) => {
        await tx.insert(schema.syncHistories).values({
          channelId: channel, // 실제 UUID가 필요하지만 임시로 channel 문자열 사용
          syncType: dataType,
          status: 'failed',
          startedAt: new Date(startTime),
          completedAt,
          totalCount: 0,
          successCount: 0,
          failedCount: 1,
          errorDetails: {
            success: false,
            processedCount: 0,
            failedCount: 1,
            errors: [{ message: error.message }],
          },
        });

        this.logger.log(
          `🔒 [${channel}] 실패 트랜잭션 완료: 실패 히스토리 기록`,
        );
      });

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
   * // 🎯 표준 비즈니스 명령 - 채널과 무관한 순수 비즈니스 행위만 표현
   *
   * // 주문 준비 처리 (네이버: order.confirm, 쿠팡: order.acknowledge)
   * const prepareResult = await execute('naver_smartstore', {
   *   type: 'order.prepare',
   *   orderIds: ['ORDER_2025091550078121', 'ORDER_2025091550078122']
   * });
   *
   * // 발송 처리 (네이버/쿠팡 공통: 표준 송장 정보로 처리)
   * const shipResult = await execute('coupang', {
   *   type: 'dispatch.ship',
   *   orderId: 'ORDER_2025091550078121',
   *   tracking: {
   *     companyCode: 'CJ',
   *     number: '123456789012'
   *   },
   *   dispatchedAt: '2023-01-01T15:00:00+09:00'
   * });
   *
   * // 반품 승인 처리 (네이버/쿠팡 공통: 표준 클레임 ID 사용)
   * const returnResult = await execute('coupang', {
   *   type: 'return.approve',
   *   claimId: 'CLAIM_20250915_001',  // 내부 표준 클레임 ID
   *   items: [{ orderItemId: 'ITEM_001', quantity: 1 }]
   * });
   *
   * // 회수송장 등록 (표준 클레임 + 배송 정보)
   * const invoiceResult = await execute('coupang', {
   *   type: 'return.register_collection_invoice',
   *   claimId: 'CLAIM_20250915_001',
   *   collectionType: 'RETURN',
   *   tracking: {
   *     companyCode: 'CJGLS',
   *     number: '1234567890123'
   *   }
   * });
   *
   * // 교환 상품 입고 확인 (SSOT 원칙 - 표준 claimId 사용)
   * const exchangeReceiptResult = await execute('coupang', {
   *   type: 'exchange.confirm_receipt',
   *   claimId: 'EXCHANGE_20250915_001'  // 내부 표준 교환 ID
   * });
   *
   * // 교환 요청 거부 (표준 거부 사유)
   * const exchangeRejectResult = await execute('coupang', {
   *   type: 'exchange.reject',
   *   claimId: 'EXCHANGE_20250915_002',
   *   reason: '품절'  // Strategy에서 쿠팡 거부코드로 자동 번역
   * });
   *
   * // 교환 재발송 송장 업로드
   * const exchangeInvoiceResult = await execute('coupang', {
   *   type: 'exchange.upload_invoice',
   *   claimId: 'EXCHANGE_20250915_003',
   *   tracking: {
   *     companyCode: 'CJ',
   *     number: '1234567890123'
   *   },
   *   items: [{ itemId: 'ITEM_001', shipmentBoxId: '12345' }]
   * });
   *
   * // ✅ 모든 결과는 동일한 SyncResult 구조
   * if (result.success) {
   *   console.log(`${result.processedCount}건 처리 완료`);
   * } else {
   *   console.error('처리 실패:', result.errors);
   * }
   * ```
   */
  async execute(
    channel: ChannelType,
    command: ChannelCommand,
  ): Promise<SyncResult> {
    const startTime = Date.now();

    // 🎯 표준 필드만 로깅 (채널별 세부사항은 Strategy에서 처리)
    const logContext: any = {};
    if ('orderId' in command) logContext.orderId = command.orderId;
    if ('orderIds' in command) logContext.orderIds = command.orderIds;
    if ('claimId' in command) logContext.claimId = command.claimId;
    if ('tracking' in command) logContext.hasTracking = !!command.tracking;

    this.logger.log(
      `⚡ [${channel}] 표준 명령 실행: ${command.type}`,
      logContext,
    );

    try {
      // 1. 채널별 전략 가져오기
      const strategy = this.factory.getStrategy(channel);

      // 2. 명령 실행
      const result = await strategy.executeCommand(command);
      const duration = Date.now() - startTime;

      // 3. 명령 실행 완료 이벤트 발행 (표준 필드만 사용)
      const targetId = (
        'orderId' in command
          ? command.orderId
          : 'orderIds' in command
            ? command.orderIds?.[0]
            : 'claimId' in command
              ? command.claimId
              : 'unknown'
      ) as string;

      await this.eventPublisher.publishEvent({
        eventType: 'CommandExecuted',
        aggregateId: `${channel}-${targetId}`,
        payload: {
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
        },
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
        await this.eventPublisher.publishEvent({
          eventType: 'InventorySyncCompleted',
          aggregateId: `${channel}-${payload.payload.productId}`,
          payload: {
            channelType: channel,
            productId: payload.payload.productId,
            syncType: payload.payload.isOptionProduct ? 'option' : 'single',
            stockQuantity: payload.payload.stockQuantity,
            syncResult: result.success ? 'success' : 'failed',
            errorMessage: result.success
              ? undefined
              : result.errors?.[0]?.message,
          },
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
      await this.eventPublisher.publishEvent({
        eventType: 'SyncFailure',
        aggregateId: `${channel}-sync-failure`,
        payload: {
          channelType: channel,
          syncType: 'inventory',
          failureReason: error.message,
          retryCount: 0,
          maxRetries: 3,
          affectedIds:
            payload.dataType === 'inventory'
              ? [payload.payload.productId]
              : undefined,
        },
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
    const channels: ChannelType[] = ['naver_smartstore', 'coupang']; // 메두사 제외
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
   * 🔍 주문 조회: 표준화된 쿼리 객체를 사용하여 특정 채널에서 주문 정보를 조회
   *
   * 🎯 통합 조회 인터페이스: 모든 채널이 findOrders를 구현하여 일관된 조회 경험 제공
   *
   * 📋 채널별 구현 방식:
   * - 쿠팡: 직접 API 호출 (shipmentBoxId, orderId)
   * - 네이버: API 조합 (orderId → productOrderIds → getOrderDetails)
   * - 메두사: 직접 API 호출 (orderId)
   *
   * @param channel 조회할 채널
   * @param query 조회 조건을 담은 표준 쿼리 객체
   * @returns 변환된 내부 주문 이벤트 배열. 결과가 없으면 빈 배열을 반환합니다.
   *
   * @example
   * ```typescript
   * // 쿠팡 shipmentBoxId로 조회 (직접 API)
   * const orders = await orchestrator.findOrders('coupang', { by: 'channelShipmentId', id: '642538971006401429' });
   *
   * // 네이버 orderId로 조회 (API 조합)
   * const orders = await orchestrator.findOrders('naver_smartstore', { by: 'channelOrderId', id: '2023010310000001' });
   * ```
   */
  async findOrders(
    channel: ChannelType,
    query: OrderQuery,
  ): Promise<InternalOrderEvent[]> {
    this.logger.log(
      `🔍 [${channel}] 주문 조회 시작: ${query.by} = ${query.id}`,
    );

    try {
      const strategy = this.factory.getStrategy(channel);

      // 🎯 모든 전략이 findOrders를 구현하므로 바로 호출
      const orderEvents = await strategy.findOrders(query);

      this.logger.log(
        `✅ [${channel}] 주문 조회 성공: ${orderEvents.length}건 조회됨 (${query.by}=${query.id})`,
      );

      // 조회 결과에 대한 상세 로깅
      if (orderEvents.length > 0) {
        this.logger.debug(
          `📋 [${channel}] 조회된 주문 정보: ${orderEvents.map((order) => order.externalOrderId).join(', ')}`,
        );
      }

      return orderEvents;
    } catch (error) {
      this.logger.error(
        `❌ [${channel}] 주문 조회 실패: ${query.by} = ${query.id} - ${error.message}`,
      );
      throw new Error(`${channel} 채널에서 주문 조회 실패: ${error.message}`);
    }
  }

  /**
   * 🔍 CQRS 패턴: 채널별 조회 명령 실행 (상태 변경 없는 읽기 전용)
   *
   * 🎯 SSOT 원칙 적용: 모든 조회 결과는 표준 내부 모델로 번역되어 반환
   *
   * @param channel 조회할 채널
   * @param query 조회 조건을 담은 표준 쿼리 객체
   * @returns 표준 내부 모델로 번역된 조회 결과
   *
   * @example
   * ```typescript
   * // 🔍 교환 요청 목록 조회 (표준 내부 모델로 반환)
   * const exchanges = await orchestrator.executeQuery('coupang', {
   *   type: 'exchange.requests',
   *   dateFrom: '2025-01-01T00:00:00',
   *   dateTo: '2025-01-07T23:59:59',
   *   status: 'RECEIPT'
   * });
   * // 반환: InternalExchangeEvent[] (표준화된 내부 모델)
   *
   * // 🔍 반품 철회 이력 조회
   * const withdrawals = await orchestrator.executeQuery('coupang', {
   *   type: 'return.withdrawal_history',
   *   dateFrom: '2025-01-01T00:00:00',
   *   dateTo: '2025-01-07T23:59:59'
   * });
   *
   * // 🔍 배송 히스토리 조회
   * const deliveryHistory = await orchestrator.executeQuery('coupang', {
   *   type: 'delivery.history',
   *   orderId: 'ORDER_12345'
   * });
   * ```
   */
  async executeQuery(channel: ChannelType, query: ChannelQuery): Promise<any> {
    const startTime = Date.now();

    // 🎯 표준 필드만 로깅 (채널별 세부사항은 Strategy에서 처리)
    const logContext: any = { queryType: query.type };
    if ('orderId' in query) logContext.orderId = query.orderId;
    if ('claimId' in query) logContext.claimId = query.claimId;
    if ('dateFrom' in query) logContext.hasDateRange = true;

    this.logger.log(
      `🔍 [${channel}] 표준 조회 실행: ${query.type}`,
      logContext,
    );

    try {
      // 1. 채널별 전략 가져오기
      const strategy = this.factory.getStrategy(channel);

      // 2. 조회 실행 (Strategy에서 표준 내부 모델로 번역하여 반환)
      const result = await strategy.executeQuery(query);
      const duration = Date.now() - startTime;

      // 3. 조회 완료 이벤트 발행
      await this.eventPublisher.publishEvent({
        eventType: 'QueryExecuted',
        aggregateId: `${channel}-query-${query.type}`,
        payload: {
          channelType: channel,
          queryType: query.type,
          resultCount: Array.isArray(result) ? result.length : 1,
          executionDurationMs: duration,
          success: true,
        },
      });

      this.logger.log(
        `✅ [${channel}] 조회 실행 성공: ${query.type} (${duration}ms)`,
        {
          resultCount: Array.isArray(result) ? result.length : 1,
        },
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 실패 이벤트 발행
      await this.eventPublisher.publishEvent({
        eventType: 'QueryExecuted',
        aggregateId: `${channel}-query-${query.type}`,
        payload: {
          channelType: channel,
          queryType: query.type,
          resultCount: 0,
          executionDurationMs: duration,
          success: false,
          errorMessage: error.message,
        },
      });

      this.logger.error(
        `❌ [${channel}] 조회 실행 실패: ${query.type} (${duration}ms)`,
        error.message,
      );

      // 🎯 BadRequestException은 그대로 전달 (Zod 에러 보존)
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new Error(`${channel} 조회 실행 실패: ${error.message}`);
    }
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
    const channels: ChannelType[] = ['naver_smartstore', 'coupang']; // 메두사 제외
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

  // ===== 멱등키 처리 관련 메서드들 (Consumer에서 사용) =====

  /**
   * 멱등키 기반 이벤트 처리 여부 확인
   *
   * Consumer에서 이벤트 중복 처리를 방지하기 위해 사용합니다.
   *
   * @param idempotencyKey 멱등키 (SOURCE:EVENT_TYPE:RESOURCE_ID:VERSION)
   * @returns 이미 처리된 이벤트인지 여부
   *
   * @example
   * ```typescript
   * const key = 'WMS:STOCK_CHANGED:SKU-001:1695462345000';
   * const isProcessed = await orchestrator.isProcessed(key);
   * if (isProcessed) {
   *   this.logger.debug('이미 처리된 이벤트입니다.');
   *   return;
   * }
   * ```
   */

  /**
   * 이벤트 처리 완료 마킹
   *
   * Consumer에서 이벤트 처리 완료 후 중복 처리 방지를 위해 호출합니다.
   *
   * @param data 처리된 이벤트 정보
   * @returns 생성된 레코드 또는 null (이미 존재하는 경우)
   *
   * @example
   * ```typescript
   * await orchestrator.markProcessed({
   *   idempotencyKey: 'WMS:STOCK_CHANGED:SKU-001:1695462345000',
   *   source: 'WMS',
   *   eventType: 'STOCK_CHANGED',
   *   resourceId: 'SKU-001',
   *   eventVersion: '1695462345000'
   * });
   * ```
   */

  /**
   * 이벤트 처리 실패 마킹
   *
   * Consumer에서 이벤트 처리 실패 시 재시도 관리를 위해 호출합니다.
   *
   * @param idempotencyKey 멱등키
   * @param errorMessage 에러 메시지
   * @param incrementRetry 재시도 횟수 증가 여부 (기본값: true)
   *
   * @example
   * ```typescript
   * await orchestrator.markFailed(
   *   'WMS:STOCK_CHANGED:SKU-001:1695462345000',
   *   'Network timeout error',
   *   true
   * );
   * ```
   */

  /**
   * 멱등키 생성 유틸리티 (Consumer에서 사용)
   *
   * @param source 이벤트 발행 주체 (WMS, OMS, PIM)
   * @param eventType 이벤트 타입 (STOCK_CHANGED, FULFILLMENT_UPDATED 등)
   * @param resourceId 리소스 ID (SKU, ORDER_ID 등)
   * @param eventVersion 이벤트 버전 (timestamp 또는 sequence)
   * @returns 생성된 멱등키
   *
   * @example
   * ```typescript
   * const key = orchestrator.generateIdempotencyKey(
   *   'WMS', 'STOCK_CHANGED', 'SKU-001', '1695462345000'
   * );
   * // 결과: 'WMS:STOCK_CHANGED:SKU-001:1695462345000'
   * ```
   */

  /**
   * Consumer에서 모든 채널에 동기화 (Consumer 전용 메서드)
   *
   * Consumer에서 내부 이벤트를 모든 채널에 동기화할 때 사용합니다.
   *
   * @param channelOrAll 'all' 키워드 또는 채널 타입
   * @param payload 동기화할 데이터 페이로드
   * @returns 동기화 결과 (all인 경우 통합 결과)
   *
   * @example
   * ```typescript
   * // 모든 채널에 재고 동기화
   * await orchestrator.syncToChannelOrAll('all', {
   *   dataType: 'inventory',
   *   payload: { productId: 'SKU-001', stockQuantity: 100 }
   * });
   * ```
   */
  async syncToChannelOrAll(
    channelOrAll: ChannelType | 'all',
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    if (channelOrAll === 'all') {
      return this.syncToAllChannelsInternal(payload);
    } else {
      // 기존 단일 채널 동기화 로직 호출
      return this.syncToChannel(channelOrAll, payload);
    }
  }

  /**
   * 모든 채널에 동일한 데이터 동기화 (내부 메서드)
   *
   * @param payload 동기화할 데이터 페이로드
   * @returns 통합 동기화 결과
   */
  private async syncToAllChannelsInternal(
    payload: SyncToChannelPayload,
  ): Promise<SyncResult> {
    const channels: ChannelType[] = ['naver_smartstore', 'coupang']; // 메두사 제외
    const results: SyncResult[] = [];

    this.logger.log(`🌐 모든 채널 ${payload.dataType} 동기화 시작`);

    // 병렬로 모든 채널에 동기화
    const syncPromises = channels.map(async (channel) => {
      try {
        // 기존 syncToChannel 메서드 호출
        const result = await this.syncToChannel(channel, payload);
        results.push(result);
        return result;
      } catch (error) {
        const errorResult: SyncResult = {
          success: false,
          failedCount: 1,
          errors: [{ message: error.message }],
        };
        results.push(errorResult);
        return errorResult;
      }
    });

    await Promise.all(syncPromises);

    // 결과 통합
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

  // ===== WMS 연동 메서드 (CTO SoT 원칙) =====

  /**
   * 채널 주문을 WMS에 전달하고 이벤트 로그 기록
   *
   * CTO SoT 원칙에 따라 어댑터가 SoT인 판매채널 주문을 WMS에 동기 요청으로 전달합니다.
   * 성공/실패 여부와 관계없이 이벤트 로그를 기록하여 추적 가능성을 보장합니다.
   *
   * @param channel 채널 타입
   * @param orderEvent 주문 이벤트
   * @returns WMS에서 생성된 판매주문 정보
   *
   * @example
   * ```typescript
   * // 쿠팡 주문을 WMS에 전달
   * const wmsOrder = await orchestrator.createOrderInWms('coupang', coupangOrderEvent);
   * ```
   */
  async createOrderInWms(channel: ChannelType, orderEvent: InternalOrderEvent) {
    const startTime = Date.now();
    const operationId = `CREATE_ORDER_WMS:${channel}:${orderEvent.externalOrderId}`;

    this.logger.log(
      `🏭 [${channel}→WMS] 주문 생성 오케스트레이션 시작: ${orderEvent.externalOrderId}`,
      {
        channelType: orderEvent.channelType,
        buyerName: orderEvent.buyer?.name,
        operationId,
      },
    );

    try {
      // 1. 채널별 전략을 통해 WMS에 주문 생성
      const strategy = this.factory.getStrategy(channel);
      const wmsOrder = await strategy.createOrderInWms(orderEvent);

      const duration = Date.now() - startTime;

      // 2. 성공 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'order_created_in_wms',
        externalOrderId: orderEvent.externalOrderId,
        externalClaimId: null,
        rawData: orderEvent,
        transformedData: wmsOrder,
        status: 'processed',
        processedAt: new Date(),
      });

      this.logger.log(
        `✅ [${channel}→WMS] 주문 생성 오케스트레이션 성공: ${wmsOrder.id} (${duration}ms)`,
        {
          channelOrderId: orderEvent.externalOrderId,
          wmsOrderId: wmsOrder.id,
          wmsStatus: wmsOrder.status,
          operationId,
        },
      );

      return wmsOrder;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 3. 실패 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'order_create_failed_in_wms',
        externalOrderId: orderEvent.externalOrderId,
        externalClaimId: null,
        rawData: orderEvent,
        transformedData: null,
        status: 'failed',
        errorMessage: error.message,
        processedAt: new Date(),
      });

      this.logger.error(
        `❌ [${channel}→WMS] 주문 생성 오케스트레이션 실패: ${orderEvent.externalOrderId} (${duration}ms)`,
        {
          error: error.message,
          buyerName: orderEvent.buyer?.name,
          operationId,
        },
      );

      throw error;
    }
  }

  /**
   * 채널 주문 취소를 WMS에 전달하고 이벤트 로그 기록
   *
   * @param channel 채널 타입
   * @param orderEvent 주문 취소 이벤트
   * @param reason 취소 사유
   * @returns 취소된 WMS 주문 정보
   */
  async cancelOrderInWms(
    channel: ChannelType,
    orderEvent: InternalOrderEvent,
    reason?: string,
  ) {
    const startTime = Date.now();
    const operationId = `CANCEL_ORDER_WMS:${channel}:${orderEvent.externalOrderId}`;

    this.logger.log(
      `❌ [${channel}→WMS] 주문 취소 오케스트레이션 시작: ${orderEvent.externalOrderId}`,
      {
        reason: reason || orderEvent.reason,
        operationId,
      },
    );

    try {
      // 1. 채널별 전략을 통해 WMS에 주문 취소
      const strategy = this.factory.getStrategy(channel);
      const wmsOrder = await strategy.cancelOrderInWms(orderEvent, reason);

      const duration = Date.now() - startTime;

      // 2. 성공 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'order_cancelled_in_wms',
        externalOrderId: orderEvent.externalOrderId,
        externalClaimId: null,
        rawData: { ...orderEvent, cancelReason: reason },
        transformedData: wmsOrder,
        status: 'processed',
        processedAt: new Date(),
      });

      this.logger.log(
        `✅ [${channel}→WMS] 주문 취소 오케스트레이션 성공: ${wmsOrder.id} (${duration}ms)`,
        {
          channelOrderId: orderEvent.externalOrderId,
          wmsOrderId: wmsOrder.id,
          wmsStatus: wmsOrder.status,
          operationId,
        },
      );

      return wmsOrder;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 3. 실패 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'order_cancel_failed_in_wms',
        externalOrderId: orderEvent.externalOrderId,
        externalClaimId: null,
        rawData: { ...orderEvent, cancelReason: reason },
        transformedData: null,
        status: 'failed',
        errorMessage: error.message,
        processedAt: new Date(),
      });

      this.logger.error(
        `❌ [${channel}→WMS] 주문 취소 오케스트레이션 실패: ${orderEvent.externalOrderId} (${duration}ms)`,
        {
          error: error.message,
          reason: reason || orderEvent.reason,
          operationId,
        },
      );

      throw error;
    }
  }

  /**
   * 채널 교환 요청을 WMS에 전달하고 이벤트 로그 기록
   *
   * CTO 가이드라인: "교환은 주문 내에서 일어나는 동작입니다"
   *
   * @param channel 채널 타입
   * @param exchangeEvent 교환 요청 이벤트
   * @returns 교환 처리된 WMS 주문 정보
   */
  async processExchangeInWms(
    channel: ChannelType,
    exchangeEvent: InternalOrderEvent,
  ) {
    const startTime = Date.now();
    const operationId = `EXCHANGE_ORDER_WMS:${channel}:${exchangeEvent.externalOrderId}`;

    this.logger.log(
      `🔄 [${channel}→WMS] 교환 요청 오케스트레이션 시작: ${exchangeEvent.externalOrderId}`,
      {
        exchangeType: exchangeEvent.claimInfo?.claimType,
        reason: exchangeEvent.reason,
        operationId,
      },
    );

    try {
      // 1. 채널별 전략을 통해 WMS에 교환 처리
      const strategy = this.factory.getStrategy(channel);
      const wmsOrder = await strategy.processExchangeInWms(exchangeEvent);

      const duration = Date.now() - startTime;

      // 2. 성공 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'exchange_processed_in_wms',
        externalOrderId: exchangeEvent.externalOrderId,
        externalClaimId: exchangeEvent.claimInfo?.claimId,
        rawData: exchangeEvent,
        transformedData: wmsOrder,
        status: 'processed',
        processedAt: new Date(),
      });

      this.logger.log(
        `✅ [${channel}→WMS] 교환 요청 오케스트레이션 성공: ${wmsOrder.id} (${duration}ms)`,
        {
          channelOrderId: exchangeEvent.externalOrderId,
          wmsOrderId: wmsOrder.id,
          exchangeType: exchangeEvent.claimInfo?.claimType,
          operationId,
        },
      );

      return wmsOrder;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 3. 실패 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'exchange_failed_in_wms',
        externalOrderId: exchangeEvent.externalOrderId,
        externalClaimId: exchangeEvent.claimInfo?.claimId,
        rawData: exchangeEvent,
        transformedData: null,
        status: 'failed',
        errorMessage: error.message,
        processedAt: new Date(),
      });

      this.logger.error(
        `❌ [${channel}→WMS] 교환 요청 오케스트레이션 실패: ${exchangeEvent.externalOrderId} (${duration}ms)`,
        {
          error: error.message,
          exchangeType: exchangeEvent.claimInfo?.claimType,
          operationId,
        },
      );

      throw error;
    }
  }

  /**
   * 채널 주문 상태 업데이트를 WMS에 반영하고 이벤트 로그 기록
   *
   * @param channel 채널 타입
   * @param orderEvent 주문 상태 변경 이벤트
   * @returns 업데이트된 WMS 주문 정보
   */
  async updateOrderInWms(channel: ChannelType, orderEvent: InternalOrderEvent) {
    const startTime = Date.now();
    const operationId = `UPDATE_ORDER_WMS:${channel}:${orderEvent.externalOrderId}`;

    this.logger.log(
      `🔄 [${channel}→WMS] 주문 상태 업데이트 오케스트레이션 시작: ${orderEvent.externalOrderId}`,
      {
        status: orderEvent.status,
        operationId,
      },
    );

    try {
      // 1. 채널별 전략을 통해 WMS에 주문 상태 업데이트
      const strategy = this.factory.getStrategy(channel);
      const wmsOrder = await strategy.updateOrderInWms(orderEvent);

      const duration = Date.now() - startTime;

      // 2. 성공 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'order_updated_in_wms',
        externalOrderId: orderEvent.externalOrderId,
        externalClaimId: null,
        rawData: orderEvent,
        transformedData: wmsOrder,
        status: 'processed',
        processedAt: new Date(),
      });

      this.logger.log(
        `✅ [${channel}→WMS] 주문 상태 업데이트 오케스트레이션 성공: ${wmsOrder.id} (${duration}ms)`,
        {
          channelOrderId: orderEvent.externalOrderId,
          wmsOrderId: wmsOrder.id,
          newStatus: orderEvent.status,
          operationId,
        },
      );

      return wmsOrder;
    } catch (error) {
      const duration = Date.now() - startTime;

      // 3. 실패 이벤트 로그 기록
      await this.db.db.insert(schema.eventLogs).values({
        channelId: channel,
        eventType: 'order_update_failed_in_wms',
        externalOrderId: orderEvent.externalOrderId,
        externalClaimId: null,
        rawData: orderEvent,
        transformedData: null,
        status: 'failed',
        errorMessage: error.message,
        processedAt: new Date(),
      });

      this.logger.error(
        `❌ [${channel}→WMS] 주문 상태 업데이트 오케스트레이션 실패: ${orderEvent.externalOrderId} (${duration}ms)`,
        {
          error: error.message,
          status: orderEvent.status,
          operationId,
        },
      );

      throw error;
    }
  }
}
