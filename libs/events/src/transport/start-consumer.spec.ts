/**
 * `startConsumer` 통합 스펙 (ADR-0029 §3·§8, 플랜 Task 3)
 *
 * Task 2 하네스 위에서 돌아간다 — `EventsModule` 은 실물이고, 바뀐 것은
 * `EVENT_TRANSPORT` 바인딩과 소비 전략뿐이다. 앱 배선을 **운영 순서 그대로** 따른다:
 * 컨테이너 생성 → `startConsumer` → `app.init()`. 그래야 초기화 훅 중복 같은
 * 순서 의존 결함이 여기서 드러난다.
 *
 * 계약은 실제 등록된 `CART_STREAM` 을 쓴다 — `startConsumer` 가 레지스트리에 없는
 * 토픽을 거부하므로 하네스 전용 가짜 스트림을 쓸 수 없고, 레지스트리 통합 자체가
 * 이 태스크의 검증 대상이기도 하다. 어느 앱도 이 토픽을 소비하지 않는다.
 */

import { Controller, Injectable, INestApplication, OnModuleInit, UseInterceptors } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { event, getDLQTopicName, stream } from '@packages/event-contracts/types';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import type { DLQMessage } from '../dlq/dlq.types';
import { EventsModule } from '../events.module';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from './transport.port';
import { InMemoryBroker } from './in-memory.broker';
import { InMemoryTransport } from './in-memory.transport';
import { InMemoryServer } from './in-memory.server';

const TOPIC = CART_STREAM.topic.topic;

/** 레지스트리에 없는 스트림 — 부팅 거부를 재현하는 데만 쓴다 */
const GHOST_STREAM = stream({
  topic: 'nobody.declared.this.v1',
  partitions: 1,
  aggregateType: 'Ghost',
  events: { Whatever: event<'Whatever', Record<string, never>>('Whatever') },
});

interface HandlerCall {
  handler: string;
  payload: unknown;
}

const calls: HandlerCall[] = [];
let moduleInitCount = 0;

@Injectable()
class InitCounter implements OnModuleInit {
  onModuleInit(): void {
    moduleInitCount += 1;
  }
}

@Controller()
@UseInterceptors(EventTypeGuard)
class CartConsumer {
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: unknown): void {
    calls.push({ handler: 'onCreated', payload });
  }

  @On(CART_STREAM, 'CartUpdated')
  onUpdated(@EventPayload() payload: unknown): void {
    calls.push({ handler: 'onUpdated', payload });
  }
}

@Controller()
class GhostConsumer {
  @On(GHOST_STREAM, 'Whatever')
  onGhost(): void {}
}

const kafka = { clientId: 'start-consumer-spec', brokers: ['unused:9092'] };

function validCartPayload(id: string) {
  return {
    id,
    customerId: 'cust-1',
    regionId: 'region-1',
    createdAt: new Date().toISOString(),
  };
}

async function buildModule(controllers: unknown[], broker: InMemoryBroker): Promise<TestingModule> {
  process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';

  return Test.createTestingModule({
    imports: [
      // 발행 능력만 선언한다. 소비 스트림·groupId 를 넘길 자리가 애초에 없다 —
      // 토픽은 `@On` 에서 도출되고 groupId 는 `startConsumer` 가 받는다 (ADR-0029 §3).
      EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'start-consumer-spec', kafka }),
    ],
    // as 정당화: Nest 의 `controllers` 는 `Type<any>[]` 를 받고, 이 헬퍼는 테스트마다
    // 다른 컨트롤러 묶음을 받기 위해 unknown[] 로 선언돼 있다.
    controllers: controllers as never[],
    providers: [InitCounter],
  })
    .overrideProvider(EVENT_TRANSPORT)
    .useValue(new InMemoryTransport(broker))
    .compile();
}

