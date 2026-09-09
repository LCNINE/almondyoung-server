import { Global, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DbModule, DbService } from '@app/db';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { sql } from 'drizzle-orm';
import { CRON_ONCE_INSTANCE_ID } from './cron-once.constants';
import { CronOnce } from './cron-once.decorator';
import { CronOnceModule } from './cron-once.module';

/**
 * 실물 경쟁: 같은 DB 를 보는 Nest 앱 컨텍스트 **둘**이 매초 크론 `probe` 를 동시에 선점한다.
 * ECS 롤링 겹침 / `scaling.max > 1` 을 로컬에서 재현하는 판정이다 (#821 §7).
 *
 * 실행: `npm run test:cron-once:integration` (core 로컬 DB, `cron_runs` 는 core 마이그레이션이 만든다)
 * 또는 `npm run test:core:integration:local` (기본 패턴에 포함).
 *
 * 판정:
 *   - 행 수 ≥ 2 (최소 두 주기가 지났다)
 *   - 두 컨텍스트 실행 카운터 합 = 행 수 (주기마다 정확히 한 번)
 *   - claimed_by 에 두 인스턴스가 모두 등장 (한쪽이 항상 이기는 게 아니다)
 * 한 프로세스라 시계는 공유하지만 선점은 DB 에서 일어나므로 경쟁 자체는 실물이다.
 */
const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_CRON_ONCE_DB === '1' && !DATABASE_URL) {
  throw new Error('DATABASE_URL is required for the cron-once integration suite.');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PROBE = 'probe-cron-once-integration';
const RUN_FOR_MS = 4_000;
const GRACE_MS = 500;

const counters = { a: 0, b: 0 };

const buildApp = async (instanceId: 'a' | 'b'): Promise<TestingModule> => {
  @Injectable()
  class Probe {
    @CronOnce('* * * * * *', { name: PROBE })
    async tick(): Promise<void> {
      counters[instanceId] += 1;
    }
  }
  // CronOnceModule (CronRunClaimer 를 담은 곳) 은 Root 를 import 하지 않으므로, Root 의
  // 평범한 provider 로 등록한 CRON_ONCE_INSTANCE_ID 는 CronRunClaimer 에서 보이지 않는다
  // (Nest 모듈 캡슐화 — 실측: claimed_by 가 항상 hostname 으로 떨어졌다). `@Global()` 로
  // Root 자체를 전역화해 CronOnceModule 쪽에서도 보이게 한다.
  @Global()
  @Module({
    imports: [SCHEDULE_ROOT, CronOnceModule, DbModule.forRoot({ config: { connectionString: DATABASE_URL as string }, schema: {} })],
    providers: [Probe, { provide: CRON_ONCE_INSTANCE_ID, useValue: instanceId }],
    exports: [CRON_ONCE_INSTANCE_ID],
  })
  class Root {}
  const app = await Test.createTestingModule({ imports: [Root] }).compile();
  await app.init();
  return app;
};

describeIfDb('cron-once 선점 경쟁 (앱 컨텍스트 둘)', () => {
  let a: TestingModule;
  let b: TestingModule;
  let admin: DbService;

  beforeAll(async () => {
    a = await buildApp('a');
    b = await buildApp('b');
    admin = a.get(DbService);
    await admin.db.execute(sql`DELETE FROM cron_runs WHERE name = ${PROBE}`);
  });

  afterAll(async () => {
    await admin?.db.execute(sql`DELETE FROM cron_runs WHERE name = ${PROBE}`);
    await b?.close();
    await a?.close();
  });

  it('주기마다 정확히 한 인스턴스만 실행하고, 두 인스턴스가 모두 이겨 본다', async () => {
    await new Promise((resolve) => setTimeout(resolve, RUN_FOR_MS));
    // 진행 중인 tick 이 마감할 시간을 준 뒤 두 크론만 멈춘다. 앱 close() 는 여기서 부르지
    // 않는다 — TestingModule.close() 가 DbService.onModuleDestroy 까지 태워 postgres
    // 커넥션을 끝내므로, 그 뒤 admin.db 로 읽으면 CONNECTION_ENDED 로 죽는다(실측). close 는
    // afterAll 에서 한 번만 한다.
    a.get(SchedulerRegistry).getCronJob(PROBE).stop();
    b.get(SchedulerRegistry).getCronJob(PROBE).stop();
    // stop() 은 새 틱만 막는다 — 마지막 순간에 이미 시작된 틱이 claim() → body() → finish() 를
    // 마칠 시간을 준다 (finish() 없인 outcome 이 NULL 로 남는다).
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS));

    const rows = (await admin.db.execute(sql`
      SELECT period_at, claimed_by, outcome FROM cron_runs WHERE name = ${PROBE} ORDER BY period_at
    `)) as unknown as { period_at: Date; claimed_by: string; outcome: string | null }[];

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(counters.a + counters.b).toBe(rows.length);
    expect(new Set(rows.map((r) => r.claimed_by))).toEqual(new Set(['a', 'b']));
    expect(rows.every((r) => r.outcome === 'ok')).toBe(true);

    await admin.db.execute(sql`DELETE FROM cron_runs WHERE name = ${PROBE}`);
  }, 15_000);
});
