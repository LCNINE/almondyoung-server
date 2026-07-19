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
import { Kafka } from 'kafkajs';
import { firstValueFrom } from 'rxjs';
import { MessageEnvelope, KafkaConfig } from '@packages/event-contracts/types';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { generateMessageId } from '../utils/message-id.util';
import { DLQMessage, BatchReprocessResult } from './dlq.types';
import { dlqMessagesTotal, dlqSendFailuresTotal } from './dlq.metrics';

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
      throw new Error(`Message is already being reprocessed: ${dlqMessage.dlqMessageId}`);
    }

    if (dlqMessage.status === 'resolved') {
      throw new Error(`Message was already resolved: ${dlqMessage.dlqMessageId}`);
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

      this.logger.log(`✅ DLQ message reprocessed: ${dlqMessage.dlqMessageId}`, {
        originalTopic: dlqMessage.originalTopic,
        messageType: dlqMessage.originalMessage.messageType,
        aggregateId: dlqMessage.originalMessage.source.aggregateId,
      });

      // TODO: DB 상태 업데이트
      // await this.markAsReprocessed(dlqMessage.dlqMessageId);
    } catch (error) {
      this.logger.error(`❌ Failed to reprocess DLQ message: ${dlqMessage.dlqMessageId}`, {
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    }
  }

  /**
   * DLQ 토픽을 드레인하며 각 메시지를 원본 토픽으로 재발행한다(관리자 수동 트리거용).
   *
   * 안정 컨슈머 그룹(`${dlqTopic}.reprocessor`) + autoCommit 이라, 재실행하면 이미 드레인한 오프셋은
   * 건너뛰고 새로 쌓인 DLQ 메시지만 처리한다(무한 재처리 방지). 재발행 후에도 실패하면 새 DLQ 메시지로
   * 다시 쌓이고 다음 드레인에서 잡힌다 — 소비 핸들러가 멱등이라 재전달은 안전하다.
   *
   * idleMs 동안 새 메시지가 없거나 maxMessages 에 도달하면 종료한다.
   */
  async drainAndReprocess(params: {
    dlqTopic: string;
    kafka: KafkaConfig;
    maxMessages?: number;
    idleMs?: number;
  }): Promise<BatchReprocessResult & { scanned: number }> {
    const maxMessages = params.maxMessages ?? 500;
    const idleMs = params.idleMs ?? 3000;
    const result: BatchReprocessResult & { scanned: number } = {
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      scanned: 0,
    };

    const client = new Kafka({
      clientId: `${params.kafka.clientId}-dlq-reprocess`,
      brokers: params.kafka.brokers,
      ssl: params.kafka.ssl,
      // KafkaConfig.sasl 은 createKafkaConfigFromEnv 가 채우는 plain/oauthbearer 뿐 — kafkajs 와 호환.
      sasl: params.kafka.sasl as any,
      retry: params.kafka.retry,
    });
    const consumer = client.consumer({ groupId: `${params.dlqTopic}.reprocessor` });

    await consumer.connect();
    try {
      await consumer.subscribe({ topic: params.dlqTopic, fromBeginning: true });

      await new Promise<void>((resolve, reject) => {
        let idleTimer: ReturnType<typeof setTimeout>;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(idleTimer);
          resolve();
        };
        const armIdle = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(finish, idleMs);
        };
        armIdle();

        consumer
          .run({
            autoCommit: true,
            eachMessage: async ({ message }) => {
              if (done) return;
              armIdle();
              result.scanned++;
              result.total++;
              let dlqMessageId = '(unparsed)';
              try {
                const dlqMessage = JSON.parse(message.value?.toString() ?? '{}') as DLQMessage;
                dlqMessageId = dlqMessage.dlqMessageId ?? dlqMessageId;
                await this.reprocessDLQ({ dlqTopic: params.dlqTopic, dlqMessage });
                result.succeeded++;
              } catch (error) {
                result.failed++;
                result.errors.push({
                  dlqMessageId,
                  error: error instanceof Error ? error.message : String(error),
                });
              }
              if (result.scanned >= maxMessages) finish();
            },
          })
          .catch(reject);
      });
    } finally {
      await consumer.disconnect();
    }

    this.logger.log(
      `♻️  DLQ 드레인 완료: topic=${params.dlqTopic}, scanned=${result.scanned}, ` +
        `reprocessed=${result.succeeded}, failed=${result.failed}`,
    );
    return result;
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
  async resolveDLQ(params: { dlqMessageId: string; reason: string }): Promise<void> {
    this.logger.log(`DLQ message resolved: ${params.dlqMessageId}`, {
      reason: params.reason,
    });

    // TODO: DB 업데이트
    // await this.markAsResolved(params.dlqMessageId, params.reason);
  }
}
