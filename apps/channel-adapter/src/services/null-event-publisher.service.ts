import { Injectable, Logger } from '@nestjs/common';
import { EventPublisherService } from '@app/events';
import { ChannelAdapterEvents } from '@app/shared/events/adapter.events';
import { BaseEventPayload } from '@app/events';

/**
 * 아무 동작도 하지 않는 EventPublisher 구현체
 * 개발/테스트 환경에서 실제 이벤트 발행 없이 DI 패턴을 유지하기 위해 사용
 *
 * @example
 * ```typescript
 * // 테스트 환경에서 사용
 * providers: [
 *   {
 *     provide: EventPublisherService,
 *     useClass: NullEventPublisher,
 *   }
 * ]
 * ```
 */
@Injectable()
export class NullEventPublisher {
  private readonly logger = new Logger(NullEventPublisher.name);
  private serviceName: string = 'null-event-publisher';
  private readonly kafkaClient: any = null; // Kafka 클라이언트는 사용하지 않음

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
   * 서비스 이름 설정 (실제로는 사용되지 않음)
   * @param name 서비스 이름
   */
  setServiceName(name: string): void {
    this.logger.debug(`🔇 [NullEventPublisher] 서비스 이름 설정 스킵: ${name}`);
  }

  /**
   * 이벤트를 발행하지 않고 로깅만 수행
   * @param eventKey 이벤트 키
   * @param payload 이벤트 페이로드
   * @param options 발행 옵션 (사용되지 않음)
   */
  async publishEvent<K extends keyof ChannelAdapterEvents>(
    eventKey: K,
    payload: Omit<ChannelAdapterEvents[K]['payload'], keyof BaseEventPayload>,
    options?: {
      partition?: number;
      headers?: Record<string, string>;
    },
  ): Promise<void> {
    this.logger.debug(
      `🔇 [NullEventPublisher] 이벤트 발행 스킵: ${String(eventKey)}`,
      { payload, options },
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
      eventKey: K;
      payload: Omit<ChannelAdapterEvents[K]['payload'], keyof BaseEventPayload>;
      options?: {
        partition?: number;
        headers?: Record<string, string>;
      };
    }>,
  ): Promise<void> {
    this.logger.debug(
      `🔇 [NullEventPublisher] 배치 이벤트 발행 스킵: ${events.length}건`,
      events,
    );

    return Promise.resolve();
  }

  /**
   * Request-Response 패턴도 스킵
   * @param eventKey 이벤트 키
   * @param payload 페이로드
   * @param timeoutMs 타임아웃 (사용되지 않음)
   * @returns 빈 응답
   */
  async sendRequest<K extends keyof ChannelAdapterEvents, TResponse = any>(
    eventKey: K,
    payload: Omit<ChannelAdapterEvents[K]['payload'], keyof BaseEventPayload>,
    timeoutMs: number = 5000,
  ): Promise<TResponse> {
    this.logger.debug(
      `🔇 [NullEventPublisher] 요청-응답 패턴 스킵: ${String(eventKey)}`,
      { payload, timeoutMs },
    );

    // 빈 객체 반환
    return {} as TResponse;
  }
}
