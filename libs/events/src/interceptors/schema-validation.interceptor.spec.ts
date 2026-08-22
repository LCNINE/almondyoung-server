/**
 * 소비 스키마 검증 인터셉터가 **HTTP 요청에는 손대지 않는다** (ADR-0029 §8, #611)
 *
 * ## 이 스펙이 잡는 고장
 *
 * `intercept()` 첫머리의 `context.getType() === 'http'` 조기 반환이 사라지거나, 이 인터셉터가
 * 다시 전역(`APP_INTERCEPTOR`)으로 등록되면 — notification 처럼 HTTP 서버와 Kafka 소비자를
 * 한 프로세스에 얹은 **하이브리드 앱의 모든 HTTP 엔드포인트가 500 으로 죽는다.**
 *
 * 조기 반환이 없으면 인터셉터는 HTTP 실행 컨텍스트를 `switchToRpc()` 로 읽는다. 그 자리에서
 * 돌아오는 것은 `KafkaContext` 가 아니라 응답 객체(Fastify reply / Express res)이고, 거기엔
 * `getTopic` 이 없다. 그 호출은 `try` 블록보다 **앞**에 있어 인터셉터가 스스로 삼키지도 못한다.
 *
 * ## 왜 실행으로 고정하는가
 *
 * 이건 가정이 아니라 실제로 났던 사고다. notification 은 2025-11-19 (`e52e252ad8`) 에 바로 이
 * 고장 때문에 `validateOnConsume: false` 를 넣었고, 주석에 "HTTP 요청과 충돌 방지"라고 적었다.
 * 가드는 이틀 뒤 (`8bdfdb0686`) 무관한 커밋에 묻어 들어왔지만 플래그는 9개월 동안 꺼진 채였다.
 *
 * 지금은 방어선이 두 겹이다 — `startConsumer` 가 마이크로서비스 스코프로만 붙이고(ADR-0029 §8),
 * 그 위에 이 가드가 있다. 바깥 겹이 먼저 무너져도 안쪽이 버티는지를 여기서 고정한다. 가드가
 * 지워져도 **지금 배선에서는 무증상**이라 — 소비 경로만 지나므로 — 리뷰로는 잡히지 않는다.
 *
 * 소비 검증 자체의 동작(통과·DLQ·재시도 안 함)은 `transport/consume-validation.spec.ts` 가 덮는다.
 */
import 'reflect-metadata';
import { CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { KafkaContext } from '@nestjs/microservices';
import type { Consumer, KafkaMessage, Producer } from '@nestjs/microservices/external/kafka.interface';
import { of } from 'rxjs';
import { z } from 'zod';
import { event, stream, SchemaValidationError } from '@packages/event-contracts/types';
import { SchemaValidationInterceptor } from './schema-validation.interceptor';

const HTTP_GUARD_STREAM = stream({
  topic: 'http-guard.events.v1',
  partitions: 1,
  aggregateType: 'HttpGuard',
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

/** 검증을 켠 인터셉터 — notification·wallet 이 `validateOnConsume: true` 를 선언했을 때의 모양. */
const interceptorWithValidationOn = () =>
  new SchemaValidationInterceptor(new Reflector(), [HTTP_GUARD_STREAM], { validateOnConsume: true });

/**
 * Fastify HTTP 요청 컨텍스트. notification 은 `FastifyAdapter` 로 뜬다.
 * Nest 의 HTTP 컨텍스트는 args = [request, reply] 이고, `switchToRpc().getContext()` 는 args[1] —
 * 즉 `getTopic` 이 없는 reply 를 돌려준다. 그것이 위 헤더가 말한 고장의 실체다.
 */
function fastifyHttpContext(): ExecutionContextHost {
  const request = { method: 'POST', url: '/notifications/send', body: { title: '주문이 접수되었습니다' } };
  const reply = { send: jest.fn(), status: jest.fn() };

  const host = new ExecutionContextHost([request, reply], class NotificationController {}, function send() {});
  host.setType('http');
  return host;
}

function kafkaContextWithViolatingMessage(): ExecutionContextHost {
  const message = {
    value: Buffer.from(JSON.stringify(VIOLATING_ENVELOPE)),
    offset: '1',
    headers: {},
  } as unknown as KafkaMessage;

  const kafkaCtx = new KafkaContext([
    message,
    0,
    HTTP_GUARD_STREAM.topic.topic,
    {} as unknown as Consumer,
    jest.fn(),
    {} as unknown as Producer,
  ]);

  // RpcContextCreator 가 만드는 형태 그대로: args = [data, context]
  const host = new ExecutionContextHost([{}, kafkaCtx], class Consumer {}, function handle() {});
  host.setType('rpc');
  return host;
}

describe('SchemaValidationInterceptor — HTTP 요청은 통과시킨다', () => {
  it('검증이 켜져 있어도 HTTP 요청은 핸들러에 그대로 도달한다', () => {
    const handler = jest.fn(() => of('컨트롤러 응답'));
    const next: CallHandler = { handle: handler };
    let emitted: unknown;

    interceptorWithValidationOn()
      .intercept(fastifyHttpContext(), next)
      .subscribe((value) => {
        emitted = value;
      });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(emitted).toBe('컨트롤러 응답');
  });

  it('대조군 — 같은 인터셉터가 Kafka 위반 메시지는 거부한다', () => {
    // 이 케이스가 없으면 위 테스트는 "검증이 애초에 꺼져 있어서" 초록일 수도 있다.
    // 그러면 HTTP 가드가 살아 있는지 아닌지를 아무것도 증명하지 못한다.
    const handler = jest.fn(() => of('핸들러 실행됨'));
    const next: CallHandler = { handle: handler };

    expect(() => interceptorWithValidationOn().intercept(kafkaContextWithViolatingMessage(), next)).toThrow(
      SchemaValidationError,
    );
    expect(handler).not.toHaveBeenCalled();
  });
});
