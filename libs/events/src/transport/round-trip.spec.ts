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

import { Controller, INestMicroservice, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
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
  constructor(private readonly chain: EventChainService) {}

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
    calls.push({ handler: 'onShipped', payload });
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
   * ⚠️ 알려진 실재 결함 — 이 태스크 범위 밖이라 고치지 않고 실행 가능한 형태로 박아둔다.
   *
   * 소비 경로에서 `chainId` 가 CLS 로 전파되지 않는다. 원인은 파싱이 아니라
   * (그건 `parseEnvelope` 로 고쳤다) **CLS 컨텍스트가 아예 열리지 않는 것**이다:
   * `ClsModule.forRoot({ middleware: { mount: false } })` 이고 RPC 경로에
   * ClsGuard/ClsInterceptor 가 없어 `setChainId` 가
   * "No CLS context available" 로 던지며, `ChainContextInterceptor` 의
   * `catch {}` 가 그것을 삼킨다 (2026-08-09 실측).
   *
   * `it.failing` 이므로 **지금은 통과**하고, 누군가 CLS 배선을 고치면 이 테스트가
   * 실패해 "이제 고쳐졌으니 일반 `it` 으로 바꿔라"고 알린다.
   */
  it.failing('ChainContextInterceptor 가 envelope 의 chainId 를 CLS 로 전파한다', async () => {
    await publisher.publishEvent({
      eventType: 'OrderCreated',
      aggregateId: 'order-3',
      payload: { orderId: 'order-3', amount: 500 },
    });

    const published = broker.envelopesOn(HARNESS_STREAM.topic.topic);
    expect(calls[0].chainId).toBeDefined();
    expect(calls[0].chainId).toBe(published[0].chainId);
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
