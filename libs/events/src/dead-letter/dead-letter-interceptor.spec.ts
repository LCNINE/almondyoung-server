import { Controller, INestApplication, UseInterceptors } from '@nestjs/common';
import { BaseRpcExceptionFilter, NestMicroservice } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { EventsModule } from '../events.module';
import { testTenancyModule } from '../testing/tenancy';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { DisableDLQ, RetryPolicy } from '../retry/retry-policy.decorator';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';
import { buildConsumerInterceptors } from '../consumers/consumer-interceptors';
import { DEAD_LETTER_HEADERS, type DeadLetterMessage, type DeadLetterRecorder } from './dead-letter.types';

const TOPIC = CART_STREAM.topic.topic;

/** 메모리 recorder — SQL 은 Task 4 통합 스펙이 본다. 여기선 «인터셉터가 언제 무엇을 부르나»만 본다 */
class MemoryRecorder implements DeadLetterRecorder {
  rows: Array<DeadLetterMessage & { id: number; status: string; error?: string; errorName?: string }> = [];
  private nextId = 1;
  holdIfBlocked(m: DeadLetterMessage) {
    const blocked = this.rows.some(
      (r) => r.topic === m.topic && r.sequenceKey === m.sequenceKey && ['failed', 'held'].includes(r.status),
    );
    if (blocked && !this.rows.some((r) => r.handler === m.handler && r.messageId === m.messageId)) {
      this.rows.push({ ...m, id: this.nextId++, status: 'held' });
    }
    return Promise.resolve(blocked);
  }
  recordFailure(m: DeadLetterMessage, e: Error) {
    this.rows.push({ ...m, id: this.nextId++, status: 'failed', error: e.message, errorName: e.name });
    return Promise.resolve();
  }
  markRedriven(id: number) {
    this.rows.find((r) => r.id === id)!.status = 'redriven';
    return Promise.resolve();
  }
  recordRedriveFailure(id: number, e: Error) {
    const row = this.rows.find((r) => r.id === id)!;
    row.status = 'failed';
    row.error = e.message;
    return Promise.resolve();
  }
}

const calls: string[] = [];
let failCreated = false;

@Controller()
@UseInterceptors(EventTypeGuard)
class CartConsumer {
  @RetryPolicy({ maxRetries: 1, backoff: 'fixed', initialDelayMs: 1 })
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: { id: string }) {
    calls.push(`created:${payload.id}`);
    if (failCreated) throw new Error('created failed');
  }

  @On(CART_STREAM, 'CartUpdated')
  onUpdated(@EventPayload() payload: { id: string }) {
    calls.push(`updated:${payload.id}`);
  }
}

/** 같은 이벤트를 받는 두 번째 핸들러 — 다시 넣기가 이쪽을 건드리면 안 된다(Review Focus 2) */
@Controller()
@UseInterceptors(EventTypeGuard)
class CartAuditConsumer {
  @On(CART_STREAM, 'CartCreated')
  onCreatedAudit(@EventPayload() payload: { id: string }) {
    calls.push(`audit:${payload.id}`);
  }
}

const kafka = { clientId: 'dead-letter-interceptor-spec', brokers: ['unused:9092'] };
const cart = (id: string) => ({ id, customerId: 'c', regionId: 'r', createdAt: new Date().toISOString() });
// CartUpdated 는 스키마가 다르다 — 발행 검증(validateOnPublish)을 통과해야 소비 경로까지 닿는다
const cartUpdated = (id: string) => ({ id, items: [], total: 0, subtotal: 0, updatedAt: new Date().toISOString() });

