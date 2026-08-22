/**
 * 발행 → 소비 왕복 하네스 (ADR-0029 §7, 플랜 Task 2)
 *
 * 브로커 없이 한 프로세스 안에서 `StreamPublisher.publishEvent` 부터 `@On`
 * 핸들러 호출까지를 검증한다. **Nest 파이프라인은 실물이다** — `EventsModule` 을
 * 실제로 import 하고, 인터셉터·가드·파라미터 데코레이터·DI 가 모두 살아 있으며,
 * 바뀐 것은 `EVENT_TRANSPORT` 바인딩과 소비 전략뿐이다.
 *
 * 이 하네스가 없던 동안 옛 `forConsumer({streams})` 가 무효라는 사실이 아무 테스트에도
 * 걸리지 않았고, 그래서 2026-08-08 아키텍처 리뷰가 오판했다.
 */

import { Controller, INestMicroservice, Inject, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { z } from 'zod';
import { event, getDLQTopicName, stream } from '@packages/event-contracts/types';
import type { DLQMessage } from '../dlq/dlq.types';
import { EventsModule } from '../events.module';
import { EventPayload, On } from '../consumers/decorators';
import { buildConsumerInterceptors } from '../consumers/consumer-interceptors';
import { EventTypeGuard } from '../guards/event-type.guard';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EventChainService } from '../tracking/event-chain.service';
import { EVENT_TRANSPORT } from './transport.port';
import { InMemoryBroker } from './in-memory.broker';
import { InMemoryTransport } from './in-memory.transport';
import { InMemoryServer } from './in-memory.server';

// ===== 하네스 전용 계약 =====
// 실제 스트림을 쓰지 않는다 — 계약이 바뀌었다고 이 하네스가 깨지면 안 되고,
// `streams/index.ts` 밖이라 Task 1 의 STREAM_REGISTRY 에도 영향이 없다.

const OrderCreatedSchema = z.object({
  orderId: z.string(),
  amount: z.number().int().positive(),
});
type OrderCreatedPayload = z.infer<typeof OrderCreatedSchema>;

const HARNESS_STREAM = stream({
  topic: 'harness.events.v1',
  partitions: 1,
  aggregateType: 'Harness',
  events: {
    OrderCreated: event('OrderCreated', OrderCreatedSchema),
    OrderCancelled: event<'OrderCancelled', { orderId: string }>('OrderCancelled'),
    OrderShipped: event<'OrderShipped', { orderId: string }>('OrderShipped'),
    // 컨슈머가 **소비하면서 발행하는** 경로 전용 (#612). 다른 이벤트에 이 역할을 겸하게
    // 하면 기존 스펙의 `calls` 기대값이 함께 흔들린다.
    OrderRefunded: event<'OrderRefunded', { orderId: string }>('OrderRefunded'),
  },
});

const StrictSchema = z.object({ userId: z.string(), age: z.number() });

const STRICT_STREAM = stream({
  topic: 'harness.strict.v1',
  partitions: 1,
  aggregateType: 'Strict',
  events: {
    StrictEvent: event('StrictEvent', StrictSchema),
  },
});

// ===== 관찰 기록 =====

interface HandlerCall {
  handler: string;
  payload: unknown;
  chainId?: string;
}

const calls: HandlerCall[] = [];

@Controller()
@UseInterceptors(EventTypeGuard)
class HarnessConsumer {
  // 생성자 주입이 하네스에서도 살아 있어야 한다 — 클로저 기반 핸들러였다면 잃었을 것
  constructor(
    private readonly chain: EventChainService,
    @Inject(EventsModule.getPublisherToken(HARNESS_STREAM.topic.topic))
    private readonly publisher: StreamPublisher<typeof HARNESS_STREAM.events>,
  ) {}

  @On(HARNESS_STREAM, 'OrderCreated')
  onCreated(@EventPayload() payload: OrderCreatedPayload): void {
    calls.push({ handler: 'onCreated', payload, chainId: this.chain.getChainId() });
  }

  @On(HARNESS_STREAM, 'OrderCancelled')
  onCancelled(@EventPayload() payload: unknown): void {
    calls.push({ handler: 'onCancelled', payload });
  }

  @On(HARNESS_STREAM, 'OrderShipped')
  onShipped(@EventPayload() payload: unknown): void {
    calls.push({ handler: 'onShipped', payload, chainId: this.chain.getChainId() });
  }

  /**
   * 소비하면서 발행하는 핸들러 — #612 가 끊었던 바로 그 자리다.
   * 운영에서는 `apps/wallet/src/consumers/billing-charge.consumer.ts` 가 같은 모양이다.
   */
  @On(HARNESS_STREAM, 'OrderRefunded')
  async onRefunded(@EventPayload() payload: { orderId: string }): Promise<void> {
    calls.push({ handler: 'onRefunded', payload, chainId: this.chain.getChainId() });
    await this.publisher.publishEvent({
      eventType: 'OrderShipped',
      aggregateId: payload.orderId,
      payload: { orderId: payload.orderId },
    });
  }
}

