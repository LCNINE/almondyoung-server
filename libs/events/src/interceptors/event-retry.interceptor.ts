/**
 * Event Retry Interceptor
 *
 * Kafka 이벤트 핸들러의 에러를 처리:
 * 1. @RetryPolicy 분류 (nonRetryable → 즉시 DLQ)
 * 2. retryable → backoff 재시도 (대기 중 heartbeat 유지)
 * 3. 최종 실패 → DLQ 전송 후 에러 삼킴 (offset commit)
 *
 * 구 EventsExceptionFilter 대체 — 예외 필터는 RPC 경로에서 host.getHandler()가
 * null 이라 메타데이터 조회·핸들러 재실행이 불가능했다(설계 스펙 §1 참조).
 * 전역(APP_INTERCEPTOR) 등록 전제 — rpc/Kafka 이벤트 외 컨텍스트는 첫 가드에서 통과.
 */

import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KafkaContext, KafkaHeaders } from '@nestjs/microservices';
import { defer, lastValueFrom, Observable } from 'rxjs';
import { DLQHandler } from '../dlq/dlq-handler.service';
import { MessageEnvelope, SchemaValidationError } from '@packages/event-contracts/types';
import {
  RETRY_POLICY_METADATA,
  DISABLE_DLQ_METADATA,
  RetryPolicyConfig,
  RetryContext,
} from '../retry/retry-policy.types';
import {
  normalizeRetryPolicy,
  isRetryableError,
  calculateBackoffDelay,
  sleep,
  createRetryContext,
  updateRetryContext,
} from '../retry/retry.util';

type NormalizedRetryPolicy = ReturnType<typeof normalizeRetryPolicy>;

/** backoff 대기 중 이 간격마다 heartbeat 호출 (max.poll.interval 초과·리밸런스 방지) */
const HEARTBEAT_INTERVAL_MS = 3000;

/**
 * DLQ 전송 실패 표식 — 중첩 등록된 바깥 EventRetryInterceptor 인스턴스가
 * 이를 핸들러 에러로 오분류해 재시도하지 않고 그대로 통과시키기 위한 마커.
 * (offset 미커밋 → Kafka 재전달이 의도된 의미론)
 */
export class DlqDeliveryError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DlqDeliveryError';
  }
}

