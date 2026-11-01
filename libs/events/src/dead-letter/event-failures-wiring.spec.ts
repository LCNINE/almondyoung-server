import { Controller, Global, INestApplication, Module, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { singleDatabase } from '@app/db/testing/single-database';
import { OutboxDispatcher } from '../outbox/outbox-dispatcher.service';
import { EventsModule } from '../events.module';
import { testTenancyModule } from '../testing/tenancy';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { RetryPolicy } from '../retry/retry-policy.decorator';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';
import { EventFailuresModule } from './event-failures.module';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { DeadLetterStore } from './dead-letter.store';
import type { DeadLetterMessage } from './dead-letter.types';

const TOPIC = CART_STREAM.topic.topic;
const recorded: DeadLetterMessage[] = [];
/** `startConsumer` 의 테이블 확인 질의가 돌려줄 값. `'throws'` 면 질의 자체가 실패한다 */
let tables: boolean | 'throws' = true;

/**
 * 앱에서는 `DbModule`(전역)과 `EventsModule.forApp({ enableOutbox: true })` 가 주는 것들. 이 스펙은 배선만 보므로
 * 껍데기로 채운다. `execute` 는 `startConsumer` 의 테이블 확인(`checkDeadLetterTables`)만 부른다.
 */
@Global()
@Module({
  providers: [
    {
      provide: DbService,
      useValue: singleDatabase({
        db: {
          execute: () =>
            tables === 'throws'
              ? Promise.reject(new Error('relation does not exist'))
              : Promise.resolve([{ present: tables }]),
        },
      }),
    },
    { provide: OutboxDispatcher, useValue: {} },
  ],
  exports: [DbService, OutboxDispatcher],
})
class FakeInfraModule {}

@Controller()
@UseInterceptors(EventTypeGuard)
class FailingConsumer {
  @RetryPolicy({ maxRetries: 0 })
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() _p: unknown) {
    void _p;
    throw new Error('nope');
  }
}

describe('EventFailuresModule 배선 (#1016 8번)', () => {
  let app: INestApplication;
  let broker: InMemoryBroker;

  async function boot(): Promise<void> {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    recorded.length = 0;
    broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeInfraModule,
        testTenancyModule(),
        EventsModule.forApp({
          publishes: [CART_STREAM],
          serviceName: 'wiring-spec',
          kafka: { clientId: 'w', brokers: ['unused:9092'] },
        }),
        EventFailuresModule.forRoot({ sequencedTopics: [TOPIC] }),
      ],
      controllers: [FailingConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .overrideProvider(DeadLetterStore)
      .useValue({
        holdIfBlocked: () => Promise.resolve(false),
        recordFailure: (m: DeadLetterMessage) => {
          recorded.push(m);
          return Promise.resolve();
        },
        markRedriven: () => Promise.resolve(),
        recordRedriveFailure: () => Promise.resolve(),
      })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await EventsModule.startConsumer(app, {
      tenancy: 'per-message',
      groupId: 'wiring-group',
      kafka: { clientId: 'w', brokers: ['unused:9092'] },
      strategy: new InMemoryServer(broker),
    });
    await app.init();
  }

  function publishFailing() {
    return app.get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC)).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-9',
      payload: { id: 'cart-9', customerId: 'c', regionId: 'r', createdAt: new Date().toISOString() },
    });
  }

  beforeEach(async () => {
    tables = true;
    await boot();
  });

  afterEach(async () => {
    await app.close();
  });

  it('startConsumer 가 런타임에 그룹을 붙인다 — groupId 정본은 startConsumer 인자 하나', () => {
    expect(app.get(DeadLetterRuntime).consumerGroup).toBe('wiring-group');
  });

  it('실패가 .dlq 토픽이 아니라 store 로 가고, 그룹·핸들러가 채워진다', async () => {
    await publishFailing();

    expect(recorded.map((m) => [m.consumerGroup, m.handler, m.sequenceKey])).toEqual([
      ['wiring-group', 'FailingConsumer.onCreated', 'cart-9'],
    ]);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
  });

  // 마이그 없이 배포된 경우(#1016 7·8번 최종 리뷰 A). 켜면 보류 검사가 매 메시지 던져 모든 파티션이 멈춘다.
  describe.each([
    ['테이블이 없으면', false as const],
    ['확인 질의가 실패하면', 'throws' as const],
  ])('%s 실패 테이블 모드를 켜지 않는다 — 옛 .dlq 경로', (_label, state) => {
    beforeEach(async () => {
      await app.close();
      tables = state;
      await boot();
    });

    it('실패가 .dlq 토픽으로 가고 store 는 아무것도 받지 않는다', async () => {
      await publishFailing();
      expect(recorded).toEqual([]);
      expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(1);
      expect(broker.deliveryFailures).toHaveLength(0);
    });

    it('런타임이 붙지 않고, 그것을 쓰는 API 는 마이그를 말하며 거부한다', () => {
      const runtime = app.get(DeadLetterRuntime);
      expect(runtime.isAttached).toBe(false);
      expect(() => runtime.consumerGroup).toThrow(/add-event-dead-letters/);
    });
  });
});
