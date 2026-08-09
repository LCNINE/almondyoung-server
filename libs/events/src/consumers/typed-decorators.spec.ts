/**
 * 타입 도출 데코레이터 `@On` / `@InjectPublisher` (ADR-0029 §4, 플랜 Task 4)
 *
 * 증명해야 할 것이 둘이다:
 *
 * 1. **런타임이 옛 표면과 같다.** `@On` 은 `@OnEvent` 과 동일한 메타데이터를 남기고,
 *    `@InjectPublisher` 는 `@InjectStreamPublisher` 와 동일한 토큰을 만든다. 그래야
 *    앱별 이주(Task 5) 중 한 앱 안에서 두 표면이 섞여도 안전하다. 이건 Task 2 하네스로
 *    실제 발행→소비 왕복을 돌려서 확인한다 — 메타데이터만 비교하면 "같아 보인다"에서 끝난다.
 * 2. **타입이 계약에서 도출된다.** 잘못된 이벤트명·payload 는 컴파일 에러다.
 *    타입 단계 단언은 `@ts-expect-error` 로 하며, 그 검사는 `npm run type-check` 가 강제한다
 *    (불필요한 `@ts-expect-error` 는 그 자체가 에러라 단언이 썩으면 바로 드러난다).
 */

import { Controller, INestMicroservice, Injectable, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { event, stream } from '@packages/event-contracts/types';
import type { EnvelopeOf, EventPayloadOf } from '@packages/event-contracts/types';
import { EventsModule } from '../events.module';
import { EventEnvelope, EventPayload, On, OnEvent } from './decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { InjectPublisher, PublisherFor } from '../publishers/inject-publisher';
import { getPublisherToken } from '../publishers/publisher-token';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';

// ===== 하네스 전용 계약 =====
// 실제 스트림을 쓰지 않는다 — `streams/index.ts` 밖이므로 STREAM_REGISTRY 에도 영향이 없다.

const OrderCreatedSchema = z.object({
  orderId: z.string(),
  amount: z.number().int().positive(),
});

const TYPED_STREAM = stream({
  topic: 'harness.typed.v1',
  partitions: 1,
  aggregateType: 'TypedHarness',
  events: {
    OrderCreated: event('OrderCreated', OrderCreatedSchema),
    OrderCancelled: event<'OrderCancelled', { orderId: string; reason: string }>('OrderCancelled'),
  },
});

// ===== 관찰 기록 =====

interface HandlerCall {
  handler: string;
  payload: unknown;
  messageId: string;
}

const calls: HandlerCall[] = [];

@Controller()
@UseInterceptors(EventTypeGuard)
class TypedConsumer {
  /**
   * 토픽 문자열이 없다. 이벤트명은 계약의 키 집합으로 좁혀진다.
   * payload·envelope 주석도 손으로 쓴 타입이 아니라 계약에서 도출된다.
   */
  @On(TYPED_STREAM, 'OrderCreated')
  onCreated(
    @EventEnvelope() envelope: EnvelopeOf<typeof TYPED_STREAM, 'OrderCreated'>,
    @EventPayload() payload: EventPayloadOf<typeof TYPED_STREAM, 'OrderCreated'>,
  ): void {
    // payload 가 계약 타입이라는 것의 실증 — `.orderId`/`.amount` 가 타입에서 나온다
    calls.push({
      handler: 'onCreated',
      payload: { orderId: payload.orderId, amount: payload.amount },
      messageId: envelope.messageId,
    });
  }

  @On(TYPED_STREAM, 'OrderCancelled')
  onCancelled(
    @EventEnvelope() envelope: EnvelopeOf<typeof TYPED_STREAM, 'OrderCancelled'>,
    @EventPayload() payload: EventPayloadOf<typeof TYPED_STREAM, 'OrderCancelled'>,
  ): void {
    calls.push({
      handler: 'onCancelled',
      payload: { orderId: payload.orderId, reason: payload.reason },
      messageId: envelope.messageId,
    });
  }
}

/**
 * 생성자 주입도 계약 하나에서 나온다 — 토큰 문자열과 제네릭 두 사실이 하나로 줄었다.
 */
@Injectable()
class TypedOrderService {
  constructor(@InjectPublisher(TYPED_STREAM) private readonly orders: PublisherFor<typeof TYPED_STREAM>) {}

  async createOrder(orderId: string, amount: number): Promise<void> {
    await this.orders.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: orderId,
      payload: { orderId, amount },
    });
  }

  async cancelOrder(orderId: string, reason: string): Promise<void> {
    await this.orders.publishEvent({
      eventType: 'OrderCancelled',
      aggregateId: orderId,
      payload: { orderId, reason },
    });
  }
}

