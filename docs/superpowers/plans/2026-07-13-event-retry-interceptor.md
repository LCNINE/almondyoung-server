# EventRetryInterceptor (필터 → 인터셉터 재설계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로덕션에서 크래시하는 `EventsExceptionFilter`를 `EventRetryInterceptor`(전역 APP_INTERCEPTOR)로 대체해 이벤트 컨슈머의 재시도·분류·DLQ·offset commit을 실작동시킨다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-13-event-retry-interceptor-design.md` 참조. 인터셉터는 `ExecutionContext.getHandler()`(실핸들러)로 `@RetryPolicy`를 읽고 `next.handle()` 재호출로 재시도한다. EventsModule `forRoot`/`forConsumerModule`이 최외곽 APP_INTERCEPTOR로 자동 등록한다. 기존 필터와 `@UseFilters` 8곳은 제거한다.

**Tech Stack:** NestJS 11, `@nestjs/microservices` v11.1.17 (Kafka), RxJS, Jest.

## Global Constraints

- 타입 안전: `any`/`as` 캐스팅 금지 (CLAUDE.md). 예외: 테스트 코드에서 기존 스펙들이 쓰는 제한적 캐스팅(`as unknown as ExecutionContext` 등)은 기존 패턴 준수로 허용.
- `DLQHandler.sendToDLQ` 시그니처·DLQ 메시지 포맷 무변경 (ops 재구동 도구 호환).
- 재시도 계약: `maxRetries` = 초기 시도 **이후** 재시도 횟수 (총 호출 = 1 + maxRetries). backoff는 `calculateBackoffDelay(k)` k=1부터 (exponential: 1s→2s→4s…).
- DLQ 전송 성공/DLQ 비활성/DLQHandler 부재 → 에러 삼킴(정상 완료 = offset commit). **DLQ 전송 실패만** 에러 재전파(재전달 유도).
- 핸들러 멱등 가드·G4·G7 (작업 13 스펙 §5) 무변경.
- 커밋은 작업 단위로 분리, 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: `EventRetryInterceptor` 유닛 TDD

**Files:**
- Create: `libs/events/src/interceptors/event-retry.interceptor.ts`
- Test: `libs/events/src/interceptors/event-retry.interceptor.spec.ts`

**Interfaces:**
- Consumes: `retry.util.ts`의 `normalizeRetryPolicy/isRetryableError/calculateBackoffDelay/sleep/createRetryContext/updateRetryContext`, `retry-policy.types.ts`의 `RETRY_POLICY_METADATA/DISABLE_DLQ_METADATA/RetryPolicyConfig/RetryContext`, `DLQHandler.sendToDLQ(params)` (시그니처: `dlq-handler.service.ts:43`).
- Produces: `export class EventRetryInterceptor implements NestInterceptor` — 생성자 `(reflector: Reflector, @Optional() dlqHandler?: DLQHandler)`. Task 2가 `useClass`로 등록, Task 3가 DI로 사용.

- [ ] **Step 1: 실패하는 유닛 스펙 작성**

`libs/events/src/interceptors/event-retry.interceptor.spec.ts`:

