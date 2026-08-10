/**
 * `EVENTS_CONSUMER_POLICY` 를 **평범한 provider 로 선언한 모양**이 실제로 읽히는가 (플랜 Task 5-C).
 *
 * ## 왜 이것만 따로 고정하는가
 *
 * 정책을 선언하는 자리가 두 가지다:
 *
 * - `EventsModule.forConsumerModule({ validation })` — analytics · search · membership · core
 * - 모듈 providers 에 `EVENTS_CONSUMER_POLICY` 를 직접 등록 — **channel-adapter 뿐**
 *
 * 앞의 모양은 `transport/consume-validation.spec.ts` 가 실행으로 덮는다. 뒤의 모양은 5-B 가
 * 도입한 뒤로 **어느 스펙도 덮지 않았다.** channel-adapter 가 `forConsumerModule` 을 부르지
 * 않는 이유는 그 표면이 `streams` 를 필수로 받기 때문인데(그 목록이 이 워크스트림이 지우는 중인
 * 두 번째 진실이다), 그래서 이 앱만 다른 자리에 선언한다.
 *
 * 이 차이가 조용한 이유가 고약하다 — 토큰을 못 찾으면 `optionalGet` 이 `undefined` 를 반환하고
 * 기본값 `validateOnConsume: true` 가 먹는다. 즉 **배선이 끊겨도 5-C 이후에는 원하던 값과
 * 같아져서** 증상이 없다. 배선이 산 것과 죽은 것을 구별하려면 `false` 를 넣어 보는 수밖에 없고,
 * 그것이 아래 두 번째 케이스(대조군)다.
 */
import 'reflect-metadata';
import { CallHandler } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { KafkaContext } from '@nestjs/microservices';
import type { Consumer, KafkaMessage, Producer } from '@nestjs/microservices/external/kafka.interface';
import { of } from 'rxjs';
import { z } from 'zod';
import { event, stream, SchemaValidationError } from '@packages/event-contracts/types';
import { SchemaValidationInterceptor } from '../interceptors/schema-validation.interceptor';
import { buildConsumerInterceptors, EVENTS_CONSUMER_POLICY, type EventsConsumerPolicy } from './consumer-interceptors';

const POLICY_STREAM = stream({
  topic: 'policy-wiring.events.v1',
  partitions: 1,
  aggregateType: 'PolicyWiring',
  events: {
    Placed: event('Placed', z.object({ orderId: z.string().min(1) })),
  },
});

/** 계약이 `orderId: string` 을 요구하는데 숫자를 싣는다 — 검증이 켜져 있으면 반드시 걸린다. */
const VIOLATING_ENVELOPE = {
  messageType: 'Placed',
  messageId: 'mid-1',
  source: { aggregateId: 'agg-1' },
  payload: { orderId: 12345 },
};

function rpcContextWithViolatingMessage(): ExecutionContextHost {
  const message = {
    value: Buffer.from(JSON.stringify(VIOLATING_ENVELOPE)),
    offset: '1',
    headers: {},
  } as unknown as KafkaMessage;

  const kafkaCtx = new KafkaContext([
    message,
    0,
    POLICY_STREAM.topic.topic,
    {} as unknown as Consumer,
    jest.fn(),
    {} as unknown as Producer,
  ]);

  // RpcContextCreator 가 만드는 형태 그대로: args = [data, context]
  const host = new ExecutionContextHost([{}, kafkaCtx], class Consumer {}, function handler() {});
  host.setType('rpc');
  return host;
}

/**
 * 앱 모듈이 정책을 어떻게 선언하든, `startConsumer` 는 결국 이 함수로 인터셉터를 만든다.
 * 그래서 여기서 컨테이너를 세우고 이 함수를 부르는 것이 실제 경로다.
 */
async function schemaInterceptorFor(policyProvider?: EventsConsumerPolicy): Promise<SchemaValidationInterceptor> {
  const moduleRef = await Test.createTestingModule({
    providers: policyProvider ? [{ provide: EVENTS_CONSUMER_POLICY, useValue: policyProvider }] : [],
  }).compile();

  const interceptors = buildConsumerInterceptors(moduleRef, [POLICY_STREAM]);
  const schema = interceptors.find((i): i is SchemaValidationInterceptor => i instanceof SchemaValidationInterceptor);
  if (!schema) throw new Error('SchemaValidationInterceptor 가 배선되지 않았다');
  return schema;
}

const nextThatSucceeds: CallHandler = { handle: () => of('handled') };

describe('EVENTS_CONSUMER_POLICY 를 평범한 provider 로 선언하는 모양 (channel-adapter)', () => {
  it('`validateOnConsume: true` 를 그 자리에서 읽는다 — 위반 메시지가 거부된다', async () => {
    const interceptor = await schemaInterceptorFor({ validation: { validateOnConsume: true } });

    expect(() => interceptor.intercept(rpcContextWithViolatingMessage(), nextThatSucceeds)).toThrow(
      SchemaValidationError,
    );
  });

  it('대조군 — `false` 를 넣으면 같은 메시지가 통과한다 (배선이 실제로 살아 있다는 증거)', async () => {
    const interceptor = await schemaInterceptorFor({ validation: { validateOnConsume: false } });

    // 이 케이스가 없으면 위 테스트는 "기본값이 true 라서" 초록일 수도 있다 — 그러면
    // provider 를 읽었는지 아닌지를 아무것도 증명하지 못한다.
    expect(() => interceptor.intercept(rpcContextWithViolatingMessage(), nextThatSucceeds)).not.toThrow();
  });

  it('토큰이 아예 없으면 기본값 `true` 로 떨어진다 — 5-B 가 경고한 "누락으로 켜짐"', async () => {
    const interceptor = await schemaInterceptorFor(undefined);

    expect(() => interceptor.intercept(rpcContextWithViolatingMessage(), nextThatSucceeds)).toThrow(
      SchemaValidationError,
    );
  });
});
