/**
 * 소비 집합 도출 (ADR-0029 §3, 플랜 Task 3)
 *
 * 여기서 증명하는 것은 "선언 없이도 소비 집합을 정확히 알 수 있다" 하나다.
 * 도출이 틀리면 구독·검증·부트스트랩이 한꺼번에 틀어지므로, 경계 조건을 전부 건다.
 */

import { Controller, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { event, stream } from '@packages/event-contracts/types';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { ORDER_STREAM } from '@packages/event-contracts/streams/orders.stream';
import { On } from './decorators';
import { deriveConsumerConfig, discoverEventHandlers, type DiscoveredEventHandler } from './consumer-discovery';

/**
 * 레지스트리에 **없는** 스트림. `streams/index.ts` 가 export 하지 않으므로
 * `STREAM_REGISTRY` 에 들어가지 않고, 그래서 도출이 이것을 거부해야 한다.
 */
const GHOST_STREAM = stream({
  topic: 'nobody.declared.this.v1',
  partitions: 1,
  aggregateType: 'Ghost',
  events: { Whatever: event<'Whatever', Record<string, never>>('Whatever') },
});

@Controller()
class CartConsumer {
  @On(CART_STREAM, 'CartCreated')
  onCreated(): void {}

  @On(CART_STREAM, 'CartUpdated')
  onUpdated(): void {}

  /** 이벤트 핸들러가 아닌 메서드는 도출에 잡히면 안 된다 */
  helper(): void {}
}

@Controller()
class OrderConsumer {
  @On(ORDER_STREAM, 'OrderCreated')
  onOrderCreated(): void {}
}

/** 상속받은 핸들러도 구독된다 — Nest 의 MetadataScanner 가 프로토타입 체인을 탄다 */
class BaseConsumer {
  @On(ORDER_STREAM, 'OrderCancelled')
  onInherited(): void {}
}

@Controller()
class DerivedConsumer extends BaseConsumer {}

@Controller()
class UnregisteredTopicConsumer {
  @On(GHOST_STREAM, 'Whatever')
  onGhost(): void {}
}

/**
 * provider 에 붙인 `@On` 은 지금도 아무 일도 하지 않는다 —
 * Nest 의 `setupListeners` 가 `module.controllers` 만 순회하기 때문이다.
 * 도출도 같은 규칙을 따라야 한다. 안 그러면 "구독한다고 도출됐는데 실제로는
 * 안 오는" 토픽이 생겨, 이 ADR 이 없애려는 어긋남을 우리 손으로 다시 만든다.
 */
@Injectable()
class NotAController {
  @On(CART_STREAM, 'CartCreated')
  onCreated(): void {}
}

describe('discoverEventHandlers', () => {
  it('컨트롤러의 @On 에서 (topic, eventType) 집합을 도출한다', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CartConsumer, OrderConsumer],
    }).compile();

    const handlers = discoverEventHandlers(moduleRef);

    expect(handlers).toEqual(
      expect.arrayContaining([
        { topic: 'carts.events.v1', eventType: 'CartCreated', controller: 'CartConsumer', methodName: 'onCreated' },
        { topic: 'carts.events.v1', eventType: 'CartUpdated', controller: 'CartConsumer', methodName: 'onUpdated' },
        {
          topic: 'orders.events.v1',
          eventType: 'OrderCreated',
          controller: 'OrderConsumer',
          methodName: 'onOrderCreated',
        },
      ]),
    );
    expect(handlers).toHaveLength(3);
  });

  it('상속받은 핸들러도 도출한다', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [DerivedConsumer] }).compile();

    expect(discoverEventHandlers(moduleRef)).toEqual([
      {
        topic: 'orders.events.v1',
        eventType: 'OrderCancelled',
        controller: 'DerivedConsumer',
        methodName: 'onInherited',
      },
    ]);
  });

  it('provider 의 @On 은 도출하지 않는다 — Nest 도 바인딩하지 않는다', async () => {
    const moduleRef = await Test.createTestingModule({ providers: [NotAController] }).compile();

    expect(discoverEventHandlers(moduleRef)).toEqual([]);
  });

  it('컨트롤러가 없으면 빈 집합', async () => {
    const moduleRef = await Test.createTestingModule({}).compile();

    expect(discoverEventHandlers(moduleRef)).toEqual([]);
  });
});

describe('deriveConsumerConfig', () => {
  const handler = (topic: string, eventType: string): DiscoveredEventHandler => ({
    topic,
    eventType,
    controller: 'SomeConsumer',
    methodName: `on${eventType}`,
  });

  it('토픽을 중복 없이 모으고 계약을 레지스트리에서 찾는다', () => {
    const derived = deriveConsumerConfig([
      handler('carts.events.v1', 'CartCreated'),
      handler('carts.events.v1', 'CartUpdated'),
      handler('orders.events.v1', 'OrderCreated'),
    ]);

    expect(derived.topics).toEqual(['carts.events.v1', 'orders.events.v1']);
    expect(derived.streams).toEqual([CART_STREAM, ORDER_STREAM]);
    expect(derived.handlers).toHaveLength(3);
  });

  it('핸들러가 하나도 없으면 던진다 — 컨트롤러 미등록이 가장 조용한 실수였다', () => {
    expect(() => deriveConsumerConfig([])).toThrow(/controllers/);
  });

  it('레지스트리에 없는 토픽이면 어느 핸들러인지 지목하며 던진다', () => {
    expect(() => deriveConsumerConfig([handler('nobody.declared.this.v1', 'Whatever')])).toThrow(
      /nobody\.declared\.this\.v1.*SomeConsumer\.onWhatever/s,
    );
  });

  it('알 수 없는 토픽이 하나라도 있으면 나머지가 멀쩡해도 던진다', () => {
    expect(() =>
      deriveConsumerConfig([handler('carts.events.v1', 'CartCreated'), handler('nobody.declared.this.v1', 'Whatever')]),
    ).toThrow(/nobody\.declared\.this\.v1/);
  });
});

describe('도출 → 거부 (컨테이너 통합)', () => {
  it('레지스트리에 없는 토픽을 구독하는 컨트롤러가 있으면 도출 단계에서 막힌다', async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [UnregisteredTopicConsumer] }).compile();

    expect(() => deriveConsumerConfig(discoverEventHandlers(moduleRef))).toThrow(
      /nobody\.declared\.this\.v1.*UnregisteredTopicConsumer\.onGhost/s,
    );
  });
});
