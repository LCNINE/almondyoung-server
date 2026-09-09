import { Inject, Injectable, Optional } from '@nestjs/common';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { hostname } from 'node:os';
import { CRON_ONCE_INSTANCE_ID, CRON_RUNS_RETENTION_DAYS } from './cron-once.constants';

export type CronRunOutcome = 'ok' | 'error';

/**
 * `cron_runs(name, period_at)` PK 로 «이 주기의 이 크론» 을 한 번만 성립시킨다.
 *
 * raw SQL 인 이유: 앱마다 DbService 의 스키마 타입이 다르고 이 라이브러리는 그 타입을 모른다.
 * 테이블 모양은 `cron-runs.schema.ts` 가 정본이며, 컬럼이 바뀌면 여기 SQL 도 같이 바뀐다.
 *
 * `period_at` 은 ISO 문자열로 넘긴다 — drizzle raw `sql` 에 `Date` 를 넘기면 postgres.js 가
 * 매 호출 TypeError 를 낸다 (`notification/metrics.service.ts:54` 전례).
 */
@Injectable()
export class CronRunClaimer {
  readonly instanceId: string;

  constructor(
    private readonly dbService: DbService,
    @Optional() @Inject(CRON_ONCE_INSTANCE_ID) instanceId?: string,
  ) {
    this.instanceId = instanceId ?? hostname();
  }

  /** true 면 이 인스턴스가 이 주기를 선점했다. 같은 이름의 보존 기간 지난 행을 함께 지운다. */
  async claim(name: string, periodAt: Date): Promise<boolean> {
    const periodIso = periodAt.toISOString();
    const rows = await this.dbService.db.execute(sql`
      WITH purge AS (
        DELETE FROM cron_runs
         WHERE name = ${name}
           AND period_at < ${periodIso}::timestamptz - interval '${sql.raw(String(CRON_RUNS_RETENTION_DAYS))} days'
      )
      INSERT INTO cron_runs (name, period_at, claimed_by)
      VALUES (${name}, ${periodIso}::timestamptz, ${this.instanceId})
      ON CONFLICT (name, period_at) DO NOTHING
      RETURNING name
    `);
    return rows.length > 0;
  }

  async finish(name: string, periodAt: Date, outcome: CronRunOutcome): Promise<void> {
    const periodIso = periodAt.toISOString();
    await this.dbService.db.execute(sql`
      UPDATE cron_runs SET finished_at = now(), outcome = ${outcome}
       WHERE name = ${name} AND period_at = ${periodIso}::timestamptz
    `);
  }
}
