/**
 * Events Exception Filter
 *
 * 이벤트 핸들러의 에러를 자동으로 처리:
 * 1. 재시도 로직 실행
 * 2. 재시도 실패 시 DLQ로 전송
 * 3. Kafka offset commit
 */

import {
  Catch,
  ArgumentsHost,
  Logger,
  Injectable,
  Inject,
  Optional,
} from '@nestjs/common';
import { BaseRpcExceptionFilter } from '@nestjs/microservices';
import { KafkaContext } from '@nestjs/microservices';
import { Reflector } from '@nestjs/core';
import { DLQHandler } from '../dlq/dlq-handler.service';
import { MessageEnvelope } from '@packages/event-contracts/types';
import {
  RETRY_POLICY_METADATA,
  DISABLE_DLQ_METADATA,
  RetryPolicyConfig,
} from '../retry/retry-policy.types';
import {
  normalizeRetryPolicy,
  isRetryableError,
  calculateBackoffDelay,
  sleep,
  createRetryContext,
  updateRetryContext,
} from '../retry/retry.util';
import { SchemaValidationError } from '@packages/event-contracts/types';

@Catch()
@Injectable()
export class EventsExceptionFilter extends BaseRpcExceptionFilter {
  private readonly logger = new Logger(EventsExceptionFilter.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(DLQHandler)
    private readonly dlqHandler?: DLQHandler,
  ) {
    super();
  }

  catch(exception: Error, host: ArgumentsHost): any {
    return this.handleException(exception, host);
  }

  private async handleException(exception: Error, host: ArgumentsHost): Promise<void> {
    const ctx = host.switchToRpc();
    const kafkaContext = ctx.getContext<KafkaContext>();
    const handler = (host as any).getHandler ? (host as any).getHandler() : { name: 'UnknownHandler' };

    // 핸들러의 재시도 정책 조회
    const retryPolicyConfig =
      this.reflector.get<RetryPolicyConfig>(RETRY_POLICY_METADATA, handler) || {};
    const disableDLQ = this.reflector.get<boolean>(DISABLE_DLQ_METADATA, handler) || false;

    const retryPolicy = normalizeRetryPolicy(retryPolicyConfig);

    // SchemaValidationError는 재시도하지 않음 (nonRetryableErrors에 추가)
    if (!retryPolicy.nonRetryableErrors) {
      retryPolicy.nonRetryableErrors = [];
    }
    if (!retryPolicy.nonRetryableErrors.includes(SchemaValidationError)) {
      retryPolicy.nonRetryableErrors.push(SchemaValidationError);
    }

    // 재시도 컨텍스트 생성
    const retryContext = createRetryContext();

    this.logger.error(
      `Event handler failed: ${handler.name}`,
      {
        error: exception.message,
        stack: exception.stack,
        errorType: exception.name,
        topic: kafkaContext.getTopic(),
        partition: kafkaContext.getPartition(),
        offset: kafkaContext.getMessage().offset,
      },
    );

    // 재시도 로직
    let lastError = exception;
    let shouldRetry = isRetryableError(exception, retryPolicy);

    while (
      shouldRetry &&
      retryContext.attemptNumber < retryPolicy.maxRetries
    ) {
      // 백오프 대기
      const delay = calculateBackoffDelay(
        retryContext.attemptNumber + 1,
        retryPolicy.backoff,
        retryPolicy.initialDelayMs,
        retryPolicy.maxDelayMs,
      );

      this.logger.warn(
        `Retrying in ${delay}ms... (attempt ${retryContext.attemptNumber + 1}/${retryPolicy.maxRetries})`,
        {
          handler: handler.name,
          topic: kafkaContext.getTopic(),
        },
      );

      await sleep(delay);

      // 재시도 실행
      try {
        const result = await this.retryHandler(host);

        // 성공!
        this.logger.log(
          `✅ Retry succeeded on attempt ${retryContext.attemptNumber + 1}`,
          {
            handler: handler.name,
            topic: kafkaContext.getTopic(),
          },
        );

        return result;
      } catch (retryError) {
        lastError = retryError as Error;
        updateRetryContext(retryContext, lastError);

        // 재시도 가능한 에러인지 다시 확인
        shouldRetry = isRetryableError(lastError, retryPolicy);

        if (!shouldRetry) {
          this.logger.warn(
            `Non-retryable error encountered: ${lastError.name}`,
            {
              handler: handler.name,
              topic: kafkaContext.getTopic(),
            },
          );
          break;
        }
      }
    }

    // 모든 재시도 실패 → DLQ 처리
    if (!disableDLQ && this.dlqHandler) {
      await this.sendToDLQ(
        kafkaContext,
        lastError,
        handler.name,
        retryContext.attemptHistory,
      );
    } else if (disableDLQ) {
      this.logger.warn(
        `DLQ disabled for handler: ${handler.name}. Discarding message.`,
        {
          topic: kafkaContext.getTopic(),
          offset: kafkaContext.getMessage().offset,
        },
      );
    } else {
      this.logger.error(
        `DLQHandler not available. Cannot send message to DLQ.`,
        {
          handler: handler.name,
          topic: kafkaContext.getTopic(),
        },
      );
    }

    // 에러를 다시 던지면 Kafka offset commit이 안됨
    // 따라서 여기서 에러를 삼켜야 함 (DLQ로 보냈으므로)
    // 하지만 로그는 남김
    this.logger.error(
      `❌ Handler failed after ${retryContext.attemptNumber} retries: ${handler.name}`,
      {
        error: lastError.message,
        topic: kafkaContext.getTopic(),
        partition: kafkaContext.getPartition(),
        offset: kafkaContext.getMessage().offset,
      },
    );

    // Kafka에게 메시지 처리 완료 알림 (offset commit)
    // 에러를 던지지 않으면 NestJS가 자동으로 commit함
    return;
  }