describe('startConsumer — 소비 집합 도출', () => {
  let app: INestApplication;
  let broker: InMemoryBroker;
  let publisher: StreamPublisher<typeof CART_STREAM.events>;

  beforeAll(async () => {
    broker = new InMemoryBroker();
    const moduleRef = await buildModule([CartConsumer], broker);

    app = moduleRef.createNestApplication({ logger: false });

    // 운영 main.ts 와 같은 순서 — connect 가 init 보다 먼저다
    const derived = await EventsModule.startConsumer(app, {
      groupId: 'spec-consumer',
      kafka,
      strategy: new InMemoryServer(broker),
    });
    await app.init();

    expect(derived.topics).toEqual([TOPIC]);
    expect(derived.streams).toEqual([CART_STREAM]);

    publisher = app.get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC));
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    calls.length = 0;
    broker.reset();
  });

  it('구독 목록을 아무 데도 선언하지 않았는데 메시지가 핸들러까지 도달한다', async () => {
    await publisher.publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-1',
      payload: validCartPayload('cart-1'),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ handler: 'onCreated', payload: { id: 'cart-1', customerId: 'cust-1' } });
  });

  it('EventTypeGuard 가 같은 토픽의 다중 핸들러 중 하나만 실행한다', async () => {
    await publisher.publishEvent({
      eventType: 'CartUpdated',
      aggregateId: 'cart-2',
      payload: {
        id: 'cart-2',
        items: [],
        total: 0,
        subtotal: 0,
        updatedAt: new Date().toISOString(),
      },
    });

    expect(calls.map((call) => call.handler)).toEqual(['onUpdated']);
  });

  /**
   * ADR-0029 §8 의 핵심 증거.
   *
   * 앱들이 쓰던 `app.connectMicroservice(opts)` 는 마이크로서비스에 **빈
   * ApplicationConfig** 를 주므로 `APP_INTERCEPTOR` 로 등록한 스키마 검증·재시도·DLQ
   * 인터셉터가 소비 경로에 하나도 붙지 않았다. `startConsumer` 는 그것을 고친다.
   *
   * 옛 배선을 실행 가능한 형태로 박아뒀던 `옛 앱 배선` describe 는 Task 7 에서 지웠다 —
   * 5-B 가 라이브에 배포돼 그 주장(“라이브는 여전히 옛 배선”)이 더는 참이 아니고,
   * `forConsumer` 자체도 사라졌다.
   */
  it('스키마를 위반한 인바운드 메시지는 핸들러에 닿지 않고 DLQ 로 분류된다', async () => {
    await broker.inject(TOPIC, {
      messageId: 'msg-bad',
      messageType: 'CartCreated',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-bad',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'other-service', aggregateType: 'Cart', aggregateId: 'cart-3' },
      payload: { id: 'cart-3' }, // ← customerId·regionId·createdAt 누락
    });

    expect(calls).toHaveLength(0);

    // DLQ 메시지가 **토픽에 걸린 핸들러 수만큼** 생긴다. 같은 토픽의 핸들러는
    // 전부 파이프라인을 타고 각자 검증에서 터지기 때문이다 — 알려진 현재 동작이며,
    // ADR-0029 §6("토픽당 한 번 파싱하고 타입으로 디스패치")이 이것을 없앤다.
    // 여기 2 가 1 로 바뀌면 그 작업이 끝났다는 뜻이다.
    const dlq = broker.envelopesOn<DLQMessage>(getDLQTopicName(TOPIC));
    expect(dlq).toHaveLength(2);
    expect(dlq.map((message) => message.error.name)).toEqual(['SchemaValidationError', 'SchemaValidationError']);
    expect(dlq[0].originalTopic).toBe(TOPIC);
    expect(broker.deliveryFailures).toHaveLength(0);
  });

  it('onModuleInit 을 두 번 부르지 않는다', () => {
    // deferInitialization 을 쓰면서 초기화 플래그를 세우지 않으면 마이크로서비스의
    // listen() 이 registerModules() 를 타 컨테이너 전체 훅이 재실행된다 (실측).
    expect(moduleInitCount).toBe(1);
  });
});

describe('startConsumer — 부팅 거부', () => {
  beforeEach(() => {
    moduleInitCount = 0;
  });

  it('@On 핸들러가 하나도 없으면 부팅을 거부한다', async () => {
    const broker = new InMemoryBroker();
    const moduleRef = await buildModule([], broker);
    const app = moduleRef.createNestApplication({ logger: false });

    await expect(
      EventsModule.startConsumer(app, { groupId: 'spec-consumer', kafka, strategy: new InMemoryServer(broker) }),
    ).rejects.toThrow(/controllers/);

    await app.close();
  });

  it('계약 레지스트리에 없는 토픽을 구독하려 하면 부팅을 거부한다', async () => {
    const broker = new InMemoryBroker();
    const moduleRef = await buildModule([GhostConsumer], broker);
    const app = moduleRef.createNestApplication({ logger: false });

    await expect(
      EventsModule.startConsumer(app, { groupId: 'spec-consumer', kafka, strategy: new InMemoryServer(broker) }),
    ).rejects.toThrow(/nobody\.declared\.this\.v1.*GhostConsumer\.onGhost/s);

    await app.close();
  });
});
