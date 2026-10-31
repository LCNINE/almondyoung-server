import { Logger, type CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { KafkaContext } from '@nestjs/microservices';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql as raw } from 'drizzle-orm';
import { join } from 'node:path';
import { ClsService, ClsServiceManager } from 'nestjs-cls';
import { defer, from, lastValueFrom } from 'rxjs';
import { z } from 'zod';
import { connectionStringFor, DbService } from '@app/db';
import { CronOnceRunner } from '@app/cron-once/cron-once.runner';
import { CronRunClaimer } from '@app/cron-once';
import { OUTBOX_TENANT_FROM_CONTEXT, OutboxDispatcher, StreamPublisher } from '@app/events';
import { outbox_events } from '@app/events/outbox/outbox.schema';
import { EventTenantStamp } from '@app/events/tenancy/event-tenant-stamp';
import { EventTenantGate, TenantGateInterceptor } from '@app/events/tenancy/event-tenant-gate';
import type { EventTransport, TransportMessage } from '@app/events/transport/transport.port';
import { parseTenantList, TENANT_CONTEXT_KEY, TenancyConfig } from '@app/tenancy';
import { event, stream, type MessageEnvelope } from '@packages/event-contracts/types';
import { coreTenantDbRouter } from './core-tenant-db-router';

