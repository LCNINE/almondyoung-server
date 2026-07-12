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
  listen(callback: () => void): void {
    callback();
  }
  close(): void {}
  on(): void {}
  unwrap<T>(): T {
    return undefined as T;
  }
}

const handlerCalls: unknown[] = [];

@Controller()
class WiringTestConsumer {
  @OnEvent('wiring.test.v1', 'WiringTested')
  @RetryPolicy({
    maxRetries: 1,
    backoff: 'fixed',
    initialDelayMs: 1,
    maxDelayMs: 1,
    nonRetryableErrors: [NotFoundException],
  })
  handleWiringTested(@EventPayload() payload: { poison: boolean }): Promise<void> {
    handlerCalls.push(payload);
    return Promise.reject(new NotFoundException('so not found'));
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
    const resultOrStream: unknown = await boundHandler!(envelope, kafkaContext);
    if (isObservable(resultOrStream)) {
      await lastValueFrom(resultOrStream, { defaultValue: undefined });
    }

    expect(handlerCalls).toHaveLength(1); // nonRetryable → 재시도 없음 (메타데이터가 실경로에서 읽혔다는 증거)
    expect(dlq.sendToDLQ).toHaveBeenCalledTimes(1);
    const contextMatcher: unknown = expect.objectContaining({ consumer: 'handleWiringTested' });
    expect(dlq.sendToDLQ).toHaveBeenCalledWith(
      expect.objectContaining({ originalTopic: 'wiring.test.v1', context: contextMatcher }),
    );
  });
});
