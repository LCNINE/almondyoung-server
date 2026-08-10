/**
 * `EVENTS_CONSUMER_POLICY` 배선 — 선언한 값이 실제로 읽히는가, 그리고 두 번 선언하면
 * 부팅이 거부되는가 (플랜 Task 5-C · Task 7).
 *
 * ## 왜 따로 고정하는가
 *
 * 정책 선언은 이제 자리가 하나다 — `EventsModule.forApp({ policy })`. Task 7 이전에는
 * 둘이었다(`forConsumerModule({ validation })` 6개 앱 / 모듈 providers 직접 등록 1개 앱).
 * `forApp` 은 그 자리를 흡수하면서 **평범한 provider 하나**를 등록하므로, 이 스펙이 덮는
 * 모양이 곧 모든 앱의 모양이다.
 *
 * 이 배선이 끊길 때가 고약하다 — 토큰을 못 찾으면 `optionalGet` 이 `undefined` 를 반환하고
 * 기본값 `validateOnConsume: true` 가 먹는다. 즉 **배선이 끊겨도 5-C 이후에는 원하던 값과
 * 같아져서** 증상이 없다. 배선이 산 것과 죽은 것을 구별하려면 `false` 를 넣어 보는 수밖에 없고,
 * 그것이 아래 두 번째 케이스(대조군)다.
 *
 * 두 번 선언하는 경우도 같은 종류로 조용하다 — `optionalGet` 은 경고 없이 하나만 돌려주고
 * 어느 것이 이기는지는 모듈 등록 순서에 달렸다. `forApp` 은 BC 별로 여러 번 불릴 수 있어
 * (core 는 4번) 실제로 일어날 수 있는 실수이며, 그래서 세어서 거부한다.
 */
import 'reflect-metadata';
import { CallHandler, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { KafkaContext } from '@nestjs/microservices';
import type { Consumer, KafkaMessage, Producer } from '@nestjs/microservices/external/kafka.interface';
import { of } from 'rxjs';
import { z } from 'zod';
import { event, stream, SchemaValidationError } from '@packages/event-contracts/types';
import { EventsModule } from '../events.module';
import { SchemaValidationInterceptor } from '../interceptors/schema-validation.interceptor';
import {
  assertSinglePolicyDeclaration,
  buildConsumerInterceptors,
  EVENTS_CONSUMER_POLICY,
  type EventsConsumerPolicy,
} from './consumer-interceptors';

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

describe('EVENTS_CONSUMER_POLICY 를 provider 로 선언한 값이 실제로 읽힌다', () => {
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

describe('forApp({ policy }) 가 그 provider 를 등록한다', () => {
  const kafka = { clientId: 'policy-wiring-spec', brokers: ['unused:9092'] };

  /** DynamicModule 의 providers 는 넓게 타이핑돼 있어 좁혀서 찾는다. */
  const policyProviderOf = (moduleRef: { providers?: unknown[] }) =>
    (moduleRef.providers ?? []).find(
      (provider) => (provider as { provide?: unknown }).provide === EVENTS_CONSUMER_POLICY,
    ) as { useValue?: EventsConsumerPolicy } | undefined;

  it('선언한 정책이 그대로 provider 값이 된다', () => {
    const moduleRef = EventsModule.forApp({ kafka, policy: { validateOnConsume: false } });

    expect(policyProviderOf(moduleRef)?.useValue).toEqual({ validation: { validateOnConsume: false } });
  });

  it('대조군 — 선언하지 않으면 provider 자체가 없다 (기본값으로 떨어진다)', () => {
    const moduleRef = EventsModule.forApp({ kafka });

    expect(policyProviderOf(moduleRef)).toBeUndefined();
  });
});

describe('정책이 두 곳에서 선언되면 부팅을 거부한다', () => {
  const declaring = (validateOnConsume: boolean) => {
    @Module({
      providers: [
        {
          provide: EVENTS_CONSUMER_POLICY,
          useValue: { validation: { validateOnConsume } } satisfies EventsConsumerPolicy,
        },
      ],
      exports: [EVENTS_CONSUMER_POLICY],
    })
    class PolicyModule {}
    return PolicyModule;
  };

  it('두 모듈이 선언하면 어느 쪽이 이기는지 알 수 없으므로 던진다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [declaring(true), declaring(false)],
    }).compile();

    expect(() => assertSinglePolicyDeclaration(moduleRef)).toThrow(/2곳에서 선언됐다/);
    // 값이 에러에 실려야 어느 선언이 문제인지 볼 수 있다
    expect(() => assertSinglePolicyDeclaration(moduleRef)).toThrow(/validateOnConsume/);
  });

  it('대조군 — 하나면 통과한다', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [declaring(true)] }).compile();

    expect(() => assertSinglePolicyDeclaration(moduleRef)).not.toThrow();
  });

  it('대조군 — 0개도 통과한다 (기본값으로 떨어지는 정상 상태)', async () => {
    const moduleRef = await Test.createTestingModule({}).compile();

    expect(() => assertSinglePolicyDeclaration(moduleRef)).not.toThrow();
  });

  /**
   * 위 세 케이스는 함수를 직접 부른다 — 함수가 옳다는 것만 증명하고, 그것이 **부팅
   * 경로에 꽂혀 있다**는 것은 증명하지 않는다. `startConsumer` 가 인터셉터를 만드는
   * 유일한 지점이 `buildConsumerInterceptors` 이므로, 거기서 터지는지를 따로 건다.
   * 이 단언이 없으면 호출 한 줄을 지워도 위 셋은 그대로 초록이다.
   */
  it('부팅 경로(buildConsumerInterceptors)가 그 검사를 실제로 부른다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [declaring(true), declaring(false)],
    }).compile();

    expect(() => buildConsumerInterceptors(moduleRef, [POLICY_STREAM])).toThrow(/2곳에서 선언됐다/);
  });
});
