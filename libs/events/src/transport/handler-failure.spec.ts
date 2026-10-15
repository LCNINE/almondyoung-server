/**
 * 핸들러가 throw 하면 무슨 일이 일어나는가 — 옛 배선 vs `startConsumer` (플랜 Task 5-B 선행 확인)
 *
 * Task 5-B 는 앱 `main.ts` 를 `startConsumer` 로 옮기면서 `EventRetryInterceptor` 를
 * **처음으로** 소비 경로에 붙인다 (ADR-0029 §8). 그 전환의 before/after 를 말로만
 * 적어두면 다음 세션이 검증할 수 없으므로, 두 배선을 나란히 실행해 박아둔다.
 *
 * ## 운영에서 escape 한 에러가 어떻게 처리되는가 — 이 하네스가 흉내내지 *않는* 부분
 *
 * 기본 `Server.handleEvent`(`server.js:100-118`)는 Observable 을 구독만 하고 기다리지 않지만,
 * Kafka 경로의 `ServerKafka` 는 그 메서드를 덮어써 `lastValueFrom` 으로 기다린다
 * (`server-kafka.js:225-236`). 그래서 인터셉터를 탈출한 에러는 kafkajs `eachMessage` 까지 올라가고,
 * kafkajs 는 그 메시지를 resolve 하지 않은 채 재시도하다 컨슈머를 재시작한다. 커밋이 켜진 뒤(#1073)
 * 재시작한 컨슈머는 마지막 커밋 오프셋부터 다시 읽으므로 그 메시지를 다시 받는다. 커밋이 꺼져 있던
 * 동안에는 재시작이 최신으로 점프해 그 메시지와 뒤 메시지를 건너뛰었다.
 *
 * `InMemoryServer` 도 `lastValueFrom` 으로 기다리므로 에러가 `broker.deliveryFailures` 에 남는다 —
 * 그 배열이 «에러가 파이프라인을 탈출했다»의 관찰 창구다.
 *
 * 따라서 아래 두 describe 가 증명하는 것은 이것이다:
 * - 옛 배선: 에러가 파이프라인을 **탈출한다**. 재시도 0회 · DLQ 0건.
 * - `startConsumer`: 에러가 인터셉터에 **잡힌다**. 재시도 후 DLQ 적재, 그리고
 *   `EventRetryInterceptor` 가 에러를 삼켜 정상 완료시킨다(= offset commit).
 */

import { Controller, INestApplication, UseInterceptors } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import type { DLQMessage } from '../dlq/dlq.types';
import { EventsModule } from '../events.module';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { RetryPolicy } from '../retry/retry-policy.decorator';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from './transport.port';
import { InMemoryBroker } from './in-memory.broker';
import { InMemoryTransport } from './in-memory.transport';
import { InMemoryServer } from './in-memory.server';

const TOPIC = CART_STREAM.topic.topic;
const DLQ_TOPIC = getDLQTopicName(TOPIC);

/** 핸들러가 실제로 몇 번 실행됐는지 — 재시도가 실재하는지의 유일한 증거 */
let attempts = 0;
/** 던지기 직전에 본 payload — 파라미터 데코레이터까지 정상 통과했음을 확인한다 */
let lastPayload: unknown;

class HandlerBlewUp extends Error {
  constructor() {
    super('handler blew up');
    this.name = 'HandlerBlewUp';
  }
}

@Controller()
@UseInterceptors(EventTypeGuard)
class ExplodingConsumer {
  // 기본 정책은 3회 재시도 · exponential 1s/2s/4s = 7초. 여기서 확인할 것은
  // "재시도가 실재하는가"이지 backoff 곡선이 아니므로 짧게 줄인다.
  @RetryPolicy({ maxRetries: 2, backoff: 'fixed', initialDelayMs: 1 })
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: unknown): void {
    attempts += 1;
    lastPayload = payload;
    throw new HandlerBlewUp();
  }
}

const kafka = { clientId: 'handler-failure-spec', brokers: ['unused:9092'] };

function validCartPayload(id: string) {
  return {
    id,
    customerId: 'cust-1',
    regionId: 'region-1',
    createdAt: new Date().toISOString(),
  };
}

