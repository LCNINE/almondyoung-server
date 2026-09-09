import { DbService } from '@app/db';
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { hostname } from 'node:os';
import { CronRunClaimer } from './cron-run.claimer';

/** drizzle `db.execute(sql\`…\`)` 의 postgres.js 결과는 행 배열이다. */
const makeDb = (rows: Record<string, unknown>[]) => {
  const execute = jest.fn().mockResolvedValue(rows);
  const dbService = { db: { execute } } as unknown as DbService;
  return { dbService, execute };
};

/**
 * `sql` 태그 결과에서 SQL 문자열과 파라미터를 꺼낸다. `queryChunks` 내부 형식을 직접 훑는
 * 대신 drizzle 자신의 `PgDialect#sqlToQuery` 로 `{ sql, params }` 를 얻는다 — `sql.raw()` 로
 * 심은 중첩 SQL 청크(보존 기간 상수)도 이 경로로 정확히 펼쳐진다.
 */
const queryOf = (execute: jest.Mock<Promise<unknown>, [SQL]>, call = 0) => {
  const [chunk] = execute.mock.calls[call];
  const { sql: text, params } = new PgDialect().sqlToQuery(chunk);
  return { text, params };
};

describe('CronRunClaimer', () => {
  const periodAt = new Date('2026-09-10T00:00:00.000Z');

  it('행이 돌아오면 선점 성공', async () => {
    const { dbService, execute } = makeDb([{ name: 'nightly' }]);
    const claimer = new CronRunClaimer(dbService, 'task-a');
    await expect(claimer.claim('nightly', periodAt)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('행이 없으면(ON CONFLICT) 선점 실패', async () => {
    const { dbService } = makeDb([]);
    const claimer = new CronRunClaimer(dbService, 'task-a');
    await expect(claimer.claim('nightly', periodAt)).resolves.toBe(false);
  });

  it('선점 문장은 INSERT … ON CONFLICT DO NOTHING RETURNING 이고 보존 기간 purge CTE 를 품는다', async () => {
    const { dbService, execute } = makeDb([{ name: 'nightly' }]);
    await new CronRunClaimer(dbService, 'task-a').claim('nightly', periodAt);
    const { text } = queryOf(execute);
    expect(text).toMatch(/DELETE FROM cron_runs/);
    expect(text).toMatch(/interval '7 days'/);
    expect(text).toMatch(/INSERT INTO cron_runs/);
    expect(text).toMatch(/ON CONFLICT \(name, period_at\) DO NOTHING/);
    expect(text).toMatch(/RETURNING name/);
  });

  it('period_at 은 Date 가 아니라 ISO 문자열로 바인딩한다 (raw sql Date 바인딩 함정)', async () => {
    const { dbService, execute } = makeDb([{ name: 'nightly' }]);
    await new CronRunClaimer(dbService, 'task-a').claim('nightly', periodAt);
    const { params } = queryOf(execute);
    expect(params).toContain('2026-09-10T00:00:00.000Z');
    expect(params.some((p) => p instanceof Date)).toBe(false);
    expect(params).toContain('task-a');
  });

  it('finish 는 finished_at 과 outcome 을 갱신한다', async () => {
    const { dbService, execute } = makeDb([]);
    await new CronRunClaimer(dbService, 'task-a').finish('nightly', periodAt, 'error');
    const { text, params } = queryOf(execute);
    expect(text).toMatch(/UPDATE cron_runs SET finished_at = now\(\), outcome = /);
    expect(params).toEqual(expect.arrayContaining(['error', 'nightly', '2026-09-10T00:00:00.000Z']));
  });

  it('instanceId 가 주입되지 않으면 호스트명을 쓴다', () => {
    const { dbService } = makeDb([]);
    const claimer = new CronRunClaimer(dbService, undefined);
    expect(claimer.instanceId).toBe(hostname());
  });
});
