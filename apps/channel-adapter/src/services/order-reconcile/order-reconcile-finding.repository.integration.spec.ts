// eslint-disable-next-line @typescript-eslint/no-require-imports -- postgres publishes `export =`; Jest compiles CJS.
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import { channelAdapterSchema, orderReconcileFindings } from '../../schema';
import { OrderReconcileFindingRepository, UpsertFindingInput } from './order-reconcile-finding.repository';

/**
 * 실행: dotenv -e apps/channel-adapter/.env -- npx jest --runInBand apps/channel-adapter/src/services/order-reconcile/order-reconcile-finding.repository.integration.spec.ts
 */
const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('OrderReconcileFindingRepository (PostgreSQL integration)', () => {
  jest.setTimeout(60_000);
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof channelAdapterSchema>>;
  let repo: OrderReconcileFindingRepository;
  const channel = `spec-${Math.random().toString(36).slice(2, 10)}`;

  const input = (over: Partial<UpsertFindingInput> = {}): UpsertFindingInput => ({
    channel,
    externalOrderId: 'order_1',
    displayOrderNo: '3900',
    kind: 'missing_order',
    handling: 'auto',
    humanReason: null,
    coreStatus: null,
    channelCreatedAt: new Date('2026-10-15T00:00:00Z'),
    mode: 'observe',
    lastResult: 'would_act',
    seenAt: new Date('2026-10-16T00:00:00Z'),
    ...over,
  });

  beforeAll(() => {
    client = postgres(DATABASE_URL as string, { max: 2, prepare: false });
    db = drizzle(client, { schema: channelAdapterSchema });
    // DbService 는 생성자에서 접속을 연다 — 스펙은 같은 모양(db + run)의 얇은 대역을 쓴다
    const run = <T>(fn: (tx: never) => Promise<T>, tx?: unknown) => (tx ? fn(tx as never) : db.transaction(fn));
    repo = new OrderReconcileFindingRepository({ db, run } as never);
  });
  afterEach(async () => {
    await db.delete(orderReconcileFindings).where(eq(orderReconcileFindings.channel, channel));
  });
  afterAll(async () => {
    await client.end({ timeout: 0 });
  });

  it('같은 열린 어긋남은 한 행을 갱신한다', async () => {
    const first = await repo.upsertOpen(input());
    const second = await repo.upsertOpen(
      input({ handling: 'human', humanReason: 'out_of_window', seenAt: new Date('2026-10-16T01:00:00Z') }),
    );
    expect(second.id).toBe(first.id);
    expect(second.handling).toBe('human');
    expect(second.humanReason).toBe('out_of_window');
    expect(second.firstSeenAt.toISOString()).toBe(first.firstSeenAt.toISOString());
    expect(second.lastSeenAt.toISOString()).toBe('2026-10-16T01:00:00.000Z');
  });

  it('닫힌 행이 있어도 새 open 행을 만든다', async () => {
    const first = await repo.upsertOpen(input());
    await expect(repo.close(first.id, 'admin-1', '셀메이트로 이미 나감')).resolves.toMatchObject({ status: 'closed' });
    const again = await repo.upsertOpen(input());
    expect(again.id).not.toBe(first.id);
    expect(again.status).toBe('open');
  });

  it('닫힌 행은 다시 닫지 못한다', async () => {
    const first = await repo.upsertOpen(input());
    await repo.close(first.id, null, '메모');
    await expect(repo.close(first.id, null, '또')).resolves.toBeNull();
  });

  it('시도 기록은 수를 1 올리고 결과를 남긴다', async () => {
    const row = await repo.upsertOpen(input());
    await repo.recordAttempt(row.id, 'enqueued');
    await expect(repo.findById(row.id)).resolves.toMatchObject({ attemptCount: 1, lastResult: 'enqueued' });
  });

  it('요약은 열린 행만 센다', async () => {
    await repo.upsertOpen(input({ externalOrderId: 'a' }));
    await repo.upsertOpen(input({ externalOrderId: 'b', handling: 'human', humanReason: 'attempts_exhausted' }));
    const c = await repo.upsertOpen(input({ externalOrderId: 'c', handling: 'human', humanReason: 'out_of_window' }));
    await repo.markResolved([c.id], new Date());
    const summary = await repo.summary();
    // 다른 스펙 행이 섞일 수 있어 하한으로 본다 — 이 채널 행만 세는 API 는 두지 않는다
    expect(summary.open).toBeGreaterThanOrEqual(2);
    expect(summary.human).toBeGreaterThanOrEqual(1);
    expect(summary.gaveUp).toBeGreaterThanOrEqual(1);
  });
});