describe('@On / @InjectPublisher — 계약에서 도출하는 등록 표면', () => {
  let app: INestMicroservice;
  let broker: InMemoryBroker;
  let orders: TypedOrderService;

  beforeAll(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';

    broker = new InMemoryBroker();
    const kafka = { clientId: 'typed-harness', brokers: ['unused:9092'] };

    const moduleRef = await Test.createTestingModule({
      imports: [
        EventsModule.forRoot({ streams: [TYPED_STREAM], serviceName: 'typed-harness', kafka }),
        EventsModule.forConsumerModule({ streams: [TYPED_STREAM], groupId: 'typed-harness-consumer', kafka }),
      ],
      controllers: [TypedConsumer],
      providers: [TypedOrderService],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();

    app = moduleRef.createNestMicroservice({
      strategy: new InMemoryServer(broker),
      logger: false,
    });
    await app.listen();

    orders = app.get(TypedOrderService);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    calls.length = 0;
    broker.reset();
  });

  describe('런타임 동등성', () => {
    it('@InjectPublisher 로 주입한 publisher 가 @On 핸들러까지 왕복한다', async () => {
      await orders.createOrder('order-1', 12_000);

      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        handler: 'onCreated',
        payload: { orderId: 'order-1', amount: 12_000 },
      });
      expect(calls[0].messageId).toEqual(expect.any(String));

      const published = broker.envelopesOn(TYPED_STREAM.topic.topic);
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        messageType: 'OrderCreated',
        source: { service: 'typed-harness', aggregateType: 'TypedHarness', aggregateId: 'order-1' },
      });
    });

    it('EventTypeGuard 가 @On 의 eventType 메타데이터로도 그대로 필터링한다', async () => {
      await orders.cancelOrder('order-2', 'out-of-stock');

      // 두 핸들러가 같은 토픽에 걸려 있고 둘 다 파이프라인을 타지만 하나만 실행된다
      expect(calls.map((call) => call.handler)).toEqual(['onCancelled']);
      expect(calls[0].payload).toEqual({ orderId: 'order-2', reason: 'out-of-stock' });
    });

    it('@On 이 남기는 메타데이터가 @OnEvent 과 완전히 같다', () => {
      class ViaOn {
        @On(TYPED_STREAM, 'OrderCreated')
        handle(): void {}
      }

      class ViaOnEvent {
        @OnEvent('harness.typed.v1', 'OrderCreated')
        handle(): void {}
      }

      // `proto.handle` 를 직접 읽으면 unbound-method 규칙에 걸린다. 여기서 원하는 것은
      // 호출이 아니라 메타데이터가 붙은 함수 객체 자체다.
      const handlerOf = (proto: object): object => Reflect.get(proto, 'handle') as object;

      const onHandler = handlerOf(ViaOn.prototype);
      const onEventHandler = handlerOf(ViaOnEvent.prototype);

      const onKeys = Reflect.getMetadataKeys(onHandler).sort();
      const onEventKeys = Reflect.getMetadataKeys(onEventHandler).sort();

      // 키 집합이 같아야 한다 — 하나라도 빠지면 Nest 의 바인딩이나 EventTypeGuard 가 갈라진다
      expect(onKeys).toEqual(onEventKeys);
      expect(onKeys.length).toBeGreaterThan(0);

      for (const key of onKeys) {
        expect(Reflect.getMetadata(key, onHandler)).toEqual(Reflect.getMetadata(key, onEventHandler));
      }
    });

    it('@InjectPublisher 의 토큰이 @InjectStreamPublisher 와 같다', () => {
      expect(getPublisherToken(TYPED_STREAM.topic.topic)).toBe(
        EventsModule.getPublisherToken(TYPED_STREAM.topic.topic),
      );

      // 같은 토큰이므로 계약으로 뽑은 publisher 와 문자열로 뽑은 publisher 가 같은 인스턴스다
      expect(app.get(getPublisherToken(TYPED_STREAM.topic.topic))).toBe(
        app.get(EventsModule.getPublisherToken('harness.typed.v1')),
      );
    });
  });

  describe('런타임 거부 — 타입을 우회한 호출', () => {
    it('계약에 없는 이벤트명은 데코레이터 평가(= 부팅) 시점에 던진다', () => {
      expect(() => On(TYPED_STREAM, 'NoSuchEvent' as never)).toThrow(/계약에 "NoSuchEvent" 이벤트가 없다/);
    });

    it('토픽이 없는 객체를 넘기면 던진다', () => {
      const notAStream = { events: { OrderCreated: {} }, aggregateType: 'X', topic: { topic: '' } };

      expect(() => On(notAStream as never, 'OrderCreated' as never)).toThrow(/스트림에 토픽이 없다/);
      expect(() => InjectPublisher(notAStream as never)).toThrow(/스트림에 토픽이 없다/);
    });
  });
});