/**
 * core 의 요청 밖 경로(크론·outbox·이벤트 소비)가 테넌트 DB 마다 도는지를 실 Postgres 로 본다(② reject 라우팅).
 * 테넌트 a·b 는 core 마이그를 마친 스크래치 DB, c 는 일부러 깨진 테넌트(목록엔 있는데 DB 가 없다)다.
 *
 * 실행: `npm run test:core:integration:local -- core-non-request-tenancy`
 * 스펙이 스크래치 DB 둘을 만들고 끝나면 지운다. 접속 정보는 DATABASE_URL 의 것을 쓴다(DB 이름만 바꾼다).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const DB_A = 'tenant_nonrequest_probe_a';
const DB_B = 'tenant_nonrequest_probe_b';
const DB_BROKEN = 'tenant_nonrequest_probe_missing';

const tenants = parseTenantList(
  JSON.stringify([
    { id: 'a', slug: 'alpha', coreDb: DB_A, publicBucket: 'bucket-a', privateBucket: 'bucket-a' },
    { id: 'b', slug: 'beta', coreDb: DB_B, publicBucket: 'bucket-b-pub', privateBucket: 'bucket-b-priv' },
    { id: 'c', slug: 'gamma', coreDb: DB_BROKEN, publicBucket: 'bucket-c-pub', privateBucket: 'bucket-c-priv' },
  ]),
);

const urlOf = (database: string): string => connectionStringFor(DATABASE_URL ?? '', database);

const PROBE_STREAM = stream({
  topic: 'tenant-nonrequest.probe.v1',
  aggregateType: 'Probe',
  events: { ProbeHappened: event('ProbeHappened', z.object({ probeId: z.string() }).strict()) },
});

class CapturingTransport implements EventTransport {
  readonly sent: TransportMessage[] = [];
  async send(_topic: string, message: TransportMessage): Promise<void> {
    this.sent.push(message);
  }
  tenantsSent(): (string | undefined)[] {
    return this.sent.map((m) => (JSON.parse(m.value) as MessageEnvelope).metadata?.tenantId).sort();
  }
}

const envelope = (probeId: string, metadata?: Record<string, unknown>): MessageEnvelope => ({
  messageId: `m-${probeId}`,
  messageType: 'ProbeHappened',
  messageVersion: 1,
  messageKind: 'event',
  correlationId: `m-${probeId}`,
  timestamp: '2026-11-01T00:00:00.000Z',
  source: { service: 'core', aggregateType: 'Probe', aggregateId: probeId },
  payload: { probeId },
  ...(metadata ? { metadata } : {}),
});

describeIfDb('core 요청 밖 경로의 테넌트 루프 (실 Postgres, ② reject)', () => {
  jest.setTimeout(180_000);

  let admin: postgres.Sql;
  let cls: ClsService;
  let db: DbService;
  let errorLog: jest.SpyInstance;

  const inTenant = <T>(tenant: string, fn: () => Promise<T>): Promise<T> =>
    cls.run(async () => {
      cls.set(TENANT_CONTEXT_KEY, tenant);
      return fn();
    });

  const query = async <T extends object>(database: string, text: string): Promise<T[]> => {
    const client = postgres(urlOf(database), { max: 1, onnotice: () => undefined });
    try {
      return [...(await client.unsafe<T[]>(text))];
    } finally {
      await client.end();
    }
  };

  beforeAll(async () => {
    admin = postgres(urlOf('postgres'), { max: 1, onnotice: () => undefined });
    for (const name of [DB_A, DB_B, DB_BROKEN]) await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    for (const name of [DB_A, DB_B]) {
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const client = postgres(urlOf(name), { max: 1, onnotice: () => undefined });
      await migrate(drizzle(client), { migrationsFolder: join(__dirname, '../../../drizzle') });
      await client`CREATE TABLE tenant_consume_probe (note text NOT NULL)`;
      await client.end();
    }

    cls = ClsServiceManager.getClsService();
    db = new DbService(
      { connectionString: urlOf('postgres') },
      {},
      coreTenantDbRouter(new TenancyConfig(tenants, 'reject'), cls),
    );
  });

  afterAll(async () => {
    await db?.onApplicationShutdown();
    for (const name of [DB_A, DB_B]) await admin?.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin?.end();
  });

  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('@CronOnce', () => {
    const META = { expression: '* * * * *', name: 'tenant-nonrequest-probe' };
    const NOW = () => new Date('2026-11-01T00:00:10.000Z');

    it('테넌트 DB 마다 주기당 1행을 선점하고, 본문은 테넌트마다 한 번 그 맥락에서 돈다 — 두 태스크가 겹쳐도', async () => {
      const ran: string[] = [];
      const body = async () => {
        ran.push(String(cls.get(TENANT_CONTEXT_KEY)));
        await db.db.execute(raw`SELECT 1`);
      };
      const taskA = new CronOnceRunner(new CronRunClaimer(db, 'task-a'), db).wrap(META, body, NOW);
      const taskB = new CronOnceRunner(new CronRunClaimer(db, 'task-b'), db).wrap(META, body, NOW);

      await Promise.all([taskA(), taskB()]);
      await taskA(); // 같은 주기 다시 — 선점이 막는다

      expect(ran.sort()).toEqual(['a', 'b']);
      for (const database of [DB_A, DB_B]) {
        const rows = await query<{ outcome: string }>(
          database,
          `SELECT outcome FROM cron_runs WHERE name = '${META.name}'`,
        );
        expect(rows).toEqual([{ outcome: 'ok' }]);
      }
    });

    it('본문이 인스턴스 «도는 중» 깃발로 겹침을 막아도 테넌트마다 돈다 — 테넌트를 동시에 돌리면 둘째가 건너뛰어진다', async () => {
      // order-reconcile·print-order 등 여러 크론 본문의 모양 그대로
      let running = false;
      const ran: string[] = [];
      const meta = { ...META, name: 'tenant-nonrequest-reentry' };
      await new CronOnceRunner(new CronRunClaimer(db, 'task-a'), db).wrap(
        meta,
        async () => {
          if (running) return;
          running = true;
          try {
            await db.db.execute(raw`SELECT pg_sleep(0.05)`);
            ran.push(String(cls.get(TENANT_CONTEXT_KEY)));
          } finally {
            running = false;
          }
        },
        NOW,
      )();

      expect(ran).toEqual(['a', 'b']);
    });

    it('깨진 테넌트(c)의 실패는 c 에 갇힌다 — 로그가 c 를 말하고 a·b 는 돈다', async () => {
      const ran: string[] = [];
      const meta = { ...META, name: 'tenant-nonrequest-isolation' };
      await new CronOnceRunner(new CronRunClaimer(db, 'task-a'), db).wrap(
        meta,
        async () => {
          ran.push(String(cls.get(TENANT_CONTEXT_KEY)));
        },
        NOW,
      )();

      expect(ran.sort()).toEqual(['a', 'b']);
      const messages = errorLog.mock.calls.map(([m]) => String(m));
      expect(messages).toEqual([expect.stringContaining('[db=c]')]);
    });
  });

  describe('outbox 디스패처', () => {
    it('테넌트 DB 마다 행을 집고, 그 테넌트로 찍어 보낸다 — 깨진 테넌트는 다른 테넌트의 발행을 막지 않는다', async () => {
      await inTenant('a', () =>
        db.db.insert(outbox_events).values({
          topic: PROBE_STREAM.topic.topic,
          aggregateType: 'Probe',
          aggregateId: 'p-a',
          eventType: 'ProbeHappened',
          // 옛 행처럼 테넌트 없이, 또는 남의 테넌트가 실려 있어도 DB 의 테넌트로 나간다
          payload: envelope('p-a'),
          status: 'PENDING',
        }),
      );
      await inTenant('b', () =>
        db.db.insert(outbox_events).values({
          topic: PROBE_STREAM.topic.topic,
          aggregateType: 'Probe',
          aggregateId: 'p-b',
          eventType: 'ProbeHappened',
          payload: envelope('p-b', { tenantId: 'a' }),
          status: 'PENDING',
        }),
      );

      const stamp = new EventTenantStamp({
        contextTenant: () => (cls.isActive() ? cls.get<string | undefined>(TENANT_CONTEXT_KEY) : undefined),
        servedTenantId: undefined,
        outboxTenantId: OUTBOX_TENANT_FROM_CONTEXT,
        gateMode: 'reject',
      });
      const transport = new CapturingTransport();
      const publisher = new StreamPublisher(
        transport,
        PROBE_STREAM,
        'core',
        undefined,
        undefined,
        undefined,
        undefined,
        stamp,
      );
      const dispatcher = new OutboxDispatcher(
        db,
        new Map([[PROBE_STREAM.topic.topic, publisher as StreamPublisher]]),
        undefined,
        undefined,
        undefined,
        stamp,
      );

      await dispatcher.dispatchPendingEvents();

      expect(transport.tenantsSent()).toEqual(['a', 'b']);
      for (const database of [DB_A, DB_B]) {
        expect(await query<{ status: string }>(database, `SELECT status FROM event.outbox_events`)).toEqual([
          { status: 'PUBLISHED' },
        ]);
      }
      expect(errorLog.mock.calls.map(([m]) => String(m))).toEqual([expect.stringContaining('[db=c]')]);
    });
  });

  describe('이벤트 소비 (메시지마다)', () => {
    it('테넌트 b 봉투의 메시지는 핸들러가 b 의 DB 에 쓴다', async () => {
      const gate = new EventTenantGate({
        tenancy: 'per-message',
        servedTenantId: undefined,
        tenants,
        gateMode: 'reject',
      });
      const interceptor = new TenantGateInterceptor(gate, new Reflector(), cls);
      const handler = function onProbe() {
        return db.db.execute(raw`INSERT INTO tenant_consume_probe (note) VALUES ('from-b-envelope')`);
      };
      const message = { value: JSON.stringify(envelope('p-consume', { tenantId: 'b' })), offset: '0' };
      const kafkaContext = new KafkaContext([
        message as never,
        0,
        PROBE_STREAM.topic.topic,
        {} as never,
        (() => Promise.resolve()) as never,
        {} as never,
      ]);
      const context = new ExecutionContextHost([message, kafkaContext], class ProbeConsumer {}, handler);
      context.setType('rpc');
      const next: CallHandler = { handle: () => defer(() => from(handler())) };

      // 소비 경로의 최외곽 ClsInterceptor 가 메시지마다 맥락을 연다 — 여기선 cls.run 이 그 자리다
      await cls.run(() => lastValueFrom(interceptor.intercept(context, next), { defaultValue: undefined }));

      expect(await query<{ note: string }>(DB_B, `SELECT note FROM tenant_consume_probe`)).toEqual([
        { note: 'from-b-envelope' },
      ]);
      expect(await query<{ note: string }>(DB_A, `SELECT note FROM tenant_consume_probe`)).toEqual([]);
    });
  });
});