```typescript
import { CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { KafkaContext, KafkaHeaders } from '@nestjs/microservices';
import type { Consumer, KafkaMessage, Producer } from '@nestjs/microservices/external/kafka.interface';
import { defer, lastValueFrom, Observable } from 'rxjs';
import { RetryPolicy, DisableDLQ } from '../retry/retry-policy.decorator';
import { DLQHandler } from '../dlq/dlq-handler.service';
import { EventRetryInterceptor } from './event-retry.interceptor';

class PermanentError extends Error {}
class TransientError extends Error {}

/**
 * @RetryPolicy 메타데이터를 실제 데코레이터로 부착한 테스트 컨슈머.
 * reflector.get(META, handler)이 실핸들러에서 동작하는지 검증하는 핵심 픽스처.
 */
class TestConsumer {
  @RetryPolicy({ nonRetryableErrors: [PermanentError] })
  async handleClassified() {}

  @RetryPolicy({ maxRetries: 2, backoff: 'fixed', initialDelayMs: 1, maxDelayMs: 1 })
  async handleRetryable() {}

  @RetryPolicy({ maxRetries: 2, backoff: 'exponential', initialDelayMs: 2, maxDelayMs: 100 })
  async handleExponential() {}

  @RetryPolicy({ maxRetries: 0 })
  @DisableDLQ()
  async handleDisabledDlq() {}
}

const ENVELOPE = {
  messageType: 'TestEvent',
  source: { aggregateId: 'agg-1' },
};

function makeKafkaContext(overrides: Partial<KafkaMessage> = {}, heartbeat = jest.fn().mockResolvedValue(undefined)) {
  const message = {
    value: Buffer.from(JSON.stringify(ENVELOPE)),
    offset: '42',
    headers: {},
    ...overrides,
  } as unknown as KafkaMessage;
  const ctx = new KafkaContext([
    message,
    3,
    'test.topic.v1',
    {} as unknown as Consumer,
    heartbeat,
    {} as unknown as Producer,
  ]);
  return { ctx, heartbeat };
}

/** RpcContextCreator가 만드는 형태 그대로: (args, class, handler) + setType('rpc') */
function makeRpcContext(handler: (...args: unknown[]) => unknown, kafkaCtx: KafkaContext) {
  const host = new ExecutionContextHost([{}, kafkaCtx], TestConsumer, handler as (...args: unknown[]) => unknown);
  host.setType('rpc');
  return host;
}

function nextFrom(impl: jest.Mock): CallHandler {
  return { handle: (): Observable<unknown> => defer(() => impl()) };
}

describe('EventRetryInterceptor', () => {
  let interceptor: EventRetryInterceptor;
  let dlq: { sendToDLQ: jest.Mock };

  beforeEach(() => {
    dlq = { sendToDLQ: jest.fn().mockResolvedValue(undefined) };
    interceptor = new EventRetryInterceptor(new Reflector(), dlq as unknown as DLQHandler);
  });

  async function run(handler: (...args: unknown[]) => unknown, next: CallHandler, kafkaCtx: KafkaContext) {
    return lastValueFrom(interceptor.intercept(makeRpcContext(handler, kafkaCtx), next), {
      defaultValue: undefined,
    });
  }

  it('nonRetryable 에러 → 재시도 없이 즉시 DLQ, 에러 미전파(offset commit 등가)', async () => {
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new PermanentError('so not found'));

    await expect(run(TestConsumer.prototype.handleClassified, nextFrom(impl), ctx)).resolves.toBeUndefined();

    expect(impl).toHaveBeenCalledTimes(1);
    expect(dlq.sendToDLQ).toHaveBeenCalledTimes(1);
    expect(dlq.sendToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({
        originalTopic: 'test.topic.v1',
        originalMessage: ENVELOPE,
        context: expect.objectContaining({
          partition: 3,
          offset: '42',
          consumer: 'handleClassified',
          retryCount: 1, // 실패 1회 (초기 시도)
        }),
      }),
    );
  });

  it('retryable 에러 → 정확히 maxRetries회 재시도 후 DLQ (#507 회귀 봉인)', async () => {
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new TransientError('db down'));

    await expect(run(TestConsumer.prototype.handleRetryable, nextFrom(impl), ctx)).resolves.toBeUndefined();

    expect(impl).toHaveBeenCalledTimes(3); // 1 + maxRetries(2)
    expect(dlq.sendToDLQ).toHaveBeenCalledTimes(1);
    const params = dlq.sendToDLQ.mock.calls[0][0];
    expect(params.context.retryCount).toBe(3); // 총 실패 횟수 = attemptHistory 길이
    expect(params.context.attemptHistory).toHaveLength(3);
  });

  it('재시도 중 성공 → 결과 반환, DLQ 미호출', async () => {
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValueOnce(new TransientError('blip')).mockResolvedValue('ok');

    await expect(run(TestConsumer.prototype.handleRetryable, nextFrom(impl), ctx)).resolves.toBe('ok');

    expect(impl).toHaveBeenCalledTimes(2);
    expect(dlq.sendToDLQ).not.toHaveBeenCalled();
  });

  it('backoff가 escalate 한다 (exponential: 2ms → 4ms)', async () => {
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new TransientError('db down'));
    const warnSpy = jest.spyOn(
      (interceptor as unknown as { logger: { warn: (msg: string) => void } }).logger,
      'warn',
    );

    await run(TestConsumer.prototype.handleExponential, nextFrom(impl), ctx);

    const delays = warnSpy.mock.calls
      .map(([msg]) => /Retrying in (\d+)ms/.exec(String(msg))?.[1])
      .filter(Boolean);
    expect(delays).toEqual(['2', '4']);
  });

  it('backoff 대기 중 heartbeat를 호출한다', async () => {
    const { ctx, heartbeat } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new TransientError('db down'));

    await run(TestConsumer.prototype.handleRetryable, nextFrom(impl), ctx);

    expect(heartbeat).toHaveBeenCalled();
  });

  it('@DisableDLQ → DLQ 미호출, 에러 삼킴', async () => {
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new TransientError('drop me'));

    await expect(run(TestConsumer.prototype.handleDisabledDlq, nextFrom(impl), ctx)).resolves.toBeUndefined();

    expect(dlq.sendToDLQ).not.toHaveBeenCalled();
  });

  it('DLQHandler 미주입 → 로그 후 삼킴 (offset commit 유지)', async () => {
    const bare = new EventRetryInterceptor(new Reflector());
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new PermanentError('no dlq configured'));

    await expect(
      lastValueFrom(bare.intercept(makeRpcContext(TestConsumer.prototype.handleClassified, ctx), nextFrom(impl)), {
        defaultValue: undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it('DLQ 전송 실패 → 에러 재전파 (offset 미커밋 = 재전달 유도)', async () => {
    const { ctx } = makeKafkaContext();
    dlq.sendToDLQ.mockRejectedValue(new Error('kafka producer down'));
    const impl = jest.fn().mockRejectedValue(new PermanentError('poison'));

    await expect(run(TestConsumer.prototype.handleClassified, nextFrom(impl), ctx)).rejects.toThrow(
      'kafka producer down',
    );
  });

  it('rpc 외 컨텍스트(http) → 무개입 통과 (에러 전파)', async () => {
    const host = new ExecutionContextHost([{}, {}], TestConsumer, TestConsumer.prototype.handleClassified);
    // setType 미호출 → 기본 'http'
    const impl = jest.fn().mockRejectedValue(new Error('http error'));

    await expect(lastValueFrom(interceptor.intercept(host, nextFrom(impl)))).rejects.toThrow('http error');
    expect(dlq.sendToDLQ).not.toHaveBeenCalled();
  });

  it('request-response 메시지(correlationId+replyTopic) → 무개입 통과 (에러 전파)', async () => {
    const { ctx } = makeKafkaContext({
      headers: {
        [KafkaHeaders.CORRELATION_ID]: 'corr-1',
        [KafkaHeaders.REPLY_TOPIC]: 'reply.topic',
      },
    } as Partial<KafkaMessage>);
    const impl = jest.fn().mockRejectedValue(new Error('rr error'));

    await expect(run(TestConsumer.prototype.handleClassified, nextFrom(impl), ctx)).rejects.toThrow('rr error');
    expect(dlq.sendToDLQ).not.toHaveBeenCalled();
  });

  it('SchemaValidationError는 정책 무관 항상 nonRetryable (즉시 DLQ)', async () => {
    const { SchemaValidationError } = jest.requireActual<
      typeof import('@packages/event-contracts/types')
    >('@packages/event-contracts/types');
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new SchemaValidationError('bad payload', []));

    await expect(run(TestConsumer.prototype.handleRetryable, nextFrom(impl), ctx)).resolves.toBeUndefined();
    expect(impl).toHaveBeenCalledTimes(1); // 재시도 없음
    expect(dlq.sendToDLQ).toHaveBeenCalledTimes(1);
  });
});
```