describe('EventRetryInterceptor — dead letter 모드 (#1016 8번)', () => {
  let app: INestApplication;
  let broker: InMemoryBroker;
  let recorder: MemoryRecorder;
  let publisher: StreamPublisher<typeof CART_STREAM.events>;

  async function boot(sequencedTopics: string[]): Promise<void> {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    calls.length = 0;
    failCreated = false;
    broker = new InMemoryBroker();
    recorder = new MemoryRecorder();
    const moduleRef = await Test.createTestingModule({
      imports: [testTenancyModule(), EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'dl-spec', kafka })],
      controllers: [CartConsumer, CartAuditConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    const microservice = app.connectMicroservice(
      { strategy: new InMemoryServer(broker) },
      { deferInitialization: true },
    ) as NestMicroservice;
    microservice.useGlobalInterceptors(
      ...buildConsumerInterceptors(app, [CART_STREAM], { recorder, consumerGroup: 'spec-group', sequencedTopics }),
    );
    microservice.registerListeners();
    microservice.setIsInitialized(true);
    microservice.setIsInitHookCalled(true);
    await app.startAllMicroservices();
    await app.init();
    publisher = app.get(EventsModule.getPublisherToken(TOPIC));
  }

  beforeEach(async () => {
    await boot([TOPIC]);
  });

  afterEach(async () => {
    await app.close();
  });

  it('최종 실패를 recorder 에 적고 .dlq 토픽으로는 보내지 않는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });

    expect(recorder.rows.map((r) => [r.handler, r.status, r.sequenceKey])).toEqual([
      ['CartConsumer.onCreated', 'failed', 'cart-1'],
    ]);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
    expect(broker.deliveryFailures).toHaveLength(0);
  });

  it('같은 순서 키의 뒤 메시지는 핸들러를 부르지 않고 held 로 적는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    calls.length = 0;
    await publisher.publishEvent({ eventType: 'CartUpdated', aggregateId: 'cart-1', payload: cartUpdated('cart-1') });

    expect(calls).toEqual([]);
    expect(recorder.rows.map((r) => [r.handler, r.status])).toContainEqual(['CartConsumer.onUpdated', 'held']);
  });

  it('순서를 지키지 않는 토픽(sequencedTopics 밖)은 실패를 기록하되 뒤 메시지를 보류하지 않는다', async () => {
    await app.close();
    await boot([]);
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    calls.length = 0;
    await publisher.publishEvent({ eventType: 'CartUpdated', aggregateId: 'cart-1', payload: cartUpdated('cart-1') });

    expect(calls).toEqual(['updated:cart-1']);
    expect(recorder.rows.map((r) => [r.handler, r.status, r.sequenceKey])).toEqual([
      ['CartConsumer.onCreated', 'failed', 'cart-1'], // 순서 키는 표시용으로 남는다
    ]);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
  });

  it('이벤트 종류가 다른 핸들러는 보류 검사를 하지 않는다 — 가짜 held 가 생기지 않는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    await publisher.publishEvent({ eventType: 'CartUpdated', aggregateId: 'cart-1', payload: cartUpdated('cart-1') });

    // onUpdated 는 CartCreated 를 받지 않고, onCreated·onCreatedAudit 는 CartUpdated 를 받지 않는다
    const heldHandlers = recorder.rows.filter((r) => r.status === 'held').map((r) => r.handler);
    expect(heldHandlers).toEqual(['CartConsumer.onUpdated']);
  });

  it('스키마 위반 메시지는 받는 핸들러마다 failed 로 적히고 커밋된다 — 이벤트 종류가 다른 핸들러가 파티션을 막지 않는다', async () => {
    // 발행 경로는 validateOnPublish 로 막히므로, 정상 envelope 를 하나 얻어 payload 만 깨뜨려 «다른 서비스가 보낸» 것처럼 넣는다
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-0', payload: cart('cart-0') });
    const valid = broker.envelopesOn<{ messageId: string; source: { aggregateId: string }; payload: unknown }>(
      TOPIC,
    )[0];
    calls.length = 0;

    await broker.inject(
      TOPIC,
      { ...valid, messageId: 'invalid-1', source: { ...valid.source, aggregateId: 'cart-9' }, payload: { id: 123 } },
      { key: 'cart-9' },
    );

    // 이 토픽의 핸들러는 셋이다. CartCreated 를 받는 둘(onCreated·onCreatedAudit)은 각자 안쪽 스키마 검증에서
    // SchemaValidationError(재시도 불가)를 맞고 자기 이름으로 failed 행을 남긴다 — 같은 메시지라도 핸들러별로 결과가
    // 따로인 것이 행의 키(handler)다. onUpdated 는 이벤트 종류가 달라 아무것도 하지 않는다 — 예전엔 여기서
    // next.handle() 로 넘겨 바깥 스키마 검증 에러가 재시도망 밖으로 새어 메시지 전체가 영영 커밋되지 않았다.
    expect(calls).toEqual([]);
    expect(broker.deliveryFailures).toHaveLength(0);
    expect(recorder.rows.map((r) => [r.handler, r.status, r.errorName, r.sequenceKey]).sort()).toEqual([
      ['CartAuditConsumer.onCreatedAudit', 'failed', 'SchemaValidationError', 'cart-9'],
      ['CartConsumer.onCreated', 'failed', 'SchemaValidationError', 'cart-9'],
    ]);
  });

  it('기록이 실패하면 에러가 파이프라인을 탈출한다 — 커밋되지 않아 다시 온다', async () => {
    failCreated = true;
    // holdIfBlocked 는 통과시키고 recordFailure 에서 터지게 한다
    const recordFailure = jest.spyOn(recorder, 'recordFailure').mockRejectedValue(new Error('db down'));
    // 탈출한 에러는 Nest 의 RPC 예외 필터가 `{ status: 'error', message: 'Internal server error' }` 로 바꿔
    // 내보낸다 — `deliveryFailures` 로는 «탈출했다»만 보이고 무엇이 탈출했는지는 안 보인다. 필터가 받은 원본을 본다.
    // `mockRestore` 는 기록한 호출도 지우므로 그 전에 이름만 뽑아 둔다.
    const filterCatch = jest.spyOn(BaseRpcExceptionFilter.prototype, 'catch');
    let caughtNames: string[];
    try {
      await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    } finally {
      caughtNames = filterCatch.mock.calls.map((call) => {
        const error: unknown = call[0];
        return error instanceof Error ? error.name : typeof error;
      });
      recordFailure.mockRestore();
      filterCatch.mockRestore();
    }

    expect(broker.deliveryFailures).toHaveLength(1);
    expect(caughtNames).toContain('DlqDeliveryError');
    expect(recorder.rows).toEqual([]);
  });

  it('다시 넣기 헤더가 있으면 대상 핸들러만 한 번 돌리고 결과를 그 행에 적는다', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    const failed = recorder.rows[0];
    const envelope = broker.envelopesOn(TOPIC)[0];
    calls.length = 0;
    failCreated = false;

    await broker.inject(TOPIC, envelope, {
      key: 'cart-1',
      headers: { [DEAD_LETTER_HEADERS.id]: String(failed.id), [DEAD_LETTER_HEADERS.handler]: 'CartConsumer.onCreated' },
    });

    expect(calls).toEqual(['created:cart-1']); // audit 핸들러는 건드리지 않는다
    expect(recorder.rows[0].status).toBe('redriven');
  });

  it('다시 넣기는 재시도하지 않는다 — 실패하면 한 번 만에 그 행을 failed 로', async () => {
    failCreated = true;
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    const failed = recorder.rows[0];
    const envelope = broker.envelopesOn(TOPIC)[0];
    calls.length = 0;

    await broker.inject(TOPIC, envelope, {
      key: 'cart-1',
      headers: { [DEAD_LETTER_HEADERS.id]: String(failed.id), [DEAD_LETTER_HEADERS.handler]: 'CartConsumer.onCreated' },
    });

    expect(calls).toEqual(['created:cart-1']);
    expect(recorder.rows).toHaveLength(1);
    expect(recorder.rows[0].status).toBe('failed');
  });

  it('recorder 가 없으면 지금처럼 .dlq 토픽으로 보낸다 — 켜지 않은 앱은 바뀌지 않는다', async () => {
    await app.close();
    broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [testTenancyModule(), EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'dl-spec', kafka })],
      controllers: [CartConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await EventsModule.startConsumer(app, {
      tenancy: 'per-message',
      groupId: 'g',
      kafka,
      strategy: new InMemoryServer(broker),
    });
    await app.init();
    failCreated = true;
    await app
      .get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC))
      .publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });

    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(1);
  });
});

