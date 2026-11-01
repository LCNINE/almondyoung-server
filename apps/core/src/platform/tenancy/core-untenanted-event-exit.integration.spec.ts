import { Controller, Global, INestApplication, Module, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { eq, sql as raw } from 'drizzle-orm';
import { join } from 'node:path';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { CART_STREAM } from '@packages/event-contracts/streams/cart.stream';
import { getDLQTopicName, type MessageEnvelope } from '@packages/event-contracts/types';
import { connectionStringFor, DbService } from '@app/db';
import { EventsModule, OutboxDispatcher } from '@app/events';
import { EventPayload, On } from '@app/events/consumers/decorators';
import { EventTypeGuard } from '@app/events/guards/event-type.guard';
import { RetryPolicy } from '@app/events/retry/retry-policy.decorator';
import { EVENT_TRANSPORT } from '@app/events/transport/transport.port';
import { InMemoryBroker } from '@app/events/transport/in-memory.broker';
import { InMemoryTransport } from '@app/events/transport/in-memory.transport';
import { InMemoryServer } from '@app/events/transport/in-memory.server';
import { EventFailuresModule } from '@app/events/dead-letter/event-failures.module';
import { DeadLetterRedriver } from '@app/events/dead-letter/dead-letter.redriver';
import { dead_letters } from '@app/events/dead-letter/dead-letter.schema';
import { deadLetterFromDlq } from '@app/events/dead-letter/dlq-import';
import { testTenancyModule } from '@app/events/testing/tenancy';
import { parseTenantList, TENANT_CONTEXT_KEY, TenancyConfig } from '@app/tenancy';
import { coreTenantDbRouter } from './core-tenant-db-router';

/**
 * ② core 의 테넌트 없는 이벤트 실패 출구 (ticket 30). 문 하나가 아니라 진짜 `startConsumer` 사슬 전체 —
 * CLS → 테넌트 문 → 재시도·보류·실패 테이블(진짜 `DeadLetterStore`) → 스키마 검증 → 핸들러 — 를 core 의 테넌트 라우터와
 * 실 Postgres 로 탄다. 순서 토픽으로 둬서 보류 검사도 탄다.
 *
 * 실행: `npm run test:core:integration:local -- core-untenanted-event-exit`
 * 스펙이 core 마이그를 마친 스크래치 DB 둘을 만들고 끝나면 지운다. 접속 정보는 DATABASE_URL 의 것을 쓴다(DB 이름만 바꾼다).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const DB_A = 'tenant_untenanted_exit_a';
const DB_B = 'tenant_untenanted_exit_b';
const TOPIC = CART_STREAM.topic.topic;
const DLQ_TOPIC = getDLQTopicName(TOPIC);
const GROUP = 'untenanted-exit-spec';
const HANDLER = 'ExitProbeConsumer.onCreated';
const kafka = { clientId: 'untenanted-exit-spec', brokers: ['unused:9092'] };

const tenants = parseTenantList(
  JSON.stringify([
    { id: 'a', slug: 'alpha', coreDb: DB_A, publicBucket: 'bucket-a', privateBucket: 'bucket-a' },
    { id: 'b', slug: 'beta', coreDb: DB_B, publicBucket: 'bucket-b-pub', privateBucket: 'bucket-b-priv' },
  ]),
);

const urlOf = (database: string): string => connectionStringFor(DATABASE_URL ?? '', database);

const cartCreated = (cartId: string, metadata?: Record<string, unknown>): MessageEnvelope => ({
  messageId: `m-${cartId}-${Math.random().toString(36).slice(2)}`,
  messageType: 'CartCreated',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: `c-${cartId}`,
  timestamp: '2026-11-02T00:00:00.000Z',
  source: { service: 'spec', aggregateType: 'Cart', aggregateId: 'cart-shared' },
  payload: { id: cartId, customerId: 'cust', regionId: 'reg', createdAt: '2026-11-02T00:00:00.000Z' },
  ...(metadata ? { metadata } : {}),
});

let dbService: DbService;

@Controller()
@UseInterceptors(EventTypeGuard)
class ExitProbeConsumer {
  @RetryPolicy({ maxRetries: 0 })
  @On(CART_STREAM, 'CartCreated')
  async onCreated(@EventPayload() payload: { id: string }) {
    // 맥락의 테넌트 DB 에 쓴다 — 어느 DB 에 닿았는지가 판정이다
    await dbService.db.execute(raw`INSERT INTO tenant_exit_probe (cart_id) VALUES (${payload.id})`);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DbService,
      useFactory: () => {
        const cls: ClsService = ClsServiceManager.getClsService();
        dbService = new DbService(
          { connectionString: urlOf('postgres') },
          {},
          coreTenantDbRouter(new TenancyConfig(tenants, 'reject'), cls),
        );
        return dbService;
      },
    },
    { provide: OutboxDispatcher, useValue: {} },
  ],
  exports: [DbService, OutboxDispatcher],
})
class RoutedDbModule {}

describeIfDb('② core 의 테넌트 없는 이벤트 실패 출구 (startConsumer 전체 사슬, 실 Postgres)', () => {
  jest.setTimeout(180_000);

  let admin: postgres.Sql;
  let app: INestApplication;
  let broker: InMemoryBroker;
  let cls: ClsService;

  const query = async <T extends object>(database: string, text: string): Promise<T[]> => {
    const client = postgres(urlOf(database), { max: 1, onnotice: () => undefined });
    try {
      return [...(await client.unsafe<T[]>(text))];
    } finally {
      await client.end();
    }
  };
  const probes = async (database: string) =>
    (await query<{ cart_id: string }>(database, 'SELECT cart_id FROM tenant_exit_probe ORDER BY cart_id')).map(
      (r) => r.cart_id,
    );
  const deadLetterStatuses = async (database: string) =>
    (await query<{ status: string }>(database, 'SELECT status FROM event.dead_letters ORDER BY id')).map(
      (r) => r.status,
    );
  /** 관리자 요청이 세우는 맥락 — core 의 요청 문이 토큰 테넌트로 세운다 */
  const asTenant = <T>(tenant: string, fn: () => Promise<T>): Promise<T> =>
    cls.run(async () => {
      cls.set(TENANT_CONTEXT_KEY, tenant);
      return fn();
    });

  beforeAll(async () => {
    process.env.KAFKA_BOOTSTRAP_TOPICS = 'false';
    admin = postgres(urlOf('postgres'), { max: 1, onnotice: () => undefined });
    for (const name of [DB_A, DB_B]) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const client = postgres(urlOf(name), { max: 1, onnotice: () => undefined });
      await migrate(drizzle(client), { migrationsFolder: join(__dirname, '../../../drizzle') });
      await client`CREATE TABLE tenant_exit_probe (cart_id text NOT NULL)`;
      await client.end();
    }

    broker = new InMemoryBroker();
    const moduleRef = await Test.createTestingModule({
      imports: [
        RoutedDbModule,
        testTenancyModule('reject', tenants),
        EventsModule.forApp({ publishes: [CART_STREAM], serviceName: 'untenanted-exit-spec', kafka }),
        EventFailuresModule.forRoot({ sequencedTopics: [TOPIC] }),
      ],
      controllers: [ExitProbeConsumer],
    })
      .overrideProvider(EVENT_TRANSPORT)
      .useValue(new InMemoryTransport(broker))
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await EventsModule.startConsumer(app, {
      tenancy: 'per-message',
      groupId: GROUP,
      kafka,
      strategy: new InMemoryServer(broker),
    });
    await app.init();
    cls = ClsServiceManager.getClsService();
  });

  afterAll(async () => {
    await app?.close();
    for (const name of [DB_A, DB_B]) await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(async () => {
    broker.reset();
    for (const name of [DB_A, DB_B]) {
      await query(name, 'TRUNCATE tenant_exit_probe');
      await query(name, 'TRUNCATE event.dead_letters, event.failure_actions');
    }
  });

  it('테넌트 없는 메시지는 재시도 없이 .dlq 로 가고 커밋된다 — 같은 순서 키의 뒤 메시지가 막히지 않는다', async () => {
    await broker.inject(TOPIC, cartCreated('no-tenant'));
    await broker.inject(TOPIC, cartCreated('after', { tenantId: 'a' }));

    expect(broker.deliveryFailures).toEqual([]);
    expect(await probes(DB_A)).toEqual(['after']);
    expect(await probes(DB_B)).toEqual([]);
    expect(await deadLetterStatuses(DB_A)).toEqual([]);
    expect(await deadLetterStatuses(DB_B)).toEqual([]);
    const dlq = broker.envelopesOn<{ error: { name: string }; context: Record<string, unknown> }>(DLQ_TOPIC);
    expect(dlq.map((m) => [m.error.name, m.context.consumerGroup, m.context.handler])).toEqual([
      ['TenantGateRejection', GROUP, HANDLER],
    ]);
  });

  it('목록 밖 테넌트·봉투를 못 알아보는 메시지도 같은 출구다', async () => {
    await broker.inject(TOPIC, cartCreated('unlisted', { tenantId: 'zzz' }));
    // `messageType` 없는 객체는 `EventTypeGuard` 가 종류가 다르다며 조용히 버린다(① 과 같다). 깨진 JSON 은 핸들러 앞에서 터진다
    await broker.inject(TOPIC, 'not json at all');

    expect(broker.deliveryFailures).toEqual([]);
    expect(await deadLetterStatuses(DB_A)).toEqual([]);
    expect(await deadLetterStatuses(DB_B)).toEqual([]);
    const dlq = broker.envelopesOn<{ originalMessage: { raw?: string; payload?: { id: string } } }>(DLQ_TOPIC);
    expect(dlq.map((m) => m.originalMessage.payload?.id ?? m.originalMessage.raw)).toEqual([
      'unlisted',
      'not json at all',
    ]);
  });

  it('.dlq 의 메시지에 테넌트를 붙여 그 테넌트의 실패 테이블로 옮기면, 다시 넣기가 ② 문을 통과해 그 테넌트 DB 에 쓴다', async () => {
    await broker.inject(TOPIC, cartCreated('rescued'));
    const [dlqRecord] = broker.messagesOn(DLQ_TOPIC);

    const verdict = deadLetterFromDlq(JSON.parse(dlqRecord.value), { consumerGroup: GROUP, tenantId: 'b', tenants });
    if (verdict.kind !== 'import') throw new Error(`가져오기 거절: ${verdict.reason}`);
    const id = await asTenant('b', async () => {
      const [row] = await dbService.db.insert(dead_letters).values(verdict.row).returning({ id: dead_letters.id });
      return row.id;
    });

    const result = await asTenant('b', () => app.get(DeadLetterRedriver).redrive(id, 'operator'));

    expect(result).toEqual({ processed: 1, stoppedAt: null });
    expect(await probes(DB_B)).toEqual(['rescued']);
    expect(await probes(DB_A)).toEqual([]);
    expect(await deadLetterStatuses(DB_B)).toEqual(['redriven']);
  });

  it.each([
    ['봉투에 테넌트 없음(① 시절 행)', undefined],
    ['봉투가 목록의 다른 테넌트', { tenantId: 'b' }],
  ])('%s 도 ② 에서 다시 넣으면 그 행이 든 DB 의 테넌트로 처리·기록된다', async (_case, metadata) => {
    const id = await asTenant('a', async () => {
      const [row] = await dbService.db
        .insert(dead_letters)
        .values({
          consumerGroup: GROUP,
          handler: HANDLER,
          topic: TOPIC,
          sequenceKey: 'cart-shared',
          messageId: 'm-legacy',
          eventType: 'CartCreated',
          envelope: cartCreated('legacy', metadata),
          kafkaPartition: 0,
          kafkaOffset: '7',
          status: 'failed',
          errorName: 'Error',
          errorMessage: '① 에서 실패',
        })
        .returning({ id: dead_letters.id });
      return row.id;
    });

    const result = await asTenant('a', () => app.get(DeadLetterRedriver).redrive(id, 'operator'));

    expect(result).toEqual({ processed: 1, stoppedAt: null });
    expect(await probes(DB_A)).toEqual(['legacy']);
    expect(await probes(DB_B)).toEqual([]);
    expect(
      await asTenant('a', () =>
        dbService.db.select({ status: dead_letters.status }).from(dead_letters).where(eq(dead_letters.id, id)),
      ),
    ).toEqual([{ status: 'redriven' }]);
  });
});