@Controller()
@UseInterceptors(EventTypeGuard)
class StrictConsumer {
  @On(STRICT_STREAM, 'StrictEvent')
  onStrict(@EventPayload() payload: unknown): void {
    calls.push({ handler: 'onStrict', payload });
  }
}

describe('발행 → 소비 왕복 (인메모리 transport)', () => {
  let app: INestMicroservice;
  let broker: InMemoryBroker;
  let publisher: StreamPublisher<typeof HARNESS_STREAM.events>;

  beforeAll(async () => {
    // 토픽 부트스트랩은 Kafka admin 에 붙는다 — 하네스에서는 꺼야 한다
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';

    broker = new InMemoryBroker();

    const kafka = { clientId: 'harness', brokers: ['unused:9092'] };

    const moduleRef = await Test.createTestingModule({
      imports: [EventsModule.forApp({ publishes: [HARNESS_STREAM, STRICT_STREAM], serviceName: 'harness', kafka })],
      controllers: [HarnessConsumer, StrictConsumer],
    })
      // 유일한 교체 지점 — 나머지 배선은 운영과 같다
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();

    app = moduleRef.createNestMicroservice({
      strategy: new InMemoryServer(broker),
      logger: false,
    });
    // 소비 인터셉터는 운영과 **같은 팩토리**로 만들어 얹는다 (ADR-0029 §8).
    // `startConsumer` 를 부르지 않는 이유는 하나뿐이다 — 그것은 계약 레지스트리에 없는
    // 토픽의 구독을 거부하는데, 이 하네스는 일부러 레지스트리 밖의 전용 계약을 쓴다.
    // 그래서 도출 대신 스트림을 손으로 주되, 인터셉터 구성 자체는 `buildConsumerInterceptors`
    // 한 곳에서 가져온다. 옛 `forConsumerModule` 의 `APP_INTERCEPTOR` 등록에 기대던 코드였는데,
    // 그 등록은 **운영 하이브리드 앱에서는 소비 경로에 닿은 적이 없다** — 즉 이 하네스는
    // 여태 운영과 다른 배선을 검증하고 있었다.
    app.useGlobalInterceptors(...buildConsumerInterceptors(app, [HARNESS_STREAM, STRICT_STREAM]));
    await app.listen();

    publisher = app.get(EventsModule.getPublisherToken(HARNESS_STREAM.topic.topic));
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    calls.length = 0;
    broker.reset();
  });

  it('publishEvent 가 @On 핸들러까지 도달하고 payload 가 보존된다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: 'order-1',
      payload: { orderId: 'order-1', amount: 12_000 },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      handler: 'onCreated',
      payload: { orderId: 'order-1', amount: 12_000 },
    });

    // 발행 로그도 관찰 가능해야 한다
    const published = broker.envelopesOn(HARNESS_STREAM.topic.topic);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      messageType: 'OrderCreated',
      messageKind: 'event',
      source: { service: 'harness', aggregateType: 'Harness', aggregateId: 'order-1' },
    });
  });

  /**
   * #612 의 완료 판정. 오래 `it.failing` 으로 박혀 있던 자리다 — 소비 경로에 CLS 컨텍스트를
   * 여는 주체가 없어 `setChainId` 가 "No CLS context available" 로 던졌고, 그 예외를
   * `ChainContextInterceptor` 의 `catch` 가 삼켜 **완전 무증상**이었다.
   *
   * 이제 `buildConsumerInterceptors` 의 최외곽 `ClsInterceptor` 가 컨텍스트를 연다.
   */
  it('ChainContextInterceptor 가 envelope 의 chainId 를 CLS 로 전파한다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: 'order-3',
      payload: { orderId: 'order-3', amount: 500 },
    });

    const published = broker.envelopesOn(HARNESS_STREAM.topic.topic);
    expect(calls[0].chainId).toBeDefined();
    expect(calls[0].chainId).toBe(published[0].chainId);
  });

  /**
   * 소비 경로가 사슬을 **이어서 내보내는지** — #612 의 본체다.
   *
   * 인바운드 `OrderRefunded` 를 받은 핸들러가 그 안에서 `OrderShipped` 를 발행한다.
   * 고쳐지기 전에는 발행부가 CLS 를 못 읽어 후속 이벤트가 새 사슬을 팠다.
   */
  it('컨슈머 안에서 발행한 후속 이벤트가 인바운드 chainId 를 이어받는다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderRefunded',
      aggregateId: 'order-refund-1',
      payload: { orderId: 'order-refund-1' },
    });

    const published = broker.envelopesOn(HARNESS_STREAM.topic.topic);
    const inbound = published.find((e) => e.messageType === 'OrderRefunded');
    const outbound = published.find((e) => e.messageType === 'OrderShipped');

    expect(inbound?.chainId).toBeDefined();
    expect(outbound?.chainId).toBe(inbound?.chainId);

    // 사슬은 다음 홉의 핸들러까지 이어진다 — envelope 뿐 아니라 CLS 도 같은 값이어야 한다
    expect(calls.map((call) => call.handler)).toEqual(['onRefunded', 'onShipped']);
    expect(calls[1].chainId).toBe(inbound?.chainId);
  });

  /**
   * 발행부의 시딩 (#612). `getChainId() ?? v7()` 은 **심지 않았기 때문에** 한 컨텍스트
   * 안의 두 발행이 서로 다른 사슬을 받았다 — 소비 경계에서만 끊긴 게 아니라 애초에
   * 사슬이 시작되지 않았다는 뜻이다. HTTP 요청 하나가 이벤트 둘을 내보내는 경우가 이 모양이다.
   */
  it('한 CLS 컨텍스트 안의 두 발행은 같은 chainId 를 받는다', async () => {
    const cls = app.get(ClsService);

    await cls.run(async () => {
      await publisher.publishEvent({
        eventType: 'OrderCreated',
        aggregateId: 'order-seed-1',
        payload: { orderId: 'order-seed-1', amount: 100 },
      });
      await publisher.publishEvent({
        eventType: 'OrderCreated',
        aggregateId: 'order-seed-2',
        payload: { orderId: 'order-seed-2', amount: 200 },
      });
    });

    const published = broker.envelopesOn(HARNESS_STREAM.topic.topic);
    expect(published).toHaveLength(2);
    expect(published[0].chainId).toBeDefined();
    expect(published[1].chainId).toBe(published[0].chainId);
  });

  /**
   * 시딩의 경계 — CLS 컨텍스트가 없으면 심을 곳이 없다. 크론·부트스트랩 스크립트가 이쪽이다.
   * **던지지 않는 것**이 핵심이다. `cls.set` 이 컨텍스트 없이 던지는 것이 #612 의 무증상
   * 실패 경로였으므로, 그 예외를 발행 경로로 옮겨 심지 않았음을 여기서 고정한다.
   */
  it('CLS 컨텍스트 밖 발행은 던지지 않고 발행마다 새 사슬이 된다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: 'order-nocls-1',
      payload: { orderId: 'order-nocls-1', amount: 100 },
    });
    await publisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: 'order-nocls-2',
      payload: { orderId: 'order-nocls-2', amount: 200 },
    });

    const published = broker.envelopesOn(HARNESS_STREAM.topic.topic);
    expect(published[0].chainId).toBeDefined();
    expect(published[1].chainId).not.toBe(published[0].chainId);
  });

  it('EventTypeGuard 가 같은 토픽의 다중 핸들러 중 messageType 이 맞는 하나만 실행한다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderCancelled',
      aggregateId: 'order-2',
      payload: { orderId: 'order-2' },
    });

    // 세 핸들러 모두 같은 토픽에 걸려 있고 셋 다 파이프라인을 타지만,
    // messageType 이 다른 둘은 EventTypeGuard 가 조용히 버린다
    expect(calls.map((call) => call.handler)).toEqual(['onCancelled']);
  });

  it('스키마를 위반한 인바운드 메시지는 핸들러에 닿지 않고 DLQ 로 분류된다', async () => {
    // publisher 를 우회한다 — validateOnPublish 가 발행 단계에서 먼저 막기 때문이고,
    // 실제로도 스키마를 안 지키는 메시지는 *다른 서비스가* 보낸다
    await broker.inject(STRICT_STREAM.topic.topic, {
      messageId: 'msg-bad',
      messageType: 'StrictEvent',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-bad',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'other-service', aggregateType: 'Strict', aggregateId: 'user-1' },
      payload: { userId: 'user-1', age: 'not-a-number' }, // ← 스키마 위반
    });

    expect(calls).toHaveLength(0);

    const dlq = broker.envelopesOn<DLQMessage>(getDLQTopicName(STRICT_STREAM.topic.topic));
    expect(dlq).toHaveLength(1);
    expect(dlq[0].error.name).toBe('SchemaValidationError');
    expect(dlq[0].originalTopic).toBe(STRICT_STREAM.topic.topic);
    expect(dlq[0].originalMessage.messageId).toBe('msg-bad');

    // 소비 실패가 발행자에게 전파되지 않았음 — 운영에서도 그 둘은 분리돼 있다
    expect(broker.deliveryFailures).toHaveLength(0);
  });
});