/** `@DisableDLQ` 는 «실패하면 버린다»는 선언이다 — 실패 테이블 모드에서도 기록하지 않는다 */
@Controller()
@UseInterceptors(EventTypeGuard)
class DiscardingConsumer {
  @DisableDLQ()
  @RetryPolicy({ maxRetries: 0 })
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: { id: string }) {
    calls.push(`discarding:${payload.id}`);
    throw new Error('discard me');
  }
}

describe('EventRetryInterceptor — dead letter 모드의 @DisableDLQ (#1016 7·8번 최종 리뷰 C3)', () => {
  let app: INestApplication;

  afterEach(async () => {
    await app.close();
  });

  it('최종 실패를 기록하지 않고 .dlq 로도 보내지 않으며 커밋한다 — 같은 키의 뒤 메시지도 막지 않는다', async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    calls.length = 0;
    const broker = new InMemoryBroker();
    const recorder = new MemoryRecorder();
    const moduleRef = await Test.createTestingModule({
      imports: [testTenancyModule(), EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'dl-spec', kafka })],
      controllers: [DiscardingConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    const microservice = app.connectMicroservice(
      { strategy: new InMemoryServer(broker) },
      { deferInitialization: true },
    ) as NestMicroservice;
    microservice.useGlobalInterceptors(
      ...buildConsumerInterceptors(app, [CART_STREAM], {
        recorder,
        consumerGroup: 'spec-group',
        sequencedTopics: [TOPIC],
      }),
    );
    microservice.registerListeners();
    microservice.setIsInitialized(true);
    microservice.setIsInitHookCalled(true);
    await app.startAllMicroservices();
    await app.init();
    const publisher = app.get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC));

    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });
    await publisher.publishEvent({ eventType: 'CartCreated', aggregateId: 'cart-1', payload: cart('cart-1') });

    expect(recorder.rows).toEqual([]);
    expect(calls).toEqual(['discarding:cart-1', 'discarding:cart-1']);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
    expect(broker.deliveryFailures).toHaveLength(0);
  });
});
