import { Injectable, Logger } from '@nestjs/common';
import {
  ChannelStrategyFactory,
  ChannelType,
} from './strategies/channel-strategy.factory';
import { SyncStatusService } from './sync-status.service';
import { DataType, SyncResult } from '../types';
import { InternalOrderEvent } from '../types';
import { ChannelCommand } from '../types';

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
  ) {}

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
      this.logger.log(
        `✅ [${channel}] ${events.length}건의 ${dataType} 이벤트 동기화 완료 (${duration}ms)`,
      );

      await this.syncStatusService.recordSyncComplete(channel, dataType, {
        eventCount: events.length,
        processingTime: duration,
        sessionId,
      });

      // TODO: 중복검사(Redis) 구현 예정
      // TODO: 이벤트 브로커(Kafka) 발행 구현 예정

      return events;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `❌ [${channel}] ${dataType} 동기화 실패 (${duration}ms):`,
        error.message,
      );

      await this.syncStatusService.recordSyncFailure(channel, dataType, {
        message: error.message,
        processingTime: duration,
        sessionId,
      });

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
    this.logger.log(`⚡ [${channel}] 명령 실행: ${command.type}`, {
      orderId: 'orderId' in command ? command.orderId : undefined,
      claimId: 'claimId' in command ? command.claimId : undefined,
    });

    try {
      // 1. 채널별 전략 가져오기
      const strategy = this.factory.getStrategy(channel);

      // 2. 명령 실행
      const result = await strategy.executeCommand(command);

      if (result.success) {
        this.logger.log(`✅ [${channel}] 명령 실행 성공: ${command.type}`);
      } else {
        this.logger.warn(`⚠️ [${channel}] 명령 실행 실패: ${command.type}`, {
          errors: result.errors,
        });
      }

      return result;
    } catch (error) {
      this.logger.error(
        `❌ [${channel}] 명령 실행 오류: ${command.type}`,
        error.message,
      );
      throw new Error(`${channel} 명령 실행 실패: ${error.message}`);
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
    const channels: ChannelType[] = ['naver_smartstore', 'coupang'];
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
    const channels: ChannelType[] = ['naver_smartstore', 'coupang'];
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
}
