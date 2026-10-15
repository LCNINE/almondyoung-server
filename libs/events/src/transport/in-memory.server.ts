/**
 * In-Memory Consumer Strategy (테스트 전용)
 *
 * Nest 의 `CustomTransportStrategy` 로 붙는 소비 측 어댑터. 운영의 `ServerKafka`
 * 자리에 들어가며, **Nest 파이프라인(인터셉터·가드·파라미터 데코레이터·DI)은
 * 그대로 살아 있다.**
 *
 * 레코드 → 진짜 `KafkaContext` 조립(왜 진짜여야 하는지, 왜 `KafkaParser` 인지)은
 * `kafka-context.factory.ts` 참조.
 */

import { CustomTransportStrategy, Server } from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import { BrokerRecord, InMemoryBroker } from './in-memory.broker';
import { buildKafkaContext } from './kafka-context.factory';

export const IN_MEMORY_TRANSPORT = Symbol('IN_MEMORY_TRANSPORT');

export class InMemoryServer extends Server implements CustomTransportStrategy {
  transportId = IN_MEMORY_TRANSPORT;

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

    const { context, data } = buildKafkaContext(record, async () => {
      /* heartbeat — EventRetryInterceptor 가 backoff 중 호출한다 */
    });

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