@Injectable()
export class EventRetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EventRetryInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(DLQHandler)
    private readonly dlqHandler?: DLQHandler,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'rpc') {
      return next.handle();
    }

    const kafkaContext = context.switchToRpc().getContext<KafkaContext>();
    if (!(kafkaContext instanceof KafkaContext)) {
      return next.handle();
    }

    // request-response 메시지는 에러를 삼키면 요청자가 빈 응답을 받는다 — 개입하지 않음
    const headers = kafkaContext.getMessage().headers ?? {};
    if (headers[KafkaHeaders.CORRELATION_ID] && headers[KafkaHeaders.REPLY_TOPIC]) {
      return next.handle();
    }

    const handler = context.getHandler();
    const retryPolicy = normalizeRetryPolicy(
      this.reflector.get<RetryPolicyConfig | undefined>(RETRY_POLICY_METADATA, handler) ?? {},
    );
    const disableDLQ = this.reflector.get<boolean | undefined>(DISABLE_DLQ_METADATA, handler) ?? false;

    // 방어 복사 — @RetryPolicy 메타데이터가 소유한 배열을 in-place 변형하지 않는다
    const nonRetryable = [...(retryPolicy.nonRetryableErrors ?? [])];
    if (!nonRetryable.includes(SchemaValidationError)) {
      nonRetryable.push(SchemaValidationError);
    }
    retryPolicy.nonRetryableErrors = nonRetryable;

    return defer(() => this.executeWithRetry(next, handler.name, kafkaContext, retryPolicy, disableDLQ));
  }

  private async executeWithRetry(
    next: CallHandler,
    handlerName: string,
    kafkaContext: KafkaContext,
    retryPolicy: NormalizedRetryPolicy,
    disableDLQ: boolean,
  ): Promise<unknown> {
    let retryContext = createRetryContext();

    for (;;) {
      try {
        // next.handle()을 시도마다 새로 호출 — 핸들러 재실행
        return await lastValueFrom(next.handle(), { defaultValue: undefined });
      } catch (error) {
        if (error instanceof DlqDeliveryError) {
          throw error; // 안쪽 중첩 인스턴스의 DLQ 실패 — 재분류 없이 그대로 전파
        }

        const failure = error instanceof Error ? error : new Error(String(error));
        retryContext = updateRetryContext(retryContext, failure);
        const retriesSoFar = retryContext.attemptNumber - 1; // 초기 시도 제외한 재시도 횟수

        if (retryContext.attemptNumber === 1) {
          this.logger.error(`Event handler failed: ${handlerName}`, {
            error: failure.message,
            stack: failure.stack,
            errorType: failure.name,
            topic: kafkaContext.getTopic(),
            partition: kafkaContext.getPartition(),
            offset: kafkaContext.getMessage().offset,
          });
        }

        if (!isRetryableError(failure, retryPolicy) || retriesSoFar >= retryPolicy.maxRetries) {
          await this.handleFinalFailure(kafkaContext, failure, handlerName, retryContext, disableDLQ);
          return undefined; // 에러 삼킴 → 정상 완료 → offset commit
        }

        const nextRetryNumber = retriesSoFar + 1;
        const delay = calculateBackoffDelay(
          nextRetryNumber,
          retryPolicy.backoff,
          retryPolicy.initialDelayMs,
          retryPolicy.maxDelayMs,
        );
        this.logger.warn(`Retrying in ${delay}ms... (attempt ${nextRetryNumber}/${retryPolicy.maxRetries})`, {
          handler: handlerName,
          topic: kafkaContext.getTopic(),
        });
        await this.sleepWithHeartbeat(delay, kafkaContext);
      }
    }
  }

  private async handleFinalFailure(
    kafkaContext: KafkaContext,
    error: Error,
    handlerName: string,
    retryContext: RetryContext,
    disableDLQ: boolean,
  ): Promise<void> {
    const topic = kafkaContext.getTopic();
    const offset = kafkaContext.getMessage().offset;
    const retries = retryContext.attemptNumber - 1;

    if (disableDLQ) {
      this.logger.warn(`DLQ disabled for handler: ${handlerName}. Discarding message.`, { topic, offset });
      return;
    }
    if (!this.dlqHandler) {
      this.logger.error(`DLQHandler not available. Cannot send message to DLQ.`, { handler: handlerName, topic });
      return;
    }

    await this.sendToDLQ(kafkaContext, error, handlerName, retryContext, this.dlqHandler);

    this.logger.error(`❌ Handler failed after ${retries} retries: ${handlerName}`, {
      error: error.message,
      topic,
      partition: kafkaContext.getPartition(),
      offset,
    });
  }

  private async sendToDLQ(
    kafkaContext: KafkaContext,
    error: Error,
    consumerName: string,
    retryContext: RetryContext,
    dlqHandler: DLQHandler,
  ): Promise<void> {
    const message = kafkaContext.getMessage();
    const topic = kafkaContext.getTopic();

    try {
      const value = message.value;
      const jsonString: string = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value ?? '{}');
      // as 정당화: JSON.parse 는 unknown 을 반환하며 런타임 스키마 검증은 SchemaValidationInterceptor 소관.
      // DLQ 전송은 실패 메시지 보존이 목적이라 envelope 형태를 신뢰하고 전달한다 (schema-validation.interceptor.ts:70 과 동일 관례).
      const envelope = JSON.parse(jsonString) as MessageEnvelope;

      await dlqHandler.sendToDLQ({
        originalTopic: topic,
        originalMessage: envelope,
        error,
        context: {
          partition: kafkaContext.getPartition(),
          offset: String(message.offset),
          consumer: consumerName,
          retryCount: retryContext.attemptHistory.length,
          attemptHistory: retryContext.attemptHistory,
        },
      });

      this.logger.log(`📤 Message sent to DLQ after ${retryContext.attemptHistory.length} failed attempts`, {
        topic,
        messageType: envelope.messageType,
        aggregateId: envelope.source?.aggregateId,
      });
    } catch (dlqError) {
      this.logger.error(`❌ CRITICAL: Failed to send message to DLQ`, {
        originalError: error.message,
        dlqError: dlqError instanceof Error ? dlqError.message : String(dlqError),
        topic,
        offset: message.offset,
      });
      // DLQ 전송 실패는 치명적 — 에러를 던져 offset 미커밋 → Kafka 재전달
      throw new DlqDeliveryError(dlqError instanceof Error ? dlqError.message : String(dlqError), dlqError);
    }
  }

  private async sleepWithHeartbeat(delayMs: number, kafkaContext: KafkaContext): Promise<void> {
    const heartbeat = kafkaContext.getHeartbeat();
    let remaining = delayMs;
    while (remaining > 0) {
      try {
        await heartbeat();
      } catch (heartbeatError) {
        this.logger.warn(
          `Heartbeat failed during retry backoff: ${
            heartbeatError instanceof Error ? heartbeatError.message : String(heartbeatError)
          }`,
        );
      }
      const chunk = Math.min(remaining, HEARTBEAT_INTERVAL_MS);
      await sleep(chunk);
      remaining -= chunk;
    }
  }
}
