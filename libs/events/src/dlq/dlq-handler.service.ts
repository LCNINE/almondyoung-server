/**
 * DLQ Handler Service
 *
 * Dead Letter Queue 처리 서비스
 * - 실패한 메시지를 DLQ로 전송
 * - 재처리는 원래 토픽 재발행이라 모든 구독자에게 중복을 낸다 — 지웠다(#1016 8번). 켠 앱은 `EventFailuresModule` 의 다시 넣기를 쓴다
 * - DLQ 통계 조회
 */

import { Injectable, Logger, Inject } from '@nestjs/common';
import { MessageEnvelope } from '@packages/event-contracts/types';
import { EVENT_TRANSPORT, EventTransport } from '../transport/transport.port';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { generateMessageId } from '../utils/message-id.util';
import { DLQMessage } from './dlq.types';
import { dlqMessagesTotal, dlqSendFailuresTotal } from './dlq.metrics';

@Injectable()
export class DLQHandler {
  private readonly logger = new Logger(DLQHandler.name);

  constructor(
    @Inject(EVENT_TRANSPORT)
    private readonly transport: EventTransport,
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

    // source 가 없는 envelope 도 DLQ 에 도달해야 한다. 여기서 던지면 kafkajs 가 컨슈머를 크래시시키고
    // 커밋된 오프셋 때문에 재시작해도 같은 메시지가 와 앱 전체가 무한 루프에 빠진다 (#1073).
    const aggregateId = params.originalMessage.source?.aggregateId ?? 'unknown';
    const partitionKey =
      params.originalMessage.source?.aggregateId ?? params.originalMessage.messageId ?? params.originalTopic;

    try {
      // DLQ 토픽으로 발행
      await this.transport.send(dlqTopic, {
        key: partitionKey,
        value: JSON.stringify(dlqMessage),
        headers: {
          'dlq-message-id': dlqMessageId,
          'original-topic': params.originalTopic,
          'original-message-type': params.originalMessage.messageType,
          'original-message-id': params.originalMessage.messageId,
          'original-aggregate-id': aggregateId,
          'failure-reason': params.error.name,
          'retry-count': String(params.context.retryCount),
          'failed-at': dlqMessage.failedAt,
        },
      });

      this.logger.warn({
        msg: `📤 Message sent to DLQ: ${params.originalMessage.messageType}`,
        dlqTopic,
        dlqMessageId,
        originalMessageId: params.originalMessage.messageId,
        aggregateId,
        errorMessage: params.error.message,
        retryCount: params.context.retryCount,
      });

      dlqMessagesTotal.inc({
        topic: params.originalTopic,
        consumer: params.context.consumer,
        error: params.error.name,
      });

      // TODO: 필요 시 DB에도 저장
      // await this.saveDLQToDatabase(dlqMessage);
    } catch (error) {
      dlqSendFailuresTotal.inc({
        topic: params.originalTopic,
        consumer: params.context.consumer,
      });

      this.logger.error({
        msg: `❌ CRITICAL: Failed to send message to DLQ`,
        originalTopic: params.originalTopic,
        dlqTopic,
        error: error instanceof Error ? error.message : String(error),
        originalError: params.error.message,
      });

      // DLQ 전송 실패는 치명적이므로 다시 던짐
      throw error;
    }
  }
}
