import { Injectable, Logger } from '@nestjs/common';
import { BaseEvent, EventProcessingResult } from './base.event';

/**
 * 이벤트 로깅 및 모니터링 서비스
 * 모든 이벤트 처리를 추적하고 로그를 남깁니다.
 */
@Injectable()
export class EventLoggerService {
  private readonly logger = new Logger(EventLoggerService.name);

  /**
   * 이벤트 발행 로그
   */
  logEventEmitted(event: BaseEvent): void {
    this.logger.log(`Event emitted: ${event.constructor.name}`, {
      eventId: event.id,
      eventType: event.constructor.name,
      timestamp: event.timestamp,
      correlationId: event.correlationId,
      actor: event.actor,
      version: event.version,
    });
  }

  /**
   * 이벤트 처리 시작 로그
   */
  logEventProcessingStarted(event: BaseEvent, handlerName: string): void {
    this.logger.log(
      `Event processing started: ${event.constructor.name} by ${handlerName}`,
      {
        eventId: event.id,
        eventType: event.constructor.name,
        handlerName,
        correlationId: event.correlationId,
      },
    );
  }

  /**
   * 이벤트 처리 완료 로그
   */
  logEventProcessingCompleted(result: EventProcessingResult): void {
    if (result.success) {
      this.logger.log(`Event processing completed successfully`, {
        eventId: result.eventId,
        processingTime: result.processingTime,
      });
    } else {
      this.logger.error(`Event processing failed: ${result.error}`, {
        eventId: result.eventId,
        processingTime: result.processingTime,
        error: result.error,
      });
    }
  }

  /**
   * 이벤트 처리 재시도 로그
   */
  logEventRetry(
    event: BaseEvent,
    attempt: number,
    maxAttempts: number,
    error: string,
  ): void {
    this.logger.warn(`Event processing retry ${attempt}/${maxAttempts}`, {
      eventId: event.id,
      eventType: event.constructor.name,
      attempt,
      maxAttempts,
      error,
      correlationId: event.correlationId,
    });
  }

  /**
   * 이벤트 처리 최종 실패 로그
   */
  logEventFinalFailure(event: BaseEvent, error: string): void {
    this.logger.error(`Event processing failed permanently`, {
      eventId: event.id,
      eventType: event.constructor.name,
      error,
      correlationId: event.correlationId,
    });
  }

  /**
   * 이벤트 핸들러 등록 로그
   */
  logEventHandlerRegistered(eventType: string, handlerName: string): void {
    this.logger.log(
      `Event handler registered: ${handlerName} for ${eventType}`,
    );
  }

  /**
   * 성능 메트릭 로그
   */
  logPerformanceMetrics(metrics: {
    eventType: string;
    averageProcessingTime: number;
    totalEvents: number;
    successRate: number;
  }): void {
    this.logger.log(`Event performance metrics`, {
      eventType: metrics.eventType,
      averageProcessingTime: metrics.averageProcessingTime,
      totalEvents: metrics.totalEvents,
      successRate: metrics.successRate,
    });
  }
}