  /**
   * 핸들러 재실행
   */
  private async retryHandler(host: ArgumentsHost): Promise<any> {
    const handler = (host as any).getHandler ? (host as any).getHandler() : null;
    const args = host.getArgs();

    if (handler && typeof handler === 'function') {
      return handler(...args);
    }

    throw new Error('Cannot retry handler: handler not found');
  }

  /**
   * DLQ로 메시지 전송
   */
  private async sendToDLQ(
    kafkaContext: KafkaContext,
    error: Error,
    consumerName: string,
    attemptHistory: Array<{ attemptedAt: string; error: string }>,
  ): Promise<void> {
    if (!this.dlqHandler) {
      this.logger.error('DLQHandler is not available');
      return;
    }

    const message = kafkaContext.getMessage();
    const topic = kafkaContext.getTopic();
    const partition = kafkaContext.getPartition();

    try {
      // 원본 메시지 파싱
      const value = message.value;
      const jsonString: string = Buffer.isBuffer(value)
        ? value.toString('utf-8')
        : String(value || '{}');
      const envelope = JSON.parse(jsonString) as MessageEnvelope;

      await this.dlqHandler.sendToDLQ({
        originalTopic: topic,
        originalMessage: envelope,
        error,
        context: {
          partition,
          offset: String(message.offset),
          consumer: consumerName,
          retryCount: attemptHistory.length,
          attemptHistory,
        },
      });

      this.logger.log(
        `📤 Message sent to DLQ after ${attemptHistory.length} failed attempts`,
        {
          topic,
          messageType: envelope.messageType,
          aggregateId: envelope.source.aggregateId,
        },
      );
    } catch (dlqError) {
      this.logger.error(
        `❌ CRITICAL: Failed to send message to DLQ`,
        {
          originalError: error.message,
          dlqError: dlqError instanceof Error ? dlqError.message : String(dlqError),
          topic,
          offset: message.offset,
        },
      );

      // DLQ 전송 실패는 치명적이므로 에러를 던짐
      // 이 경우 Kafka가 메시지를 다시 전달할 것임
      throw dlqError;
    }
  }
}

