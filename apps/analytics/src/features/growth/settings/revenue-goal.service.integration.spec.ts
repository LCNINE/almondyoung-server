import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import type { DbService } from '@app/db';
import { BadRequestError, NotFoundError } from '@app/shared';
import { analyticsSchema, settingRevenueGoals } from '../../../schema';
import { allocateByDays, RevenueGoalService } from './revenue-goal.service';

/**
 * 연간 목표 저장 — 이력(최신이 현재), 삭제 시 직전 복귀, 월 배분 합 검증, 범위 기본값.
 * 2098년으로 격리한다(실제 목표와 겹치지 않는다).
 *
 * 실행: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/analytics \
 *   npx jest --testPathPattern="revenue-goal.service.integration" --runInBand
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const YEAR = 2098;

describeIfDb('RevenueGoalService (실 Postgres)', () => {
  jest.setTimeout(60_000);
  let sql: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof analyticsSchema>>;
  let service: RevenueGoalService;

  beforeAll(async () => {
    sql = postgres(DATABASE_URL as string, { max: 1 });
    db = drizzle(sql, { schema: analyticsSchema });
    const dbService = {
      db,
      run: <T>(fn: (t: unknown) => Promise<T>, tx?: unknown): Promise<T> =>
        tx ? fn(tx) : (db.transaction((t) => fn(t)) as Promise<T>),
    } as unknown as DbService<typeof analyticsSchema>;
    service = new RevenueGoalService(dbService);
    await db.delete(settingRevenueGoals).where(eq(settingRevenueGoals.year, YEAR));
  });

  afterAll(async () => {
    if (db) await db.delete(settingRevenueGoals).where(eq(settingRevenueGoals.year, YEAR));
    await sql?.end();
  });

  it('월 배분을 생략하면 일수 비례로 나누고, 범위 기본값은 자사몰', async () => {
    const { id } = await service.create({ year: YEAR, annualTarget: 1_000_000_007 });
    const current = await service.getCurrent(YEAR);
    expect(current?.id).toBe(id);
    expect(current?.scope).toBe('own_mall');
    expect(current?.monthlyTargets).toEqual(allocateByDays(YEAR, 1_000_000_007));
    expect(current?.monthlyTargets.reduce((a, b) => a + b, 0)).toBe(1_000_000_007);
  });

  it('새로 등록하면 그것이 현재 목표, 지우면 직전 목표로 돌아간다', async () => {
    const first = await service.getCurrent(YEAR);
    await new Promise((r) => setTimeout(r, 5));
    const months = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 900];
    const { id } = await service.create({ year: YEAR, annualTarget: 2000, monthlyTargets: months, scope: 'all_channels', preCoverageActual: 50 });
    const history = await service.listForYear(YEAR);
    expect(history.map((g) => g.id)).toEqual([id, first?.id]);
    expect(history[0]).toMatchObject({ scope: 'all_channels', annualTarget: 2000, monthlyTargets: months, preCoverageActual: 50 });
    await service.remove(id);
    expect((await service.getCurrent(YEAR))?.id).toBe(first?.id);
  });

  it('월 배분 합이 연간 목표와 다르면 400, 없는 목표 삭제는 404', async () => {
    await expect(service.create({ year: YEAR, annualTarget: 1000, monthlyTargets: Array(12).fill(1) })).rejects.toBeInstanceOf(BadRequestError);
    await expect(service.remove('00000000-0000-0000-0000-000000000000')).rejects.toBeInstanceOf(NotFoundError);
  });
});
