/**
 * 계약에서 도출하는 Publisher 주입 (ADR-0029 §4)
 *
 * 옛 표면은 같은 사실을 두 번 적게 만든다:
 *
 * ```ts
 * @InjectStreamPublisher('orders.events.v1') p: StreamPublisher<OrderEvents>
 * //                      ^^^^^^^^^^^^^^^^^ 토큰(문자열)     ^^^^^^^^^^^ 이벤트 타입(제네릭)
 * ```
 *
 * 둘 다 `ORDER_STREAM` 하나에서 나온다. 어긋나면 컴파일은 통과하고 런타임에
 * 잘못된 publisher 가 주입되거나 DI 가 실패한다. `@InjectPublisher(ORDER_STREAM)` +
 * `PublisherFor<typeof ORDER_STREAM>` 은 두 사실을 하나로 줄인다.
 */

import { Inject } from '@nestjs/common';
import type { StreamConfig, StreamEventTypes } from '@packages/event-contracts/types';
import type { StreamPublisher } from './stream-publisher.service';
import { getPublisherToken } from './publisher-token';

/**
 * 스트림 계약에서 도출한 `StreamPublisher` 타입.
 *
 * @example
 * constructor(
 *   @InjectPublisher(ORDER_STREAM) private readonly orders: PublisherFor<typeof ORDER_STREAM>,
 * ) {}
 */
export type PublisherFor<S extends StreamConfig<any>> =
  S extends StreamConfig<infer TEvents extends StreamEventTypes> ? StreamPublisher<TEvents> : never;

/**
 * 스트림 계약으로 publisher 를 주입한다. 토큰은 계약의 토픽에서 도출된다.
 *
 * 런타임 동작은 `@InjectStreamPublisher(topic)` 과 같다 — 같은 토큰을 만든다.
 * 따라서 한 앱 안에서 두 표면을 섞어 써도 되고, `forRoot({streams})` 에 그 스트림이
 * 들어 있기만 하면 provider 는 이미 존재한다.
 */
export function InjectPublisher<TEvents extends StreamEventTypes>(stream: StreamConfig<TEvents>) {
  const topic = stream?.topic?.topic;

  if (typeof topic !== 'string' || topic.length === 0) {
    throw new Error(
      `@InjectPublisher(): 스트림에 토픽이 없다 (${JSON.stringify(topic)}). ` +
        'packages/event-contracts 의 stream() 으로 만든 StreamConfig 를 넘겨야 한다.',
    );
  }

  return Inject(getPublisherToken(topic));
}
