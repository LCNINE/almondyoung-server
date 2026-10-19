import { DbService } from '@app/db';
import { piiAccessLogs, userServiceSchema, type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { PiiAccessCreator } from './pii-access.creator';
import { PiiAccessRepository } from './pii-access.repository';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('personal data access log against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let repository: PiiAccessRepository;
  let creator: PiiAccessCreator;
  const actor = randomUUID();

  const entry = (eventId: string, occurredAt: Date, subjectId: string) => ({
    eventId,
    actorUserId: actor,
    actorLoginId: 'zz',
    claimedIp: null,
    peerIp: '10.0.0.1',
    forwardedFor: null,
    userAgent: null,
    requestId: null,
    sourceService: 'core',
    method: 'GET',
    route: '/sales-orders/:id',
    action: 'view' as const,
    subjects: [{ type: 'sales_order', id: subjectId }],
    subjectCount: 1,
    kinds: ['name'],
    queryKeys: [],
    reason: null,
    occurredAt,
  });

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    repository = new PiiAccessRepository(dbService);
    creator = new PiiAccessCreator(repository);
  });

  afterAll(async () => {
    await dbService.db.delete(piiAccessLogs).where(eq(piiAccessLogs.actorUserId, actor));
    await dbService.onApplicationShutdown();
  });

  it('keeps one row when the same event arrives twice', async () => {
    const eventId = randomUUID();
    await creator.record(entry(eventId, new Date('2026-10-19T00:00:00.000Z'), 'so-dup'));
    await creator.record(entry(eventId, new Date('2026-10-19T00:00:00.000Z'), 'so-dup'));
    const rows = await dbService.db.select().from(piiAccessLogs).where(eq(piiAccessLogs.eventId, eventId));
    expect(rows).toHaveLength(1);
  });

  it('finds rows by a subject inside the subjects array', async () => {
    await creator.record(entry(randomUUID(), new Date('2026-10-19T01:00:00.000Z'), 'so-find'));
    const rows = await repository.page({ actorUserId: actor, subject: { type: 'sales_order', id: 'so-find' } }, 10);
    expect(rows.map((r) => r.subjects)).toEqual([[{ type: 'sales_order', id: 'so-find' }]]);
  });

  it('pages rows of the same millisecond without skipping', async () => {
    const at = new Date('2026-10-19T02:00:00.000Z');
    await creator.record(entry(randomUUID(), at, 'so-ms-1'));
    await creator.record(entry(randomUUID(), at, 'so-ms-2'));
    const first = await repository.page({ actorUserId: actor, from: at }, 1);
    const second = await repository.page({ actorUserId: actor, from: at, before: first[0] }, 5);
    expect(new Set([...first, ...second].map((r) => r.id)).size).toBe(2);
  });

  it('counts after-hours access in Korean time', async () => {
    // 03:00 KST = 전날 18:00 UTC
    await creator.record(entry(randomUUID(), new Date('2026-10-18T18:00:00.000Z'), 'so-night'));
    const summary = await repository.summary(new Date('2026-10-18T00:00:00.000Z'), new Date('2026-10-19T00:00:00.000Z'));
    expect(summary.find((s) => s.actorUserId === actor)?.afterHoursCount).toBe(1);
  });

  it('deletes only rows older than the cutoff', async () => {
    await creator.record(entry(randomUUID(), new Date('2020-01-01T00:00:00.000Z'), 'so-old'));
    const deleted = await repository.deleteBefore(new Date('2021-01-01T00:00:00.000Z'), 10_000);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const left = await repository.page({ actorUserId: actor, subject: { type: 'sales_order', id: 'so-old' } }, 10);
    expect(left).toHaveLength(0);
  });
});
