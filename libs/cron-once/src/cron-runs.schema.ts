import { pgTable, primaryKey, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * 크론 «주기당 한 번» 선점 기록 (ADR-0036, #821). **각 앱이 자기 DB 의 `public.cron_runs` 를 쓴다.**
 *
 * 이 파일은 크론이 있는 앱 7개(analytics · channel-adapter · core · membership · ugc-service ·
 * user-service · wallet)의 `drizzle.config.ts` 가 **전부 schema 목록에 물고 있다**. 여기를 고치면
 * 그 7개 앱 모두에 마이그레이션이 생긴다 — 하나라도 빠뜨리면 다음 무관한 `db:generate` 가 이 변경을
 * 조용히 그 마이그레이션에 끼워 넣는다 (`libs/events/src/outbox/outbox.schema.ts` 와 같은 관례).
 *
 * `CronRunClaimer` 는 raw SQL 로 이 테이블을 쓴다 — 앱 스키마 타입에 의존하지 않기 위해서다.
 * 따라서 이 정의는 마이그레이션 생성용이고, 컬럼을 바꾸면 claimer 의 SQL 도 같이 고쳐야 한다.
 */
export const cronRuns = pgTable(
  'cron_runs',
  {
    /** `@CronOnce` 의 name. */
    name: varchar('name', { length: 100 }).notNull(),
    /** 크론식에서 도출한 예정 발화 시각 (`computePeriodAt`). */
    periodAt: timestamp('period_at', { withTimezone: true }).notNull(),
    /** 선점한 인스턴스 — 기본 `os.hostname()` (Fargate 에서는 컨테이너 id). */
    claimedBy: varchar('claimed_by', { length: 100 }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** `ok` | `error`. 선점 후 본문이 끝나면 채운다. */
    outcome: varchar('outcome', { length: 20 }),
  },
  (t) => [primaryKey({ columns: [t.name, t.periodAt] })],
);