/**
 * ===== 타입 단계 단언 =====
 *
 * 실행하지 않는다. 데코레이터를 평가하면 위의 런타임 가드가 던지기 때문이고,
 * 여기서 증명하려는 것은 런타임이 아니라 **컴파일 결과**다. `@ts-expect-error` 가
 * 붙은 줄이 실제로 에러가 아니게 되면 `npm run type-check` 가 "unused directive" 로
 * 실패하므로, 이 단언들은 썩어도 조용하지 않다.
 */
function compileTimeAssertions(): void {
  // 올바른 이벤트명은 통과한다
  On(TYPED_STREAM, 'OrderCreated');
  On(TYPED_STREAM, 'OrderCancelled');

  // @ts-expect-error — 계약에 없는 이벤트명은 EventKeysOf 로 걸러진다
  On(TYPED_STREAM, 'NoSuchEvent');

  // payload 타입이 계약에서 도출된다 (= any 가 아니다)
  const good: EventPayloadOf<typeof TYPED_STREAM, 'OrderCreated'> = { orderId: 'o-1', amount: 1 };
  void good;

  // @ts-expect-error — amount 는 number 이므로 문자열은 거부된다
  const wrongPayloadType: EventPayloadOf<typeof TYPED_STREAM, 'OrderCreated'> = { orderId: 'o-1', amount: '1' };
  void wrongPayloadType;

  // @ts-expect-error — OrderCancelled 의 payload 는 reason 을 요구한다 (이벤트별로 다른 타입)
  const wrongEventPayload: EventPayloadOf<typeof TYPED_STREAM, 'OrderCancelled'> = { orderId: 'o-1' };
  void wrongEventPayload;

  // envelope 타입도 도출된다
  const envelope: EnvelopeOf<typeof TYPED_STREAM, 'OrderCreated'> = undefined as never;
  const amount: number = envelope.payload.amount;
  void amount;

  // publisher 도 계약으로 좁혀진다
  const publisher: PublisherFor<typeof TYPED_STREAM> = undefined as never;
  void publisher.publishEvent({
    eventType: 'OrderCreated',
    aggregateId: 'o-1',
    payload: { orderId: 'o-1', amount: 1 },
  });

  void publisher.publishEvent({
    // @ts-expect-error — 계약에 없는 이벤트는 발행할 수 없다
    eventType: 'NoSuchEvent',
    aggregateId: 'o-1',
    payload: { orderId: 'o-1', amount: 1 },
  });
}

void compileTimeAssertions;
