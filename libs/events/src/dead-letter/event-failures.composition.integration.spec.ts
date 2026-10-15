/**
 * 이벤트 실패 출구 — 진짜 부품을 전부 끼워서 (#1016 7·8번 최종 리뷰 C1)
 *
 * 각 부품의 스펙은 서로를 목으로 둔다(인터셉터 ↔ 메모리 recorder, redriver ↔ 가짜 서버). 이 스펙은 그 사이 이음매를 본다:
 * 진짜 `EventsModule.startConsumer`(인메모리 서버) → 진짜 인터셉터 → 진짜 `DeadLetterStore`(Postgres) → 진짜
 * `DeadLetterRedriver` → 런타임이 붙든 서버로 다시 넣기 → 인터셉터가 결과를 그 행에 적는다.
 *
 * 실행: `DATABASE_URL=…/core_sdd_1016 npx jest --runInBand --runTestsByPath libs/events/src/dead-letter/event-failures.composition.integration.spec.ts`
 * 이 스위트는 커밋한다 — 고유한 컨슈머 그룹의 행만 쓰고 그 그룹만 지운다(WHERE 없는 DELETE 금지, CLAUDE.md).
 */
import { Controller, Global, INestApplication, Module, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { and, eq, inArray } from 'drizzle-orm';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { getDLQTopicName } from '@packages/event-contracts/types';
import { DbService } from '@app/db';
import { EventsModule } from '../events.module';
import { EventPayload, On } from '../consumers/decorators';
import { EventTypeGuard } from '../guards/event-type.guard';
import { RetryPolicy } from '../retry/retry-policy.decorator';
import { StreamPublisher } from '../publishers/stream-publisher.service';
import { OutboxDispatcher } from '../outbox/outbox-dispatcher.service';
import { EVENT_TRANSPORT } from '../transport/transport.port';
import { InMemoryBroker } from '../transport/in-memory.broker';
import { InMemoryTransport } from '../transport/in-memory.transport';
import { InMemoryServer } from '../transport/in-memory.server';
import { EventFailuresModule } from './event-failures.module';
import { DeadLetterRedriver } from './dead-letter.redriver';
import { dead_letters, failure_actions } from './dead-letter.schema';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const TOPIC = CART_STREAM.topic.topic;
const GROUP = `event-failures-composition-${process.pid}-${Date.now()}`;
const kafka = { clientId: 'event-failures-composition', brokers: ['unused:9092'] };

/** 핸들러가 본 customerId 순서 */
const seen: string[] = [];
let failing = true;

/** 앱에서는 `DbModule`(전역)이 주는 것. `OutboxDispatcher` 는 `OutboxFailuresService` 의 의존일 뿐 이 스펙은 부르지 않는다 */
@Global()
@Module({
  providers: [
    { provide: DbService, useFactory: () => new DbService({ connectionString: DATABASE_URL as string }, {}) },
    { provide: OutboxDispatcher, useValue: {} },
  ],
  exports: [DbService, OutboxDispatcher],
})
class RealDbModule {}

@Controller()
@UseInterceptors(EventTypeGuard)
class OrderedConsumer {
  @RetryPolicy({ maxRetries: 0 })
  @On(CART_STREAM, 'CartCreated')
  onCreated(@EventPayload() payload: { customerId: string }) {
    seen.push(payload.customerId);
    if (failing) throw new Error(`down: ${payload.customerId}`);
  }
}

describeIfDb('이벤트 실패 출구 조립 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);
  let app: INestApplication;
  let broker: InMemoryBroker;
  let db: DbService['db'];

  beforeAll(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [
        RealDbModule,
        EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'composition-spec', kafka }),
        EventFailuresModule.forRoot({ sequencedTopics: [TOPIC] }),
      ],
      controllers: [OrderedConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await EventsModule.startConsumer(app, { groupId: GROUP, kafka, strategy: new InMemoryServer(broker) });
    await app.init();
    db = app.get<DbService>(DbService).db;
  });

  afterAll(async () => {
    const ids = (
      await db.select({ id: dead_letters.id }).from(dead_letters).where(eq(dead_letters.consumerGroup, GROUP))
    ).map((r) => r.id);
    if (ids.length > 0) {
      await db
        .delete(failure_actions)
        .where(and(eq(failure_actions.targetKind, 'dead_letter'), inArray(failure_actions.targetId, ids)));
    }
    await db.delete(dead_letters).where(eq(dead_letters.consumerGroup, GROUP));
    await app.close();
  });

  const publish = (customerId: string) =>
    app.get<StreamPublisher<typeof CART_STREAM.events>>(EventsModule.getPublisherToken(TOPIC)).publishEvent({
      eventType: 'CartCreated',
      aggregateId: 'cart-composition',
      payload: { id: 'cart-composition', customerId, regionId: 'r', createdAt: new Date().toISOString() },
    });

  const rows = () =>
    db
      .select({ id: dead_letters.id, status: dead_letters.status, handler: dead_letters.handler })
      .from(dead_letters)
      .where(eq(dead_letters.consumerGroup, GROUP))
      .orderBy(dead_letters.id);

  it('실패 → failed, 같은 키의 뒤 메시지 → held, 고친 뒤 다시 넣으면 둘 다 차례로 redriven', async () => {
    await publish('c1');
    await publish('c2');

    expect(seen).toEqual(['c1']); // c2 는 핸들러에 닿지 않고 보관됐다
    expect((await rows()).map((r) => [r.status, r.handler])).toEqual([
      ['failed', 'OrderedConsumer.onCreated'],
      ['held', 'OrderedConsumer.onCreated'],
    ]);
    expect(broker.messagesOn(getDLQTopicName(TOPIC))).toHaveLength(0);
    expect(broker.deliveryFailures).toHaveLength(0);

    failing = false;
    seen.length = 0;
    const [head] = await rows();
    const result = await app.get(DeadLetterRedriver).redrive(head.id, 'admin-composition');

    expect(result).toEqual({ processed: 2, stoppedAt: null });
    expect(seen).toEqual(['c1', 'c2']);
    expect((await rows()).map((r) => r.status)).toEqual(['redriven', 'redriven']);
  });
});
