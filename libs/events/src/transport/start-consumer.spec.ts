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
import { getDLQTopicName } from '@packages/event-contracts/types';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import type { DLQMessage } from '../dlq/dlq.types';
import { EventsModule } from '../events.module';
import { EventPayload, OnEvent } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from './transport.port';
import { InMemoryBroker } from './in-memory.broker';
import { InMemoryTransport } from './in-memory.transport';
import { InMemoryServer } from './in-memory.server';

const TOPIC = CART_STREAM.topic.topic;

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
  @OnEvent('carts.events.v1', 'CartCreated')
  onCreated(@EventPayload() payload: unknown): void {
    calls.push({ handler: 'onCreated', payload });
  }

  @OnEvent('carts.events.v1', 'CartUpdated')
  onUpdated(@EventPayload() payload: unknown): void {
    calls.push({ handler: 'onUpdated', payload });
  }
}

@Controller()
class GhostConsumer {
  @OnEvent('nobody.declared.this.v1', 'Whatever')
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
      EventsModule.forRoot({ streams: [CART_STREAM], serviceName: 'start-consumer-spec', kafka }),
      // ⚠️ streams 를 넘기지만 startConsumer 는 이것을 쓰지 않는다 — 검증 맵은 도출된다.
      // 여기서 살아남는 것은 정책(validation)과 DLQ 설정뿐이다.
      EventsModule.forConsumerModule({ streams: [], groupId: 'spec-consumer', kafka }),
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
   * 인터셉터가 소비 경로에 하나도 붙지 않는다. 아래 `현재 앱 배선` describe 가 그
   * 상태를 실행 가능한 형태로 박아둔다. `startConsumer` 는 그것을 고친다.
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

  it('@OnEvent 핸들러가 하나도 없으면 부팅을 거부한다', async () => {
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

/**
 * 옛 배선의 상태를 실행 가능한 형태로 남긴다 (ADR-0029 §8).
 *
 * 이 describe 가 **초록이라는 사실 자체가 라이브 결함의 증거**다 — 스키마를 위반한
 * 메시지가 검증을 통과해 핸들러까지 간다.
 *
 * **삭제 시점: Task 5-B 가 배포된 뒤.** 코드상으로는 7개 앱이 모두 `startConsumer` 로
 * 이주했지만(`forConsumer` 호출 0건), 이 레포는 autodeploy 가 없어(ADR-0005 §4) 누군가
 * `sst deploy` 를 부르기 전까지 **라이브는 여전히 이 배선**이다. 즉 위 문장은 지금도
 * 참이다. 배포가 끝나 라이브에서 옛 배선이 사라지면 이 describe 는 그때 지운다 —
 * 그 전에 지우면 아직 살아 있는 결함의 유일한 실행 가능한 기록이 없어진다.
 * (`forConsumer` 자체의 제거는 Task 7.)
 */
describe('옛 앱 배선 (forConsumer + connectMicroservice) — 소비 인터셉터가 붙지 않는다', () => {
  it('스키마 위반 메시지가 검증 없이 핸들러까지 도달한다', async () => {
    const broker = new InMemoryBroker();
    const moduleRef = await buildModule([CartConsumer], broker);
    const app = moduleRef.createNestApplication({ logger: false });

    // 앱들이 실제로 하는 그대로 — 두 번째 인자 없음
    app.connectMicroservice({ strategy: new InMemoryServer(broker) });
    await app.startAllMicroservices();
    await app.init();

    calls.length = 0;
    await broker.inject(TOPIC, {
      messageId: 'msg-bad-legacy',
      messageType: 'CartCreated',
      messageVersion: 1,
      messageKind: 'event',
      correlationId: 'corr-bad-legacy',
      timestamp: new Date().toISOString(),
      occurredAt: new Date().toISOString(),
      source: { service: 'other-service', aggregateType: 'Cart', aggregateId: 'cart-9' },
      payload: { id: 'cart-9' },
    });

    expect(calls).toHaveLength(1); // ← 검증되지 않은 채 도착했다
    expect(broker.envelopesOn(getDLQTopicName(TOPIC))).toHaveLength(0);

    await app.close();
  });
});