주의: `SchemaValidationError` 생성자 시그니처는 `packages/event-contracts/types`에서 확인 후 맞출 것 (인자 개수가 다르면 스펙의 생성 부분만 조정).

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=event-retry.interceptor.spec -v`
Expected: FAIL — `Cannot find module './event-retry.interceptor'`

- [ ] **Step 3: 인터셉터 구현**

`libs/events/src/interceptors/event-retry.interceptor.ts`:

```typescript
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

    retryPolicy.nonRetryableErrors = retryPolicy.nonRetryableErrors ?? [];
    if (!retryPolicy.nonRetryableErrors.includes(SchemaValidationError)) {
      retryPolicy.nonRetryableErrors.push(SchemaValidationError);
    }

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

    await this.sendToDLQ(kafkaContext, error, handlerName, retryContext);

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
  ): Promise<void> {
    const message = kafkaContext.getMessage();
    const topic = kafkaContext.getTopic();

    try {
      const value = message.value;
      const jsonString: string = Buffer.isBuffer(value) ? value.toString('utf-8') : String(value ?? '{}');
      const envelope = JSON.parse(jsonString) as MessageEnvelope;

      await this.dlqHandler!.sendToDLQ({
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
      throw dlqError;
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
```

주의사항:
- `nonRetryableErrors!.includes(...)` 없이 위 코드처럼 재대입으로 처리 — non-null assertion 최소화.
- `this.dlqHandler!`는 `handleFinalFailure`에서 부재를 이미 가드했으므로 안전하지만, lint가 거부하면 `sendToDLQ`에 `dlqHandler: DLQHandler` 파라미터로 넘기는 형태로 바꿔도 좋다.
- DLQ envelope 파싱 실패 시 rethrow(재전달)는 구 필터와 동일한 의도적 parity — 개선은 범위 밖.

- [ ] **Step 4: 유닛 통과 확인**

Run: `npx jest --testPathPattern=event-retry.interceptor.spec -v`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/interceptors/event-retry.interceptor.ts libs/events/src/interceptors/event-retry.interceptor.spec.ts
git commit -m "feat(events): EventRetryInterceptor — 재시도/분류/DLQ/offset commit 인터셉터 (필터 크래시 fast-follow, #507)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: EventsModule 전역 등록 (최외곽 APP_INTERCEPTOR)

**Files:**
- Modify: `libs/events/src/events.module.ts` (forRoot providers ~`:286`, forConsumerModule providers ~`:256` 부근)
- Modify: `libs/events/src/index.ts` (인터셉터 export 추가)
- Test: `libs/events/src/events.module.spec.ts`

**Interfaces:**
- Consumes: Task 1의 `EventRetryInterceptor` (useClass 등록 — Reflector·@Optional DLQHandler DI).
- Produces: `forRoot`/`forConsumerModule` 반환 모듈의 providers에 `{ provide: APP_INTERCEPTOR, useClass: EventRetryInterceptor }`가 **다른 APP_INTERCEPTOR보다 앞에** 존재. Task 4의 컨슈머들이 이 자동 등록에 의존.

- [ ] **Step 1: 실패하는 모듈 스펙 추가**

`libs/events/src/events.module.spec.ts`에 추가 (기존 fixture 재사용):

```typescript
import { APP_INTERCEPTOR } from '@nestjs/core';
import { EventRetryInterceptor } from './interceptors/event-retry.interceptor';

describe('EventsModule global retry interceptor registration', () => {
  const kafka = { clientId: 'test-service', brokers: ['localhost:9092'] };

  function appInterceptorsOf(dynamicModule: DynamicModule) {
    return (dynamicModule.providers ?? []).filter(
      (provider): provider is { provide: unknown; useClass?: unknown } =>
        typeof provider === 'object' && provider !== null && (provider as { provide?: unknown }).provide === APP_INTERCEPTOR,
    );
  }

  it('forRoot: EventRetryInterceptor가 최외곽(첫 번째) 전역 인터셉터다', () => {
    const moduleRef = EventsModule.forRoot({ streams: [USER_STREAM], kafka });
    const interceptors = appInterceptorsOf(moduleRef);
    expect(interceptors.length).toBeGreaterThanOrEqual(2);
    expect(interceptors[0].useClass).toBe(EventRetryInterceptor);
  });

  it('forConsumerModule: EventRetryInterceptor가 최외곽(첫 번째) 전역 인터셉터다', () => {
    const moduleRef = EventsModule.forConsumerModule({ streams: [USER_STREAM], groupId: 'test-consumer', kafka });
    const interceptors = appInterceptorsOf(moduleRef);
    expect(interceptors.length).toBeGreaterThanOrEqual(2);
    expect(interceptors[0].useClass).toBe(EventRetryInterceptor);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest --testPathPattern=events.module.spec -v`
Expected: FAIL — `interceptors[0].useClass`가 undefined (retry provider 부재)

- [ ] **Step 3: 모듈 등록 구현**

`libs/events/src/events.module.ts`:

1. import 추가: `import { EventRetryInterceptor } from './interceptors/event-retry.interceptor';`
2. `forRoot`(providers 조립부, `chainInterceptorProvider` 선언 근처)와 `forConsumerModule`(interceptorProvider 선언 근처) **양쪽에** 추가:

```typescript
    // 재시도/분류/DLQ/offset commit — 반드시 최외곽(다른 인터셉터보다 먼저 등록)이어야
    // SchemaValidationError 등 안쪽 인터셉터의 에러도 분류망에 잡힌다.
    const retryInterceptorProvider = {
      provide: APP_INTERCEPTOR,
      useClass: EventRetryInterceptor,
    };
```

3. 두 메서드의 `providers` 배열에서 `retryInterceptorProvider`를 **기존 SchemaValidation `interceptorProvider`보다 앞에** 삽입. 예 (forRoot):

```typescript
    const providers = [
      ...(dlqProvider ? [dlqProvider] : []),
      retryInterceptorProvider, // 최외곽 — 등록 순서가 래핑 순서
      interceptorProvider, // 스키마 검증 Interceptor는 항상 등록
      chainInterceptorProvider, // chain context 전파 인터셉터
      // ...기존 나머지 그대로
    ];
```

forConsumerModule의 providers 배열도 동일 원칙으로 (retry가 첫 APP_INTERCEPTOR).

4. `libs/events/src/index.ts`에 export 추가 (스키마 검증 인터셉터 export 옆):

```typescript
export * from './interceptors/event-retry.interceptor';
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest --testPathPattern=events.module.spec -v`
Expected: PASS (기존 2 + 신규 2)

- [ ] **Step 5: 커밋**

```bash
git add libs/events/src/events.module.ts libs/events/src/index.ts libs/events/src/events.module.spec.ts
git commit -m "feat(events): EventRetryInterceptor 전역(APP_INTERCEPTOR) 자동 등록 — 미부착 사고 원천 차단

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: 실배선 인프로세스 테스트 (Nest 실플럼빙 검증)

**Files:**
- Create: `libs/events/src/interceptors/event-retry.wiring.spec.ts`

**Interfaces:**
- Consumes: Task 1 `EventRetryInterceptor`, `@OnEvent`(`consumers/decorators.ts`), `DLQHandler` 토큰.
- Produces: 없음 (회귀 가드). 이 테스트가 있었으면 구 필터의 null-handler 크래시를 잡았다 — "유닛은 통과, 프로덕션 크래시" 유형의 봉인.

- [ ] **Step 1: 실배선 스펙 작성**

```typescript
/**
 * 실배선(in-process real-wiring) 회귀 가드.
 *
 * Nest 가 실제로 바인딩한 핸들러(RpcContextCreator → RpcProxy → 전역 인터셉터 체인)를
 * ServerKafka.handleEvent 와 동일한 방식으로 호출한다. 구 EventsExceptionFilter 는
 * 이 경로에서 host.getHandler()=null 로 즉시 크래시했는데, wiring-only 유닛으로는
 * 잡히지 않았다 — 이 스펙이 그 계층을 봉인한다.
 */
import { Controller, INestMicroservice, NotFoundException } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { KafkaContext, Server, CustomTransportStrategy } from '@nestjs/microservices';
import type { Consumer, KafkaMessage, Producer } from '@nestjs/microservices/external/kafka.interface';
import { Test } from '@nestjs/testing';
import { isObservable, lastValueFrom } from 'rxjs';
import { OnEvent, EventPayload } from '../consumers/decorators';
import { RetryPolicy } from '../retry/retry-policy.decorator';
import { DLQHandler } from '../dlq/dlq-handler.service';
import { EventRetryInterceptor } from './event-retry.interceptor';

/** 핸들러 바인딩만 캡처하는 transport — 브로커 불필요 */
class CapturingServer extends Server implements CustomTransportStrategy {
  listen(callback: () => void) {
    callback();
  }
  close() {}
  on() {}
  unwrap<T>(): T {
    return undefined as T;
  }
}

const handlerCalls: unknown[] = [];

@Controller()
class WiringTestConsumer {
  @OnEvent('wiring.test.v1', 'WiringTested')
  @RetryPolicy({ maxRetries: 1, backoff: 'fixed', initialDelayMs: 1, maxDelayMs: 1, nonRetryableErrors: [NotFoundException] })
  async handleWiringTested(@EventPayload() payload: { poison: boolean }) {
    handlerCalls.push(payload);
    throw new NotFoundException('so not found');
  }
}

describe('EventRetryInterceptor 실배선 (RpcContextCreator 바인딩 경로)', () => {
  let app: INestMicroservice;
  let strategy: CapturingServer;
  const dlq = { sendToDLQ: jest.fn().mockResolvedValue(undefined) };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [WiringTestConsumer],
      providers: [
        { provide: APP_INTERCEPTOR, useClass: EventRetryInterceptor },
        { provide: DLQHandler, useValue: dlq },
      ],
    }).compile();

    strategy = new CapturingServer();
    app = moduleRef.createNestMicroservice({ strategy });
    await app.listen();
  });

  afterAll(async () => {
    await app.close();
  });

  it('포이즌 메시지 → 실플럼빙 통과 → 분류(즉시 DLQ) → 에러 미전파(offset commit 등가)', async () => {
    const boundHandler = strategy.getHandlerByPattern('wiring.test.v1');
    expect(boundHandler).toBeDefined();

    const envelope = {
      messageType: 'WiringTested',
      source: { aggregateId: 'agg-w1' },
      payload: { poison: true },
    };
    const message = {
      value: Buffer.from(JSON.stringify(envelope)),
      offset: '7',
      headers: {},
    } as unknown as KafkaMessage;
    const kafkaContext = new KafkaContext([
      message,
      0,
      'wiring.test.v1',
      {} as unknown as Consumer,
      jest.fn().mockResolvedValue(undefined),
      {} as unknown as Producer,
    ]);

    // ServerKafka.handleEvent 와 동일한 호출 형태
    const resultOrStream = await boundHandler!(envelope, kafkaContext);
    if (isObservable(resultOrStream)) {
      await lastValueFrom(resultOrStream, { defaultValue: undefined });
    }

    expect(handlerCalls).toHaveLength(1); // nonRetryable → 재시도 없음 (메타데이터가 실경로에서 읽혔다는 증거)
    expect(dlq.sendToDLQ).toHaveBeenCalledTimes(1);
    expect(dlq.sendToDLQ.mock.calls[0][0].context.consumer).toBe('handleWiringTested');
  });
});
```

주의: `@EventPayload()` 파라미터 데코레이터의 payload 추출 형식은 `consumers/decorators.ts`를 확인해 envelope 구조를 맞출 것 (envelope.payload 접근이면 위 그대로, 다르면 envelope 필드만 조정). `boundHandler`가 undefined면 패턴 정규화 문제 — `strategy.getHandlers()` 키를 덤프해 실제 키로 조회.

- [ ] **Step 2: 통과 확인**

Run: `npx jest --testPathPattern=event-retry.wiring.spec -v`
Expected: PASS. 만약 `strategy.getHandlerByPattern`이 비어 있으면 `await app.listen()` 전에 핸들러 바인딩이 안 된 것 — `app.init()` 후 `app.listen()` 순서로 조정.

- [ ] **Step 3: 커밋**

```bash
git add libs/events/src/interceptors/event-retry.wiring.spec.ts
git commit -m "test(events): 실배선 인프로세스 회귀 가드 — Nest RPC 바인딩 경로에서 분류/DLQ/삼키기 검증

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: EventsExceptionFilter 제거 (+ 컨슈머 8곳, 문서)

**Files:**
- Delete: `libs/events/src/filters/events-exception.filter.ts` (+ `filters/` 디렉터리가 비면 함께)
- Modify: `libs/events/src/index.ts:30` — `export * from './filters/events-exception.filter';` 제거
- Modify (각각 `@UseFilters(EventsExceptionFilter)` 라인 + `EventsExceptionFilter` import + 미사용 `UseFilters` import 제거):
  - `apps/notification/src/dispatcher/handlers/order-event.consumer.ts:20`
  - `apps/notification/src/dispatcher/handlers/user-event.consumer.ts:27`
  - `apps/notification/src/dispatcher/handlers/wallet-event.consumer.ts:65`
  - `apps/core/src/modules/sales-order/consumers/order-events.consumer.ts:37`
  - `apps/wallet/src/consumers/ugc-command.consumer.ts:9`
  - `apps/wallet/src/consumers/billing-charge.consumer.ts:27`
  - `apps/analytics/src/datasets/orders/ingest/order-events.consumer.ts:15`
  - `apps/analytics/src/datasets/products/ingest/product-events.consumer.ts:16`
- Modify: `apps/core/src/modules/sales-order/consumers/order-events.consumer.spec.ts` (~`:405-420`)
- Modify: `libs/events/docs/auto-dlq-guide.md`, `libs/events/docs/first-look.md` (문구)

**Interfaces:**
- Consumes: Task 2의 전역 등록 (이것 없이 이 Task를 먼저 하면 컨슈머 무보호 상태가 됨 — **순서 준수**).
- Produces: `EventsExceptionFilter` 심볼 소멸 — 리포 전체에서 참조 0.

- [ ] **Step 1: 필터 삭제 + 참조 제거**

```bash
git rm libs/events/src/filters/events-exception.filter.ts
```

`libs/events/src/index.ts`에서 `export * from './filters/events-exception.filter';` 라인 삭제.

8개 컨슈머 파일 각각에서:
1. `@UseFilters(EventsExceptionFilter)` 데코레이터 라인 삭제.
2. `@app/events` import에서 `EventsExceptionFilter` 제거 (다른 심볼은 유지 — 예: core는 `OnEvent, EventPayload, EventEnvelope, RetryPolicy` 유지).
3. `@nestjs/common` import에서 `UseFilters`가 다른 곳에 안 쓰이면 제거.

확인:

```bash
grep -rn "EventsExceptionFilter\|UseFilters" apps libs --include="*.ts" | grep -v node_modules
```

Expected: `order-events.consumer.spec.ts`의 참조(다음 Step에서 처리) 외 0건.

- [ ] **Step 2: order-events.consumer.spec.ts 갱신**

- `it('attaches EventsExceptionFilter (재시도→DLQ→offset commit)', ...)` 테스트 블록 삭제 (전역 등록 봉인은 Task 2의 `events.module.spec.ts`가 담당).
- `EventsExceptionFilter`, `EXCEPTION_FILTERS_METADATA` import 제거.
- describe 위 주석 블록의 "근본 원인은 컨슈머에 EventsExceptionFilter 미부착…" 문단을 다음으로 교체:

```
 * 작업 13 (WS-D, P1-1·P1-2) 회귀 가드.
 *
 * 재시도/DLQ 처리는 EventRetryInterceptor 가 EventsModule 에서 전역(APP_INTERCEPTOR)
 * 자동 등록된다 (봉인: libs/events/src/events.module.spec.ts). 여기서는 컨슈머별
 * @RetryPolicy 분류 계약만 메타데이터 레벨에서 봉인한다.
```

- `@RetryPolicy` 메타데이터 테스트 4개는 그대로 유지.

Run: `npx jest --testPathPattern=order-events.consumer.spec -v`
Expected: PASS (필터 부착 테스트 1개 감소)

- [ ] **Step 3: 문서 문구 갱신**

- `libs/events/docs/auto-dlq-guide.md` "작동 원리" 섹션(~`:237`): `2. **Exception Filter 캐치**: \`EventsExceptionFilter\`가 에러를 자동으로 캐치` → `2. **Interceptor 캐치**: 전역 등록된 \`EventRetryInterceptor\`가 에러를 캐치 (별도 부착 불필요)`. 로그 예시의 `[EventsExceptionFilter]` prefix → `[EventRetryInterceptor]`.
- `libs/events/docs/first-look.md:126`: `EventsExceptionFilter로 자동 전송 완료` → `EventRetryInterceptor(전역 등록)로 자동 전송 완료`.

- [ ] **Step 4: 빌드/전 스위트 확인**

```bash
npm run build
npx jest --testPathPattern="libs/events" -v
npx jest --testPathPattern=order-events.consumer.spec -v
```

Expected: 빌드 exit 0, 테스트 전부 PASS.

- [ ] **Step 5: 커밋**

```bash
git add -A libs/events apps/notification apps/core apps/wallet apps/analytics
git commit -m "refactor(events): EventsExceptionFilter 제거 — 인터셉터 전역 등록으로 대체 (프로덕션 null-handler 크래시 소멸)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: 최종 검증 (verify 게이트)

**Files:** 없음 (검증 전용)

- [ ] **Step 1: 전체 빌드·관련 스위트·lint 스코프 검증**

```bash
npm run build                                            # 전 앱 exit 0
npx jest --testPathPattern="(libs/events|order-events.consumer)" -v
npx eslint $(git diff --name-only HEAD~4 -- '*.ts' | tr '\n' ' ')   # 변경 파일 신규 error 0 (기존 repo debt 무관 — lint-scope-caveat)
```

- [ ] **Step 2: 크래시 재현 프로브 역검증 (수동 1회)**

브레인스토밍에서 사용한 프로브를 인터셉터 체계에 맞게 재실행 — Task 3 실배선 스펙이 이를 자동화했으므로, `npx jest --testPathPattern=event-retry.wiring.spec -v` PASS 를 근거로 갈음. 추가로 스모크:

```bash
node -e "
require('reflect-metadata');
const { EventRetryInterceptor } = require('./dist/libs/events/src/interceptors/event-retry.interceptor.js');
console.log('loadable:', typeof EventRetryInterceptor === 'function');
" 2>/dev/null || echo "dist 경로는 build 산출 구조에 맞게 조정"
```

- [ ] **Step 3: superpowers:verification-before-completion 체크리스트 수행**

모든 주장(“작동한다”)에 명령 출력 근거가 있는지 확인 후 다음 Task 진행.

---

### Task 6: 이슈·현황판 정리

**Files:**
- Modify: `docs/logistics-backend-hardening-2026-07.md`

- [ ] **Step 1: 감사 추적용 신규 이슈 생성**

```bash
gh issue create --repo LCNINE/almondyoung-server \
  --title "[@app/events] EventsExceptionFilter가 프로덕션 RPC 에러 경로에서 즉시 크래시 — @RetryPolicy·DLQ·offset commit 전면 미작동 (#507 상위 결함)" \
  --label bug \
  --body "$(cat <<'EOF'
## 요약
@nestjs/microservices v11 의 RPC 예외 필터는 RpcProxy.handleError 가 만든 ExecutionContextHost(args) 를 받는데, 이 host 는 getHandler()=null (setHandler 미호출). EventsExceptionFilter 는 :48 에서 메서드 존재만 가드해 null 을 통과시키고, :51 reflector.get(RETRY_POLICY_METADATA, null) 이 TypeError → rejected promise → eachMessage reject → offset 미커밋 → 무한 재전달. 재시도·분류·DLQ·commit 코드는 전부 도달 불가.

## 함의
- @RetryPolicy 메타데이터 전면 미작동 (nonRetryableErrors 포함).
- 작업 13 P1-1/P1-2 포이즌 분류는 프로덕션 미작동 (유닛은 부착 wiring 만 검증해 잠복).
- #507 (attemptNumber 고정) 은 이 크래시에 가려진 두 번째 증상 — :112 만 고쳐도 프로덕션 미해결.
- retryHandler 도 handler=null 로 항상 'Cannot retry handler' — 필터로는 재시도 자체가 불가능 (구조적 원인).

## 해소
EventRetryInterceptor 재설계로 해소 — 설계: docs/superpowers/specs/2026-07-13-event-retry-interceptor-design.md, 구현 커밋은 close 코멘트 참조. #507 과 상호참조.
EOF
)"
```

출력된 이슈 번호를 기록 (이하 `<NEW>`).

- [ ] **Step 2: 구현 커밋 해시로 두 이슈 close**

```bash
LAST=$(git log --oneline -1 --format=%h)
gh issue close <NEW> --repo LCNINE/almondyoung-server \
  --comment "EventRetryInterceptor 재설계로 해소 — 필터 제거·전역 인터셉터 등록·실배선 회귀 가드 추가 ($LAST, develop). 상세: docs/superpowers/specs/2026-07-13-event-retry-interceptor-design.md"
gh issue close 507 --repo LCNINE/almondyoung-server \
  --comment "EventRetryInterceptor 재설계로 재시도 루프 코드 자체가 대체되어 해소 ($LAST, develop). attemptNumber 는 updateRetryContext 반환값 재대입으로 정확히 증가하며, 'maxRetries회 재시도 후 DLQ' 회귀 테스트로 봉인 (event-retry.interceptor.spec.ts). 본 이슈의 'P1-1/P1-2 경로는 영향 없음' 판단은 상위 결함(#<NEW>, 필터 null-handler 크래시)으로 실제로는 성립하지 않았음 — 함께 해소됨."
```

- [ ] **Step 2.5: channel-adapter 로컬 RetryPolicy 분리 이슈 생성 (스펙 §5 비목표)**

```bash
gh issue create --repo LCNINE/almondyoung-server \
  --title "[channel-adapter] 자체 로컬 RetryPolicy 데코레이터 — @app/events 재시도/DLQ 체계로 이관 검토" \
  --label needs-triage \
  --body "$(cat <<'EOF'
apps/channel-adapter/src/decorators/retry-policy.decorator.ts 는 @app/events 의 RetryPolicy 와 별개인 자체 구현이며, 컨슈머(fulfillment-event.consumer.ts:44, stock-event.consumer.ts:14)의 DLQ 전송 로직은 주석 처리된 반쪽 상태다. EventRetryInterceptor 전역 등록(#<NEW> 해소 작업) 이후 channel-adapter 컨슈머도 기본 정책의 재시도/DLQ 보호는 받지만, 로컬 데코레이터의 정책 값(dlqTopic 등)은 인터셉터가 읽지 않는다. @app/events 의 @RetryPolicy 로 이관하거나 로컬 구현을 완성/제거하는 결정 필요. 이번 재설계 범위에서 의도적으로 제외 (스펙 2026-07-13-event-retry-interceptor-design.md §5).
EOF
)"
```

- [ ] **Step 3: 현황판 정정**

`docs/logistics-backend-hardening-2026-07.md`에서:
1. 작업 13 완료 블록의 "리뷰 발견 fast-follow ①"(#507 항목)을 찾아 상태를 "✅ 해소(2026-07-13, EventRetryInterceptor 재설계)"로 갱신, `#<NEW>` 상호참조 추가.
2. 같은 블록에 정정 노트 추가:

```
> **정정 (2026-07-13)**: 작업 13 의 P1-1/P1-2 는 완료 표기 시점에 프로덕션에서 실제로는 미작동이었다 —
> EventsExceptionFilter 가 RPC 에러 경로에서 host.getHandler()=null 로 :51 에서 즉시 크래시 (#<NEW>).
> EventRetryInterceptor 재설계(스펙 2026-07-13-event-retry-interceptor-design.md)로 분류·재시도·DLQ·offset commit 이
> 실작동하게 됐고, 실배선 인프로세스 테스트로 봉인. #507 도 동일 재설계로 해소.
```

3. 잔여 백로그 목록에서 "이슈 #507 필터버그" 항목 제거(또는 완료 표시).

- [ ] **Step 4: 커밋**

```bash
git add docs/logistics-backend-hardening-2026-07.md
git commit -m "docs(core): 현황판 정정 — 작업 13 실작동화(EventRetryInterceptor)·#507 종결 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
