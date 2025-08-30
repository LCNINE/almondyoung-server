import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseEvent, EventProcessingResult } from './base.event';
import { EventLoggerService } from './event.logger.service';

/**
 * 이벤트 처리 및 발행을 담당하는 중앙 서비스
 */
@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly eventLogger: EventLoggerService,
  ) {}

  /**
   * 이벤트 발행
   */
  async emit<T extends BaseEvent>(event: T): Promise<void> {
    try {
      // 이벤트 발행 로그
      this.eventLogger.logEventEmitted(event);

      // 이벤트 발행
      const eventName = this.getEventName(event);
      this.eventEmitter.emit(eventName, event);

      this.logger.debug(`Event emitted successfully: ${eventName}`);
    } catch (error) {
      this.logger.error(`Failed to emit event: ${error.message}`, {
        eventId: event.id,
        eventType: event.constructor.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * 여러 이벤트 일괄 발행
   */
  async emitMany<T extends BaseEvent>(events: T[]): Promise<void> {
    const promises = events.map((event) => this.emit(event));
    await Promise.all(promises);
  }

  /**
   * 이벤트 처리 래퍼 (재시도 로직 포함)
   */
  async processWithRetry<T extends BaseEvent>(
    event: T,
    handler: (event: T) => Promise<void>,
    options: {
      maxAttempts?: number;
      retryDelay?: number;
      exponentialBackoff?: boolean;
    } = {},
  ): Promise<EventProcessingResult> {
    const {
      maxAttempts = 3,
      retryDelay = 1000,
      exponentialBackoff = true,
    } = options;
    const startTime = Date.now();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await handler(event);

        const processingTime = Date.now() - startTime;
        const result: EventProcessingResult = {
          success: true,
          eventId: event.id,
          processingTime,
        };

        this.eventLogger.logEventProcessingCompleted(result);
        return result;
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxAttempts) {
          // 재시도 로그
          this.eventLogger.logEventRetry(
            event,
            attempt,
            maxAttempts,
            error.message,
          );

          // 재시도 지연
          const delay = exponentialBackoff
            ? retryDelay * Math.pow(2, attempt - 1)
            : retryDelay;

          await this.sleep(delay);
        }
      }
    }

    // 최종 실패
    const processingTime = Date.now() - startTime;
    const result: EventProcessingResult = {
      success: false,
      eventId: event.id,
      processingTime,
      error: lastError?.message || 'Unknown error',
    };

    this.eventLogger.logEventFinalFailure(
      event,
      lastError?.message || 'Unknown error',
    );
    return result;
  }

  /**
   * 이벤트 이름 생성 (클래스명 기반)
   */
  private getEventName(event: BaseEvent): string {
    // 클래스명을 kebab-case로 변환
    const className = event.constructor.name;
    return className
      .replace(/([A-Z])/g, (match, letter, index) =>
        index === 0 ? letter.toLowerCase() : `-${letter.toLowerCase()}`,
      )
      .replace(/event$/, ''); // 'Event' 접미사 제거
  }

  /**
   * 지연 유틸리티
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 이벤트 발행 통계
   */
  async getEventStats(): Promise<{
    totalEmitted: number;
    totalProcessed: number;
    averageProcessingTime: number;
  }> {
    // TODO: 실제 통계 수집 로직 구현
    return {
      totalEmitted: 0,
      totalProcessed: 0,
      averageProcessingTime: 0,
    };
  }
}
