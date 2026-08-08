/**
 * In-Memory Consumer Strategy (테스트 전용)
 *
 * Nest 의 `CustomTransportStrategy` 로 붙는 소비 측 어댑터. 운영의 `ServerKafka`
 * 자리에 들어가며, **Nest 파이프라인(인터셉터·가드·파라미터 데코레이터·DI)은
 * 그대로 살아 있다.**
 *
 * ## 왜 진짜 `KafkaContext` 를 만드는가
 *
 * `EventRetryInterceptor` 는 `instanceof KafkaContext` 로 게이트한다
 * (`interceptors/event-retry.interceptor.ts:72`). 손으로 만든 context 객체를
 * 넣으면 그 줄에서 빠져나가 **재시도·DLQ 분류가 통째로 건너뛰어진다** — 테스트는
 * 초록불이 뜨지만 아무것도 증명하지 못한다. `EventTypeGuard` 와
 * `SchemaValidationInterceptor` 도 같은 이유로 `KafkaContext` 를 요구한다.
 *
 * ## 왜 `KafkaParser` 를 재사용하는가
 *
 * Nest 는 수신 메시지의 `value` 를 그대로 넘기지 않고 `KafkaParser.decode` 로
 * **JSON 파싱해서** 넘긴다. 즉 운영에서 `getMessage().value` 는 Buffer 가 아니라
 * 객체다. 이 하네스가 Buffer 를 넘기면 운영과 다른 것을 테스트하게 되므로,
 * 흉내내지 않고 Nest 가 export 하는 파서를 그대로 쓴다.
 */

import { CustomTransportStrategy, KafkaContext, KafkaParser, Server } from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import { BrokerRecord, InMemoryBroker } from './in-memory.broker';

export const IN_MEMORY_TRANSPORT = Symbol('IN_MEMORY_TRANSPORT');

/**
 * `KafkaContext` 가 요구하지만 인메모리에서 의미가 없는 협력자들.
 *
 * as 정당화: Nest 의 `Consumer`/`Producer` 타입은 `@nestjs/microservices` 공개
 * 표면에 없고(내부 `external/kafka.interface`), 우리 코드 경로에서 실제로 쓰이는
 * 것은 `getHeartbeat()` 뿐이다. 나머지가 호출되면 조용히 통과하는 대신 즉시
 * 터지도록 Proxy 로 막아, 이 하네스가 무엇을 보장하지 *않는지*를 분명히 한다.
 */
function unsupportedCollaborator<T>(name: string): T {
  return new Proxy(
    {},
    {
      get(_target, property) {
        throw new Error(
          `InMemoryServer: KafkaContext.${name}().${String(property)} 는 인메모리 하네스가 제공하지 않는다. ` +
            `이 경로를 검증해야 한다면 실제 브로커가 필요하다.`,
        );
      },
    },
  ) as T;
}

export class InMemoryServer extends Server implements CustomTransportStrategy {
  transportId = IN_MEMORY_TRANSPORT;

  private readonly parser = new KafkaParser();
  private readonly statusListeners = new Map<string, unknown[]>();
  private unsubscribe?: () => void;

  constructor(private readonly broker: InMemoryBroker) {
    super();
  }

  listen(callback: (...optionalParams: unknown[]) => void): void {
    this.unsubscribe = this.broker.subscribe((record) => this.dispatch(record));
    callback();
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /**
   * 상태 이벤트 리스너 등록. 인메모리 어댑터는 상태 이벤트를 발화하지 않으므로
   * 보관만 한다.
   *
   * `Function` 을 쓰는 이유: 베이스 `Server<EventsMap = Record<string, Function>>` 가
   * `EventCallback extends EventsMap[EventKey]` 를 요구해, 더 좁은 시그니처로 좁히면
   * override 가 assignable 하지 않다(TS2416). 타입 규칙과 lint 규칙이 충돌하는
   * 자리이며 베이스 클래스 쪽을 따른다.
   */
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  on<EventKey extends string = string, EventCallback extends Function = Function>(
    event: EventKey,
    callback: EventCallback,
  ): void {
    const listeners = this.statusListeners.get(event) ?? [];
    listeners.push(callback);
    this.statusListeners.set(event, listeners);
  }

  unwrap<T>(): T {
    // as 정당화: `unwrap` 은 정의상 어댑터의 내부 구현체를 반환하며, 호출자가
    // 기대 타입을 지정한다. 인메모리 어댑터의 내부 구현체는 broker 다.
    return this.broker as T;
  }

  /**
   * `ServerKafka.handleMessage` → `handleEvent` 경로를 그대로 흉내낸다.
   *
   * 핸들러를 **한 번만** 부르는 것이 맞다 — 같은 토픽에 걸린 다중 핸들러 순회는
   * `ListenersController.forkJoinHandlersIfAttached` 가 `handlerRef.next` 를 타고
   * 수행하며, 이는 운영과 동일하다.
   */
  private async dispatch(record: BrokerRecord): Promise<void> {
    const handler = this.getHandlerByPattern(record.topic);
    if (!handler) {
      // 아무도 구독하지 않은 토픽 — Kafka 였다면 배달 자체가 없다
      return;
    }

    const rawMessage = this.parser.parse<Record<string, unknown>>({
      topic: record.topic,
      partition: record.partition,
      key: Buffer.from(record.key),
      value: Buffer.from(record.value),
      headers: Object.fromEntries(Object.entries(record.headers).map(([name, value]) => [name, Buffer.from(value)])),
      timestamp: record.timestamp,
      offset: record.offset,
      size: Buffer.byteLength(record.value),
      attributes: 0,
    });

    const context = new KafkaContext([
      // as 정당화: `parser.parse` 의 반환 타입은 입력 형태를 따라가는 제네릭이라
      // Nest 내부 `KafkaMessage` 로 좁혀지지 않는다. 형태는 위에서 그 인터페이스대로
      // 구성했고, 운영 경로(ServerKafka)도 같은 파서 결과를 그대로 싣는다.
      rawMessage as never,
      record.partition,
      record.topic,
      unsupportedCollaborator('getConsumer'),
      async () => {
        /* heartbeat — EventRetryInterceptor 가 backoff 중 호출한다 */
      },
      unsupportedCollaborator('getProducer'),
    ]);

    // KafkaRequestDeserializer.mapToSchema 와 동일: value 가 있으면 value, 없으면 메시지 전체
    const data = rawMessage.value ?? rawMessage;

    // 기본 훅은 `done()` 의 Promise 를 그대로 반환하지만 (`server.js:19`) Nest 타입은
    // 반환을 void 로 선언한다. 동기 배달을 보장해야 하므로 실제 반환을 확인해 기다린다.
    const settled: unknown = this.onProcessingStartHook(this.transportId, context, async () => {
      const resultOrStream: unknown = await handler(data, context);
      if (isObservable(resultOrStream)) {
        await lastValueFrom(resultOrStream, { defaultValue: undefined });
        this.onProcessingEndHook?.(this.transportId, context);
      }
    });
    if (settled instanceof Promise) {
      await settled;
    }
  }
}
