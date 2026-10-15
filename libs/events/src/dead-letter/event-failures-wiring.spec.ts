import { Controller, Global, INestApplication, Module, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { OutboxDispatcher } from '../outbox/outbox-dispatcher.service';
import { EventsModule } from '../events.module';
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

/**
 * 앱에서는 `DbModule`(전역)과 `EventsModule.forApp({ enableOutbox: true })` 가 주는 것들. 이 스펙은 배선만 보므로
 * 껍데기로 채운다. `OutboxDispatcher` 는 Task 9 의 `OutboxFailuresService` 가 요구한다 — 지금 넣어 두면 Task 9 에서 이 스펙이 깨지지 않는다.
 */
@Global()
@Module({
  providers: [
    { provide: DbService, useValue: { db: {} } },
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

  beforeEach(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    recorded.length = 0;
    broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [
        FakeInfraModule,
        EventsModule.forApp({
          publishes: [CART_STREAM],
          serviceName: 'wiring-spec',
          kafka: { clientId: 'w', brokers: ['unused:9092'] },
        }),
        EventFailuresModule,
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
      groupId: 'wiring-group',
      kafka: { clientId: 'w', brokers: ['unused:9092'] },
      strategy: new InMemoryServer(broker),
    });
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('startConsumer 가 런타임에 그룹을 붙인다 — groupId 정본은 startConsumer 인자 하나', () => {
    expect(app.get(DeadLetterRuntime).consumerGroup).toBe('wiring-group');
  });

  it('실패가 .dlq 토픽이 아니라 store 로 가고, 그룹·핸들러가 채워진다', async () => {
    await app.get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC)).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-9',
      payload: { id: 'cart-9', customerId: 'c', regionId: 'r', createdAt: new Date().toISOString() },
    });

    expect(recorded.map((m) => [m.consumerGroup, m.handler, m.sequenceKey])).toEqual([
      ['wiring-group', 'FailingConsumer.onCreated', 'cart-9'],
    ]);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
  });
});
