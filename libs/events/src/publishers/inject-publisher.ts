/**
 * 계약에서 도출하는 Publisher 주입 (ADR-0029 §4)
 *
 * 옛 표면(`@InjectStreamPublisher`, Task 7 에서 삭제)은 같은 사실을 두 번 적게 만들었다 —
 * 토큰을 생문자열로, 이벤트 타입을 제네릭으로. 둘 다 `ORDER_STREAM` 하나에서 나오는데,
 * 어긋나면 컴파일은 통과하고 런타임에 잘못된 publisher 가 주입되거나 DI 가 실패한다.
 * `@InjectPublisher(ORDER_STREAM)` + `PublisherFor<typeof ORDER_STREAM>` 은 두 사실을
 * 하나로 줄인다. 데코레이터 스트림 ≡ 타입 파라미터 스트림 은 타입으로 막을 수 없어
 * `npm run audit:event-publishers` 가 AST 로 단언한다.
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
 * `forApp({ publishes })` 에 그 스트림이 들어 있으면 provider 는 이미 존재한다 —
 * 토큰 형식의 소유자는 `publisher-token.ts` 한 곳이다.
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
