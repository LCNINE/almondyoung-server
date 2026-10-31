/**
 * Event Retry Interceptor
 *
 * Kafka 이벤트 핸들러의 에러를 처리:
 * 1. @RetryPolicy 분류 (nonRetryable → 즉시 DLQ)
 * 2. retryable → backoff 재시도 (대기 중 heartbeat 유지)
 * 3. 최종 실패 → DLQ 전송 후 에러 삼킴 (offset commit)
 *    커밋은 `buildKafkaConsumerServerOptions` 의 `autoCommit: true` 가 한다 — #1073 전까지는 꺼져 있어
 *    이 문장이 거짓이었다(리밸런스마다 최신으로 점프).
 *
 * 구 EventsExceptionFilter 대체 — 예외 필터는 RPC 경로에서 host.getHandler()가
 * null 이라 메타데이터 조회·핸들러 재실행이 불가능했다(설계 스펙 §1 참조).
 * 전역(APP_INTERCEPTOR) 등록 전제 — rpc/Kafka 이벤트 외 컨텍스트는 첫 가드에서 통과.
 */

import { CallHandler, ExecutionContext, Inject, Injectable, Logger, NestInterceptor, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KafkaContext, KafkaHeaders } from '@nestjs/microservices';
import { defer, lastValueFrom, Observable, of } from 'rxjs';
import { DLQHandler } from '../dlq/dlq-handler.service';
import { dlqMessagesTotal } from '../dlq/dlq.metrics';
import { EVENT_TYPE_FILTER } from '../consumers/decorators';
import { DEAD_LETTER_HEADERS, type DeadLetterMessage, type DeadLetterRecorder } from '../dead-letter/dead-letter.types';
import { SchemaValidationError, type MessageEnvelope } from '@packages/event-contracts/types';
import { parseEnvelope } from '../utils/envelope.util';
import { TenantGateRejection } from '../tenancy/event-tenant-gate';
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

/** 앱이 실패 테이블을 켰을 때 인터셉터가 받는 것 (#1016 8번). 이 토큰은 DI 로 제공되지 않는다 — `buildConsumerInterceptors` 가 직접 넣는다 */
export const DEAD_LETTER_INTERCEPTOR_OPTIONS = Symbol('DEAD_LETTER_INTERCEPTOR_OPTIONS');
export interface DeadLetterInterceptorOptions {
  recorder: DeadLetterRecorder;
  consumerGroup: string;
  /** 보류 검사를 하는 토픽(`EventFailuresOptions.sequencedTopics`). 그 밖의 토픽은 실패를 기록만 하고 보류하지 않는다 */
  sequencedTopics: readonly string[];
}

/** 실패 행의 `handler` 칸 — 다시 넣기 헤더와 같은 값이어야 한다 */
export function handlerIdOf(cls: { name: string }, handler: { name: string }): string {
  return `${cls.name}.${handler.name}`;
}

function headerString(headers: Record<string, unknown>, name: string): string | undefined {
  const value = headers[name];
  // kafkajs 는 Buffer, 인메모리 하네스는 string 으로 준다. 그 밖의 모양(반복 헤더 배열 등)은 다시 넣기가 만들지 않는다
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf-8');
  return undefined;
}

/**
 * 알아볼 수 있는 envelope — 객체이고 `messageType` 이 문자열이다. 그 밖(파싱 불가·`null`·원시값·`messageType` 없는 객체)은
 * «종류를 모른다»로 보고 undefined 를 준다. 그런 메시지는 종류 비교로 버리지 않고 일반 경로로 보낸다(최종 리뷰 D4).
 */
function recognizedEnvelope(value: unknown): MessageEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = parseEnvelope(value);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object') return undefined;
  // 바로 아래 줄에서 `messageType` 이 문자열인지 확인한 뒤에만 envelope 로 쓴다
  const candidate = parsed as MessageEnvelope;
  return typeof candidate.messageType === 'string' ? candidate : undefined;
}