async function buildModule(broker: InMemoryBroker): Promise<TestingModule> {
  process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';

  return Test.createTestingModule({
    imports: [EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'handler-failure-spec', kafka })],
    controllers: [ExplodingConsumer],
  })
    .overrideProvider(EVENT_TRANSPORT)
    .useValue(new InMemoryTransport(broker))
    .compile();
}

function publisherOf(app: INestApplication): StreamPublisher<typeof CART_STREAM.events> {
  return app.get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC));
}

describe('핸들러 throw — 옛 배선 (forConsumer + connectMicroservice)', () => {
  let app: INestApplication;
  let broker: InMemoryBroker;

  beforeAll(async () => {
    broker = new InMemoryBroker();
    const moduleRef = await buildModule(broker);
    app = moduleRef.createNestApplication({ logger: false });

    // 앱들이 실제로 하던 그대로 — 두 번째 인자 없음 = 빈 ApplicationConfig
    app.connectMicroservice({ strategy: new InMemoryServer(broker) });
    await app.startAllMicroservices();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    attempts = 0;
    broker.reset();
  });

  it('재시도하지 않는다 — 핸들러는 정확히 한 번만 실행된다', async () => {
    await publisherOf(app).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-1',
      payload: validCartPayload('cart-1'),
    });

    expect(attempts).toBe(1);
  });

  it('DLQ 로 가지 않는다', async () => {
    await publisherOf(app).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-2',
      payload: validCartPayload('cart-2'),
    });

    expect(broker.envelopesOn(DLQ_TOPIC)).toHaveLength(0);
  });

  it('에러가 파이프라인을 탈출한다 (운영에서는 이 지점에 관찰 창구가 없다)', async () => {
    await publisherOf(app).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-3',
      payload: validCartPayload('cart-3'),
    });

    // 파일 상단 주석 참조: 운영의 `ServerKafka.handleEvent` 는 이 Observable 을 기다리므로,
    // 인터셉터를 탈출한 에러는 kafkajs `eachMessage` 까지 올라간다. 커밋이 켜진 뒤(#1073)에는
    // 재시작한 컨슈머가 그 메시지를 다시 받는다. 하네스는 같은 대기를 `lastValueFrom` 으로
    // 흉내내 에러를 `broker.deliveryFailures` 에 남기므로 여기서 보인다.
    expect(broker.deliveryFailures).toHaveLength(1);
  });
});

describe('핸들러 throw — startConsumer 배선', () => {
  let app: INestApplication;
  let broker: InMemoryBroker;

  beforeAll(async () => {
    broker = new InMemoryBroker();
    const moduleRef = await buildModule(broker);
    app = moduleRef.createNestApplication({ logger: false });

    await EventsModule.startConsumer(app, {
      groupId: 'spec-consumer',
      kafka,
      strategy: new InMemoryServer(broker),
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    attempts = 0;
    broker.reset();
  });

  it('@RetryPolicy 대로 재시도한다 — 초기 시도 1 + 재시도 2', async () => {
    await publisherOf(app).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-4',
      payload: validCartPayload('cart-4'),
    });

    expect(attempts).toBe(3);
    // 재시도는 핸들러를 처음부터 다시 부른다 — 파라미터 데코레이터도 매번 다시 푼다.
    // 이것이 "재시도가 실재하게 되면 핸들러가 멱등이어야 한다"의 근거다.
    expect(lastPayload).toMatchObject({ id: 'cart-4', customerId: 'cust-1' });
  });

  it('최종 실패는 DLQ 로 간다 — 원본 토픽·에러 이름이 보존된다', async () => {
    await publisherOf(app).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-5',
      payload: validCartPayload('cart-5'),
    });

    const dlq = broker.envelopesOn<DLQMessage>(DLQ_TOPIC);
    expect(dlq).toHaveLength(1);
    expect(dlq[0].originalTopic).toBe(TOPIC);
    expect(dlq[0].error.name).toBe('HandlerBlewUp');
    expect(dlq[0].context.retryCount).toBe(3);
  });

  it('DLQ 전송 후 에러를 삼킨다 — 정상 완료 = offset commit', async () => {
    await publisherOf(app).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-6',
      payload: validCartPayload('cart-6'),
    });

    // 에러가 파이프라인 밖으로 나오지 않는다. 운영에서는 이것이 곧 offset commit 이며,
    // 독약 메시지가 파티션을 막지 않는다는 뜻이다.
    expect(broker.deliveryFailures).toHaveLength(0);
  });
});
