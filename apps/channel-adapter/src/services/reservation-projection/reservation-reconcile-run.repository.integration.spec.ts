import { inArray, sql } from 'drizzle-orm';
import { DbService } from '@app/db';
import { channelAdapterSchema, medusaReservationReconcileRuns } from '../../schema';
import { ReservationReconcileRunRepository } from './reservation-reconcile-run.repository';

/**
 * «확인했으니 고치기» 의 «도는 회차가 있으면 시작하지 않는다» 한 문(#1247). 표 전체의 running 행을 보는 문이라
 * 남의 DB 에서 돌면 판정이 흔들린다 — 이름이 scratch/test 로 시작하는 DB 에서만 돈다.
 * 실행: DATABASE_URL=postgres://…/scratch_x npx jest --runInBand apps/channel-adapter/src/services/reservation-projection/reservation-reconcile-run.repository.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const isScratch = !!DATABASE_URL && /\/(scratch|test)[^/]*$/.test(new URL(DATABASE_URL).pathname);
const describeIfScratchDb = isScratch ? describe : describe.skip;

describeIfScratchDb('ReservationReconcileRunRepository.startIfIdle (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let dbService: DbService<typeof channelAdapterSchema>;
  let repo: ReservationReconcileRunRepository;
  const created: string[] = [];
  const now = new Date('2026-11-09T05:00:00Z');
  const staleBefore = new Date(now.getTime() - 2 * 3600 * 1000);

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL as string }, channelAdapterSchema);
    const [row] = await dbService.db.execute<{ name: string }>(sql`select current_database() as name`);
    if (!/^(scratch|test)/.test(row.name)) throw new Error(`스크래치 DB 가 아니다: ${row.name}`);
    repo = new ReservationReconcileRunRepository(dbService);
  });
  afterEach(async () => {
    if (created.length > 0) {
      await dbService.db
        .delete(medusaReservationReconcileRuns)
        .where(inArray(medusaReservationReconcileRuns.id, created));
      created.length = 0;
    }
  });
  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('도는 회차가 없으면 running 행을 넣고 처리자를 남긴다', async () => {
    const id = await repo.startIfIdle(now, 'admin-1', staleBefore);
    expect(id).not.toBeNull();
    created.push(id as string);
    await expect(repo.findById(id as string)).resolves.toMatchObject({
      status: 'running',
      forcedBy: 'admin-1',
      startedAt: now,
    });
  });

  it('최근에 시작한 running 이 있으면 넣지 않고 null', async () => {
    created.push(await repo.start(new Date(now.getTime() - 60_000), null));
    await expect(repo.startIfIdle(now, 'admin-1', staleBefore)).resolves.toBeNull();
  });

  it('정해진 나이보다 오래된 running(죽은 프로세스가 남긴 행)은 막지 않는다', async () => {
    created.push(await repo.start(new Date(staleBefore.getTime() - 60_000), null));
    const id = await repo.startIfIdle(now, 'admin-1', staleBefore);
    expect(id).not.toBeNull();
    created.push(id as string);
  });

  it('끝난 회차(applied·halted·skipped)는 막지 않는다', async () => {
    const done = await repo.start(new Date(now.getTime() - 60_000), null);
    created.push(done);
    await repo.finish(done, {
      status: 'halted',
      candidates: 3,
      plannedFixes: 2,
      fixes: 0,
      fixFailures: 0,
      deferred: 0,
      unknown: 0,
      oldestUnknownAt: null,
      examples: [],
      error: null,
    });
    await expect(repo.findById(done)).resolves.toMatchObject({ status: 'halted', plannedFixes: 2, candidates: 3 });
    const id = await repo.startIfIdle(now, 'admin-1', staleBefore);
    expect(id).not.toBeNull();
    created.push(id as string);
  });
});