/** 알아볼 수 없는 메시지를 원본 그대로 남기는 모양. 객체면 그대로, Buffer 는 글자로(`String(Buffer)` 처럼 뭉개지 않게) */
function unrecognizedEnvelope(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { raw: value.toString('utf-8') };
  if (value !== null && typeof value === 'object') return value;
  return { raw: String(value) };
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** 다시 넣기 헤더의 행 id. 양의 정수 표기가 아니면 null — 다시 넣기로 다루지 않는다(최종 리뷰 D5) */
function parseRedriveId(raw: string): number | null {
  if (!/^[1-9][0-9]*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

@Injectable()
export class EventRetryInterceptor implements NestInterceptor {
  private readonly logger = new Logger(EventRetryInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    @Optional()
    @Inject(DLQHandler)
    private readonly dlqHandler?: DLQHandler,
    @Optional()
    @Inject(DEAD_LETTER_INTERCEPTOR_OPTIONS)
    private readonly deadLetters?: DeadLetterInterceptorOptions,
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
    // 핸들러 → 클래스 순으로 조회한다. 배열 순서가 우선순위라 핸들러 선언이 클래스 선언을
    // 덮는다. 클래스 레벨을 보는 이유: 한 컨슈머의 모든 핸들러에 같은 정책을 줘야 하는 경우가
    // 실재하는데(notification 22개 핸들러), 핸들러만 보면 데코레이터를 22번 반복해야 하고
    // 새 핸들러가 추가될 때 조용히 누락된다.
    const policyTargets = [handler, context.getClass()];
    const retryPolicy = normalizeRetryPolicy(
      this.reflector.getAllAndOverride<RetryPolicyConfig | undefined>(RETRY_POLICY_METADATA, policyTargets) ?? {},
    );
    const disableDLQ =
      this.reflector.getAllAndOverride<boolean | undefined>(DISABLE_DLQ_METADATA, policyTargets) ?? false;

    // 방어 복사 — @RetryPolicy 메타데이터가 소유한 배열을 in-place 변형하지 않는다
    // 봉투가 바뀌지 않는 한 같은 답이 나오는 거절 둘 — 스키마 위반, 테넌트 문 ②
    const nonRetryable = [...(retryPolicy.nonRetryableErrors ?? [])];
    for (const ErrorClass of [SchemaValidationError, TenantGateRejection]) {
      if (!nonRetryable.includes(ErrorClass)) nonRetryable.push(ErrorClass);
    }
    retryPolicy.nonRetryableErrors = nonRetryable;

    if (!this.deadLetters) {
      return defer(() => this.executeWithRetry(next, handler.name, kafkaContext, retryPolicy, disableDLQ));
    }

    // ── 실패 테이블 모드 (#1016 8번, 스펙 §6) ──
    // `EventTypeGuard` 는 클래스 레벨이라 이 전역 인터셉터보다 **안쪽**에서 돈다. 즉 여기는 같은 토픽의 모든 핸들러에
    // 대해 돈다. 이벤트 종류를 직접 비교하지 않으면 남의 이벤트를 이 핸들러 이름으로 보류하는 가짜 행이 생긴다(스펙 §6.1).
    //
    // 종류가 다르면 `next.handle()` 로도 넘기지 않고 **아무것도 하지 않는다.** 안쪽 체인에는 전역
    // `SchemaValidationInterceptor` 가 있고 그건 `EventTypeGuard` 보다 바깥이라, 넘기면 남의 이벤트를 검증하다
    // 던진 `SchemaValidationError` 가 이 재시도망 밖으로 샌다. Nest 는 한 패턴의 핸들러들을 forkJoin 하므로 그 한
    // 핸들러 때문에 메시지 전체가 에러 → 커밋되지 않음 → 영영 다시 온다. 스키마 위반은 종류가 맞는 핸들러가 자기
    // 이름으로 기록한다.
    //
    // envelope 를 알아보지 못한 메시지(파싱 불가, `messageType` 이 문자열이 아닌 객체 등)는 «종류가 다르다»가 아니라
    // «모른다»다 — 아래 일반 경로로 보낸다. 순서 키가 null 이라 보류되지 않고, 안쪽에서 터진 에러가 최종 실패로 원본
    // 그대로 기록된다.
    const rawValue: unknown = kafkaContext.getMessage().value;
    const envelope = recognizedEnvelope(rawValue);
    const expectedEventType = this.reflector.get<string | undefined>(EVENT_TYPE_FILTER, handler);
    if (expectedEventType && envelope && envelope.messageType !== expectedEventType) {
      return of(undefined);
    }

    const handlerId = handlerIdOf(context.getClass(), handler);
    const redriveHeader = headerString(headers, DEAD_LETTER_HEADERS.id);
    const redriveId = redriveHeader === undefined ? null : parseRedriveId(redriveHeader);
    if (redriveHeader !== undefined && redriveId === null) {
      // 다시 넣기는 Kafka 를 거치지 않으므로 이 헤더는 진짜 메시지에 실려 올 일이 없다. 실려 왔다면 남이 붙인 것이다 —
      // 다시 넣기로 다루면 엉뚱한 행을 고치거나 핸들러 이름 비교로 메시지를 버리게 되니 보통 메시지로 처리한다.
      this.logger.warn({
        msg: `Ignoring invalid ${DEAD_LETTER_HEADERS.id} header — processing as a normal message`,
        header: redriveHeader.slice(0, 100),
        topic: kafkaContext.getTopic(),
        offset: kafkaContext.getMessage().offset,
      });
    }
    if (redriveId !== null) {
      if (headerString(headers, DEAD_LETTER_HEADERS.handler) !== handlerId) {
        return of(undefined); // 같은 이벤트를 받는 다른 핸들러 — 이미 성공했으니 건드리지 않는다
      }
      const recorder = this.deadLetters.recorder;
      return defer(() => this.executeRedrive(next, redriveId, handlerId, recorder));
    }

    const message = this.toDeadLetterMessage(kafkaContext, envelope, rawValue, handlerId, this.deadLetters);
    const deadLetters = this.deadLetters;
    // 순서를 지키는 토픽만 보류한다. 그 밖의 토픽(«마지막 값이 이긴다» 스트림 등)은 실패를 기록만 한다 — 한 번의 실패가
    // 더 새 값을 붙잡지 않게(최종 리뷰 B, `EventFailuresOptions.sequencedTopics`).
    const sequenced = deadLetters.sequencedTopics.includes(message.topic);
    return defer(async () => {
      if (sequenced && (await this.holdIfBlocked(message, deadLetters.recorder))) return undefined; // 보관했다 → 정상 완료 → 커밋
      return this.executeWithRetry(next, handler.name, kafkaContext, retryPolicy, disableDLQ, message);
    });
  }

  private toDeadLetterMessage(
    kafkaContext: KafkaContext,
    envelope: MessageEnvelope | undefined,
    rawValue: unknown,
    handlerId: string,
    deadLetters: DeadLetterInterceptorOptions,
  ): DeadLetterMessage {
    const topic = kafkaContext.getTopic();
    const partition = kafkaContext.getPartition();
    const offset = String(kafkaContext.getMessage().offset);
    return {
      consumerGroup: deadLetters.consumerGroup,
      handler: handlerId,
      topic,
      // 타입은 계약이 말할 뿐 남이 보낸 메시지는 무엇이든 담을 수 있다 — 문자열일 때만 쓴다
      sequenceKey: nonEmptyString(envelope?.source?.aggregateId),
      // 빈 messageId 는 유일 키를 무력화한다 — 위치로 대신한다
      messageId: nonEmptyString(envelope?.messageId) ?? `${topic}:${partition}:${offset}`,
      eventType: envelope?.messageType ?? null,
      envelope: envelope ?? unrecognizedEnvelope(rawValue),
      kafkaPartition: partition,
      kafkaOffset: offset,
    };
  }

  /** DB 를 못 읽으면 커밋하지 않고 다시 받는다 — 보류 여부를 모르는 채 처리하면 순서가 깨질 수 있다 */
  private async holdIfBlocked(message: DeadLetterMessage, recorder: DeadLetterRecorder): Promise<boolean> {
    try {
      return await recorder.holdIfBlocked(message);
    } catch (error) {
      throw new DlqDeliveryError(
        `dead letter 보류 검사 실패: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }

  /** 다시 넣기 — 한 번만 시도한다(스펙 §7.3). 결과는 그 행에 적는다 */
  private async executeRedrive(
    next: CallHandler,
    id: number,
    handlerId: string,
    recorder: DeadLetterRecorder,
  ): Promise<unknown> {
    // 핸들러 에러만 «다시 넣기 실패»다. 결과 기록이 터진 것을 같은 catch 로 받으면 성공한 다시 넣기를
    // failed 로 적게 된다 — 그래서 기록은 try 밖에서 하고, 기록 실패는 커밋하지 않고 다시 받는다.
    let result: unknown;
    try {
      result = await lastValueFrom(next.handle(), { defaultValue: undefined });
    } catch (error) {
      if (error instanceof DlqDeliveryError) throw error;
      const failure = error instanceof Error ? error : new Error(String(error));
      this.logger.warn({ msg: `Redrive failed: ${handlerId}`, deadLetterId: id, error: failure.message });
      await this.recordOrRedeliver(() => recorder.recordRedriveFailure(id, failure));
      return undefined;
    }
    await this.recordOrRedeliver(() => recorder.markRedriven(id));
    return result;
  }

  /** 기록 실패는 `DlqDeliveryError` 로 — 중첩된 바깥 인스턴스가 핸들러 에러로 오분류해 재시도하지 않게 한다 */
  private async recordOrRedeliver(write: () => Promise<void>): Promise<void> {
    try {
      await write();
    } catch (recordError) {
      throw new DlqDeliveryError(
        `dead letter 기록 실패: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
        recordError,
      );
    }
  }

  private async executeWithRetry(
    next: CallHandler,
    handlerName: string,
    kafkaContext: KafkaContext,
    retryPolicy: NormalizedRetryPolicy,
    disableDLQ: boolean,
    deadLetterMessage?: DeadLetterMessage,
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
          this.logger.error({
            msg: `Event handler failed: ${handlerName}`,
            error: failure.message,
            stack: failure.stack,
            errorType: failure.name,
            topic: kafkaContext.getTopic(),
            partition: kafkaContext.getPartition(),
            offset: kafkaContext.getMessage().offset,
          });
        }

        if (!isRetryableError(failure, retryPolicy) || retriesSoFar >= retryPolicy.maxRetries) {
          await this.handleFinalFailure(
            kafkaContext,
            failure,
            handlerName,
            retryContext,
            disableDLQ,
            deadLetterMessage,
          );
          return undefined; // 에러 삼킴 → 정상 완료 → offset commit
        }

        const nextRetryNumber = retriesSoFar + 1;
        const delay = calculateBackoffDelay(
          nextRetryNumber,
          retryPolicy.backoff,
          retryPolicy.initialDelayMs,
          retryPolicy.maxDelayMs,
        );
        this.logger.warn({
          msg: `Retrying in ${delay}ms... (attempt ${nextRetryNumber}/${retryPolicy.maxRetries})`,
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
    deadLetterMessage?: DeadLetterMessage,
  ): Promise<void> {
    const topic = kafkaContext.getTopic();
    const offset = kafkaContext.getMessage().offset;
    const retries = retryContext.attemptNumber - 1;

    if (disableDLQ) {
      this.logger.warn({ msg: `DLQ disabled for handler: ${handlerName}. Discarding message.`, topic, offset });
      return;
    }
    if (this.deadLetters && deadLetterMessage) {
      try {
        await this.deadLetters.recorder.recordFailure(deadLetterMessage, error);
      } catch (recordError) {
        this.logger.error({
          msg: `❌ CRITICAL: Failed to record dead letter`,
          originalError: error.message,
          recordError: recordError instanceof Error ? recordError.message : String(recordError),
          topic,
          offset,
        });
        // 커밋하지 않고 다시 받는다(#1073 이후 참). DB 가 원인인 실패에서도 메시지를 잃지 않는다.
        throw new DlqDeliveryError(
          recordError instanceof Error ? recordError.message : String(recordError),
          recordError,
        );
      }
      dlqMessagesTotal.inc({ topic, consumer: handlerName, error: error.name });
      this.logger.error({
        msg: `❌ Handler failed after ${retries} retries — dead letter: ${handlerName}`,
        error: error.message,
        topic,
        offset,
      });
      return;
    }
    if (!this.dlqHandler) {
      this.logger.error({ msg: `DLQHandler not available. Cannot send message to DLQ.`, handler: handlerName, topic });
      return;
    }

    await this.sendToDLQ(kafkaContext, error, handlerName, retryContext, this.dlqHandler);

    this.logger.error({
      msg: `❌ Handler failed after ${retries} retries: ${handlerName}`,
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
      // DLQ 전송은 실패 메시지 보존이 목적이라 envelope 형태를 신뢰하고 전달한다.
      // 파싱 관용구를 직접 쓰지 않는 이유는 parseEnvelope 주석 참조 — 여기서 터지면
      // DlqDeliveryError 가 되어 offset 미커밋 → 무한 재전달이 된다.
      const envelope = parseEnvelope(message.value);

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

      this.logger.log({
        msg: `📤 Message sent to DLQ after ${retryContext.attemptHistory.length} failed attempts`,
        topic,
        messageType: envelope.messageType,
        aggregateId: envelope.source?.aggregateId,
      });
    } catch (dlqError) {
      this.logger.error({
        msg: `❌ CRITICAL: Failed to send message to DLQ`,
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
