/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return --
   테스트 픽스처가 TestConsumer.prototype.handleX 를 unbound 로 전달하는 것이 이 스펙의 핵심 설계(실핸들러 메타데이터 조회 검증)이고, jest mock 접근은 기존 spec 관례와 동일 계열. */
import { CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { KafkaContext, KafkaHeaders } from '@nestjs/microservices';
import type { Consumer, KafkaMessage, Producer } from '@nestjs/microservices/external/kafka.interface';
import { defer, lastValueFrom, Observable } from 'rxjs';
import { SchemaValidationError } from '@packages/event-contracts/types';
import { RetryPolicy, DisableDLQ } from '../retry/retry-policy.decorator';
import { DLQHandler } from '../dlq/dlq-handler.service';
import { DlqDeliveryError, EventRetryInterceptor } from './event-retry.interceptor';

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
    const warnSpy = jest.spyOn((interceptor as unknown as { logger: { warn: (msg: string) => void } }).logger, 'warn');

    await run(TestConsumer.prototype.handleExponential, nextFrom(impl), ctx);

    const delays = warnSpy.mock.calls.map(([msg]) => /Retrying in (\d+)ms/.exec(String(msg))?.[1]).filter(Boolean);
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

  it('DlqDeliveryError(중첩 인스턴스의 DLQ 실패 마커) → 재분류 없이 그대로 전파, 핸들러 재실행/DLQ 재호출 없음', async () => {
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new DlqDeliveryError('kafka producer down', new Error('root cause')));

    await expect(run(TestConsumer.prototype.handleRetryable, nextFrom(impl), ctx)).rejects.toThrow(
      'kafka producer down',
    );

    expect(impl).toHaveBeenCalledTimes(1); // 재시도로 오분류되지 않음 — 핸들러 재실행 없음
    expect(dlq.sendToDLQ).not.toHaveBeenCalled(); // 바깥 인스턴스가 다시 DLQ 전송을 시도하지 않음
  });

  it('SchemaValidationError는 정책 무관 항상 nonRetryable (즉시 DLQ)', async () => {
    const { ctx } = makeKafkaContext();
    const impl = jest.fn().mockRejectedValue(new SchemaValidationError('bad payload', [], {}));

    await expect(run(TestConsumer.prototype.handleRetryable, nextFrom(impl), ctx)).resolves.toBeUndefined();
    expect(impl).toHaveBeenCalledTimes(1); // 재시도 없음
    expect(dlq.sendToDLQ).toHaveBeenCalledTimes(1);
  });
});
