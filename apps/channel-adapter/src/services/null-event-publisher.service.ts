import { Injectable, Logger } from '@nestjs/common';
import { ChannelAdapterEvents } from '@app/shared/streams';

/**
 * 아무 동작도 하지 않는 StreamPublisher 구현체
 * 개발/테스트 환경에서 실제 이벤트 발행 없이 DI 패턴을 유지하기 위해 사용
 *
 * @example
 * ```typescript
 * // 테스트 환경에서 사용
 * providers: [
 *   {
 *     provide: StreamPublisher,
 *     useClass: NullEventPublisher,
 *   }
 * ]
 * ```
 */
@Injectable()
export class NullEventPublisher {
  private readonly logger = new Logger(NullEventPublisher.name);

  constructor() {
    this.logger.log('🔇 NullEventPublisher 초기화 완료 (이벤트 발행 비활성화)');
  }

  /**
   * 모듈 초기화 (아무것도 하지 않음)
   */
  async onModuleInit(): Promise<void> {
    this.logger.debug('🔇 [NullEventPublisher] 모듈 초기화 스킵');
  }

  /**
   * 모듈 종료 (아무것도 하지 않음)
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.debug('🔇 [NullEventPublisher] 모듈 종료 스킵');
  }

  /**
   * 이벤트를 발행하지 않고 로깅만 수행 (새로운 StreamPublisher API)
   * @param params 이벤트 파라미터
   */
  async publishEvent<K extends keyof ChannelAdapterEvents>(params: {
    eventType: K;
    aggregateId: string;
    payload: ChannelAdapterEvents[K]['payloadType'];
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    this.logger.debug(
      `🔇 [NullEventPublisher] 이벤트 발행 스킵: ${String(params.eventType)}`,
      { aggregateId: params.aggregateId, payload: params.payload },
    );

    // 아무 동작도 하지 않음 (Null Object Pattern)
    return Promise.resolve();
  }

  /**
   * 배치 이벤트 발행도 스킵
   * @param events 이벤트 배열
   */
  async publishEvents<K extends keyof ChannelAdapterEvents>(
    events: Array<{
      eventType: K;
      aggregateId: string;
      payload: ChannelAdapterEvents[K]['payloadType'];
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<void> {
    this.logger.debug(
      `🔇 [NullEventPublisher] 배치 이벤트 발행 스킵: ${events.length}건`,
      events,
    );

    return Promise.resolve();
  }
}
