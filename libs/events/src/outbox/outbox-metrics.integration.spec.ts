/**
 * 아웃박스 적체 게이지 — 실 Postgres 대상 (#712)
 *
 * **왜 통합 스펙인가.** 이 기능의 주체는 SQL 이다. 목 DB 로는 `count(*) filter (...)` 가 맞는
 * 행을 세는지, `extract(epoch from ...)` 가 **세션 TZ 와 무관하게** 같은 나이를 내는지 전혀
 * 보이지 않는다 — 목은 우리가 준 배열을 그대로 돌려줄 뿐이다.
 *
 * TZ 가 이 스펙의 핵심이다. `created_at` 은 이 테이블에서 `withTimezone` 이 아닌 컬럼이라
 * `now()`(timestamptz)와 그냥 빼면 세션 TZ 만큼 어긋나고, **세션이 UTC 면 무증상**이다.
 * 그래서 마지막 케이스는 세션 TZ 를 일부러 `Asia/Seoul` 로 바꾸고 같은 답을 요구한다.
 *
 * 실행: `npm run test:core:integration:local -- outbox-metrics`
 * (DATABASE_URL 이 없으면 통째로 skip — `npx jest` 기본 경로에서는 돌지 않는다.)
 */

import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { like, sql } from 'drizzle-orm';
import { register } from 'prom-client';
import { OutboxMetricsCollector } from './outbox-metrics.collector';
import { outbox_events } from './outbox.schema';

const HARNESS_PREFIX = 'outbox-metrics-harness';
const TOPIC_A = `${HARNESS_PREFIX}.a.v1`;
const TOPIC_B = `${HARNESS_PREFIX}.b.v1`;

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

async function seriesValue(name: string, labels: Record<string, string> = {}): Promise<number | undefined> {
  const metric = register.getSingleMetric(name);
  if (!metric) return undefined;
  const collected = await metric.get();
  return collected.values.find((v) => Object.entries(labels).every(([k, val]) => String(v.labels[k]) === val))?.value;
}

/**
 * 이 스펙이 **공유 DB 에서 돈다**는 사실이 설계를 한 번 고쳤다. 로컬 core DB 에는 다른 토픽의
 * 30일 묵은 PENDING 이 17건 남아 있어서, 나이를 라벨 없는 전역 최댓값으로 두면 하네스가 넣은
 * 행이 통째로 가려졌다. 라이브에서도 같은 일이 일어난다 — 한 토픽이 막히면 전역 최댓값이
 * 그 값에 고정돼 **다른 토픽의 적체를 영원히 못 본다.** 그래서 나이·재시도도 토픽별이다.
 */
describeIfDb('아웃박스 적체 게이지 (PostgreSQL 통합)', () => {
  jest.setTimeout(60_000);

  let client: postgres.Sql;
  let db: PostgresJsDatabase<Record<string, never>>;

  const row = (topic: string, over: Record<string, unknown> = {}) => ({
    topic,
    aggregateType: 'MetricsHarness',
    aggregateId: 'harness-1',
    eventType: 'HarnessEvent',
    payload: { harness: true },
    ...over,
  });

  /** 하네스 토픽만 지운다 — 이 테이블은 다른 스펙과 공유하는 실 DB 다. */
  const cleanup = () => db.delete(outbox_events).where(like(outbox_events.topic, `${HARNESS_PREFIX}%`));

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(client);
  });

  beforeEach(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await client.end();
  });

  it('토픽별 적체·실패 행 수와 재시도 대기 수를 센다', async () => {
    await db
      .insert(outbox_events)
      .values([
        row(TOPIC_A),
        row(TOPIC_A, { retryCount: 2 }),
        row(TOPIC_A, { status: 'FAILED', retryCount: 5 }),
        row(TOPIC_A, { status: 'PUBLISHED', publishedAt: new Date() }),
        row(TOPIC_B),
      ]);

    await new OutboxMetricsCollector({ db } as never, []).refresh();

    expect(await seriesValue('events_outbox_pending', { topic: TOPIC_A })).toBe(2);
    expect(await seriesValue('events_outbox_failed_rows', { topic: TOPIC_A })).toBe(1);
    expect(await seriesValue('events_outbox_pending', { topic: TOPIC_B })).toBe(1);
    // PUBLISHED 는 적체가 아니다 — 세면 정상 트래픽이 영원한 적체로 보인다.
    expect(await seriesValue('events_outbox_retry_pending', { topic: TOPIC_A })).toBe(1);
    expect(await seriesValue('events_outbox_retry_pending', { topic: TOPIC_B })).toBe(0);
  });

  it('디스패처가 멈춰 적체가 늙으면 나이가 오른다', async () => {
    await db
      .insert(outbox_events)
      .values(row(TOPIC_A, { createdAt: sql`(now() at time zone 'UTC') - interval '90 minutes'` }));

    await new OutboxMetricsCollector({ db } as never, []).refresh();

    const age = await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: TOPIC_A });
    expect(age).toBeGreaterThan(5300);
    expect(age).toBeLessThan(5500);
  });

  it('세션 TZ 가 UTC 가 아니어도 같은 나이를 낸다', async () => {
    await db
      .insert(outbox_events)
      .values(row(TOPIC_A, { createdAt: sql`(now() at time zone 'UTC') - interval '90 minutes'` }));
    // 라이브(UTC)에서만 맞고 개발 머신(Asia/Seoul)에서 9시간 어긋나는 부류의 버그를 잡는다.
    await db.execute(sql`set time zone 'Asia/Seoul'`);

    try {
      await new OutboxMetricsCollector({ db } as never, []).refresh();

      const age = await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: TOPIC_A });
      expect(age).toBeGreaterThan(5300);
      expect(age).toBeLessThan(5500);
    } finally {
      await db.execute(sql`set time zone 'UTC'`);
    }
  });

  it('적체가 해소되면 0 으로 돌아온다', async () => {
    await db.insert(outbox_events).values(row(TOPIC_A));
    const collector = new OutboxMetricsCollector({ db } as never, []);

    await collector.refresh();
    expect(await seriesValue('events_outbox_pending', { topic: TOPIC_A })).toBe(1);

    await cleanup();
    await collector.refresh();

    expect(await seriesValue('events_outbox_pending', { topic: TOPIC_A })).toBe(0);
    expect(await seriesValue('events_outbox_oldest_pending_age_seconds', { topic: TOPIC_A })).toBe(0);
  });
});
