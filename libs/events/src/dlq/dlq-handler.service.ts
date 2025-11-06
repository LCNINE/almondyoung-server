/**
 * DLQ Handler Service
 *
 * Dead Letter Queue 처리 서비스
 * - 실패한 메시지를 DLQ로 전송
 * - DLQ 메시지 재처리
 * - DLQ 통계 조회
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { ClientKafka } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { generateMessageId } from '../utils/message-id.util';
import { DLQMessage } from './dlq.types';

@Injectable()
export class DLQHandler {
  private readonly logger = new Logger(DLQHandler.name);

  constructor(
    @Inject('KAFKA_CLIENT')
    private readonly kafkaClient: ClientKafka,
  ) {}

  /**
   * 실패한 메시지를 DLQ로 전송
   *
   * @example
   * await dlqHandler.sendToDLQ({
   *   originalTopic: 'orders.events.v1',
   *   originalMessage: envelope,
   *   error: new Error('Processing failed'),
   *   context: {
   *     partition: 0,
   *     offset: '12345',
   *     consumer: 'OrderEventsConsumer',
   *     retryCount: 3,
   *   },
   * });
   */
  async sendToDLQ<TPayload = unknown>(params: {
    originalTopic: string;
    originalMessage: MessageEnvelope<TPayload>;
    error: Error;
    context: {
      partition: number;
      offset: string;
      consumer: string;
      retryCount: number;
      attemptHistory?: Array<{
        attemptedAt: string;
        error: string;
      }>;
    };
  }): Promise<void> {
    const dlqTopic = getDLQTopicName(params.originalTopic);
    const dlqMessageId = generateMessageId();

    const dlqMessage: DLQMessage<TPayload> = {
      dlqMessageId,
      dlqTopic,

      originalTopic: params.originalTopic,
      originalPartition: params.context.partition,
      originalOffset: params.context.offset,
      originalMessage: params.originalMessage,

      error: {
        name: params.error.name,
        message: params.error.message,
        stack: params.error.stack,
        code: (params.error as any).code,
      },

      context: {
        consumer: params.context.consumer,
        retryCount: params.context.retryCount,
        attemptHistory: params.context.attemptHistory || [],
      },

      failedAt: new Date().toISOString(),

      status: 'pending',
      reprocessAttempts: 0,
    };

    try {
      // DLQ 토픽으로 발행
      await firstValueFrom(
        this.kafkaClient.emit(dlqTopic, {
          key: params.originalMessage.source.aggregateId,
          value: JSON.stringify(dlqMessage),
          headers: {
            'dlq-message-id': dlqMessageId,
            'original-topic': params.originalTopic,
            'original-message-type': params.originalMessage.messageType,
            'original-message-id': params.originalMessage.messageId,
            'original-aggregate-id': params.originalMessage.source.aggregateId,
            'failure-reason': params.error.name,
            'retry-count': String(params.context.retryCount),
            'failed-at': dlqMessage.failedAt,
          },
        }),
      );

      this.logger.warn(`📤 Message sent to DLQ: ${params.originalMessage.messageType}`, {
        dlqTopic,
        dlqMessageId,
        originalMessageId: params.originalMessage.messageId,
        aggregateId: params.originalMessage.source.aggregateId,
        errorMessage: params.error.message,
        retryCount: params.context.retryCount,
      });

      // TODO: 필요 시 DB에도 저장
      // await this.saveDLQToDatabase(dlqMessage);

      // TODO: 중요한 에러는 알림 발송
      // if (this.shouldAlert(params.originalTopic, params.error)) {
      //   await this.sendAlert(dlqMessage);
      // }
    } catch (error) {
      this.logger.error(`❌ CRITICAL: Failed to send message to DLQ`, {
        originalTopic: params.originalTopic,
        dlqTopic,
        error: error instanceof Error ? error.message : String(error),
        originalError: params.error.message,
      });

      // DLQ 전송 실패는 치명적이므로 다시 던짐
      throw error;
    }
  }

  /**
   * DLQ 메시지 재처리
   *
   * DLQ에서 메시지를 가져와 원본 토픽으로 재발행
   *
   * @example
   * await dlqHandler.reprocessDLQ({
   *   dlqTopic: 'orders.events.v1.dlq',
   *   dlqMessage: message,
   * });
   */
  async reprocessDLQ(params: {
    dlqTopic: string;
    dlqMessage: DLQMessage;
    options?: {
      targetPartition?: number;
    };
  }): Promise<void> {
    const { dlqMessage } = params;

    // 상태 확인
    if (dlqMessage.status === 'reprocessing') {
      throw new Error(
        `Message is already being reprocessed: ${dlqMessage.dlqMessageId}`,
      );
    }

    if (dlqMessage.status === 'resolved') {
      throw new Error(
        `Message was already resolved: ${dlqMessage.dlqMessageId}`,
      );
    }

    try {
      // 원본 토픽으로 재발행
      await firstValueFrom(
        this.kafkaClient.emit(dlqMessage.originalTopic, {
          key: dlqMessage.originalMessage.source.aggregateId,
          value: JSON.stringify(dlqMessage.originalMessage),
          partition: params.options?.targetPartition,
          headers: {
            'reprocess-attempt': 'true',
            'original-dlq-id': dlqMessage.dlqMessageId,
            'reprocess-count': String(dlqMessage.reprocessAttempts + 1),
            'reprocessed-at': new Date().toISOString(),
          },
        }),
      );

      this.logger.log(
        `✅ DLQ message reprocessed: ${dlqMessage.dlqMessageId}`,
        {
          originalTopic: dlqMessage.originalTopic,
          messageType: dlqMessage.originalMessage.messageType,
          aggregateId: dlqMessage.originalMessage.source.aggregateId,
        },
      );

      // TODO: DB 상태 업데이트
      // await this.markAsReprocessed(dlqMessage.dlqMessageId);
    } catch (error) {
      this.logger.error(
        `❌ Failed to reprocess DLQ message: ${dlqMessage.dlqMessageId}`,
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );

      throw error;
    }
  }

  /**
   * DLQ 메시지 해결 처리 (더 이상 재시도하지 않음)
   *
   * @example
   * await dlqHandler.resolveDLQ({
   *   dlqMessageId: 'msg-123',
   *   reason: 'Fixed manually in database',
   * });
   */
  async resolveDLQ(params: {
    dlqMessageId: string;
    reason: string;
  }): Promise<void> {
    this.logger.log(`DLQ message resolved: ${params.dlqMessageId}`, {
      reason: params.reason,
    });

    // TODO: DB 업데이트
    // await this.markAsResolved(params.dlqMessageId, params.reason);
  }

  /**
   * 알림이 필요한지 판단
   */
  private shouldAlert(topic: string, error: Error): boolean {
    // 중요한 도메인은 즉시 알림
    const criticalTopics = ['orders.events.v1', 'payments.events.v1'];

    if (criticalTopics.some((t) => topic.includes(t))) {
      return true;
    }

    // 특정 에러는 즉시 알림
    const criticalErrors = ['DatabaseError', 'TimeoutError', 'FatalError'];
    if (criticalErrors.includes(error.name)) {
      return true;
    }

    return false;
  }
}
