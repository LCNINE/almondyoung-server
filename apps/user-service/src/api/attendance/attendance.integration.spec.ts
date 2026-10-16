import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { DbService } from '@app/db';
import { sql } from 'drizzle-orm';
import { attendanceJobs, attendanceRequests, userServiceSchema } from '../../../database/drizzle/schema';
import { AttendanceRepository } from './repositories/attendance.repository';
import { AttendanceService } from './services/attendance.service';
import { AttendanceCalendarService } from './services/attendance-calendar.service';
import { AttendanceRequestManager } from './services/attendance-request.manager';
import { AttendanceJobsService } from './services/attendance-jobs.service';
import { AttendanceController } from './controllers/attendance.controller';
import { MasterRoleGuard, type JwtPayload } from '@app/authorization';
import { GUARDS_METADATA } from '@nestjs/common/constants';

const run = process.env.REQUIRE_ATTENDANCE_DB === '1' ? describe : describe.skip;
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const master = '00000000-0000-4000-8000-000000000003';
const site = '00000000-0000-4000-8000-000000000004';

run('attendance PostgreSQL transactions', () => {
  let container: StartedPostgreSqlContainer;
  let database: DbService<typeof userServiceSchema>;
  let repo: AttendanceRepository;
  let service: AttendanceService;
  let calendar: AttendanceCalendarService;
  let requests: AttendanceRequestManager;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    database = new DbService({ connectionString: container.getConnectionUri() }, userServiceSchema);

    await migrate(database.db, { migrationsFolder: 'apps/user-service/database/drizzle' });

    repo = new AttendanceRepository(database);

    service = new AttendanceService(repo);

    calendar = new AttendanceCalendarService(repo);

    requests = new AttendanceRequestManager(repo);
  }, 120000);

  afterAll(async () => {
    await database?.onApplicationShutdown();

    await container?.stop();
  });

  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users, roles, attendance_worksites CASCADE`);

    await database.db.execute(sql`
      INSERT INTO users (id, login_id, username, nickname, email) VALUES
      (${owner}, 'owner', '직원하나', 'owner', 'owner@example.test'),
      (${other}, 'other', '직원둘', 'other', 'other@example.test'),
      (${master}, 'master', '마스터', 'master', 'master@example.test');
    `);

    await database.db.execute(
      sql`INSERT INTO attendance_worksites (id, name, latitude, longitude, radius_meters, accuracy_meters) VALUES (${site}, '본사', '37.5', '127', 150, 50)`,
    );
  });

  function punch(kind: 'in' | 'out', requestId: string, now: Date) {
    return {
      kind,
      requestId,
      siteId: site,
      location: { latitude: 37.5, longitude: 127, accuracy: 10, timestamp: now.getTime() },
    };
  }

  it('serializes concurrent check-ins into one session and immutable punch event', async () => {
    const now = new Date('2026-10-15T00:00:00Z');

    const results = await Promise.allSettled([
      service.punch(owner, punch('in', '00000000-0000-4000-8000-000000000011', now), now),
      service.punch(owner, punch('in', '00000000-0000-4000-8000-000000000012', now), now),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    expect(await repo.records(owner)).toHaveLength(1);

    const events = await database.db.execute(sql`SELECT id FROM attendance_punches`);

    expect(events).toHaveLength(1);
  });

  it('returns the same result for concurrent retries and closes an overnight session', async () => {
    const start = new Date('2026-10-15T14:55:00Z');
    const body = punch('in', '00000000-0000-4000-8000-000000000013', start);

    const [first, retry] = await Promise.all([service.punch(owner, body, start), service.punch(owner, body, start)]);

    expect(first).toEqual(retry);

    const end = new Date('2026-10-15T15:10:00Z');

    const finished = await service.punch(owner, punch('out', '00000000-0000-4000-8000-000000000014', end), end);

    expect(finished.workDate).toBe('2026-10-15');

    expect(finished.checkOut).toBe(end.toISOString());
  });

  it('preserves existing leave and adds missing dates without permitting cross-owner changes', async () => {
    const [leave] = await calendar.save(owner, [{ date: '2026-10-15', type: 'am', start: '13:00', end: '18:00' }]);

    await expect(calendar.remove(other, leave.id)).rejects.toThrow();

    await expect(calendar.update(other, leave.id, { date: leave.date, type: 'full' })).rejects.toThrow();

    const combined = await calendar.save(owner, [
      { date: '2026-10-15', type: 'full' },
      { date: '2026-10-16', type: 'full' },
    ]);

    expect(combined).toHaveLength(2);

    const rows = await calendar.list('2026-10-15', '2026-10-16');

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: leave.id, name: '직원하나', type: 'am', start: '13:00', end: '18:00' });
    expect(rows[1]).toMatchObject({ date: '2026-10-16', type: 'full' });
    expect(rows[0]).not.toHaveProperty('reason');
  });

  it('accepts simultaneous and lost-response leave retries without duplicate rows or audit events', async () => {
    const days = [
      { date: '2026-10-16', type: 'full' as const },
      { date: '2026-10-17', type: 'full' as const },
    ];

    const [first, simultaneous] = await Promise.all([calendar.save(owner, days), calendar.save(owner, days)]);
    const retry = await calendar.save(owner, days);

    expect(simultaneous).toEqual(first);
    expect(retry).toEqual(first);
    expect(await calendar.list('2026-10-16', '2026-10-17')).toHaveLength(2);

    const audit = await database.db.execute(sql`SELECT id FROM attendance_audit WHERE kind = 'leave.created'`);

    expect(audit).toHaveLength(2);
  });

  it('does not save any dates when an expanded leave range contains invalid times', async () => {
    await expect(
      calendar.save(owner, [
        { date: '2026-10-16', type: 'full' },
        { date: '2026-10-17', type: 'am', start: '18:00', end: '13:00' },
      ]),
    ).rejects.toThrow();

    expect(await calendar.list('2026-10-16', '2026-10-17')).toHaveLength(0);
  });

  it('allows one decision under concurrent masters, records self approval and immutable history', async () => {
    const request = await requests.create(master, {
      workDate: '2026-10-15',
      checkIn: '2026-10-15T00:00:00Z',
      checkOut: '2026-10-15T09:00:00Z',
      reason: '출근 기록 누락\n실제 근무 완료',
      fileIds: [],
    });

    const results = await Promise.allSettled([
      requests.decide(master, ['master'], request.id, { version: 1, status: 'approved', reason: '확인' }),
      requests.decide(master, ['master'], request.id, { version: 1, status: 'approved', reason: '재시도' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    expect(await repo.records(master)).toHaveLength(1);

    const audit = await database.db.execute(
      sql`SELECT actor_id, subject_id FROM attendance_audit WHERE kind = 'request.decided'`,
    );

    expect(audit).toHaveLength(1);

    expect(audit[0]).toMatchObject({ actor_id: master, subject_id: master });
  });

  it('does not overwrite a record created after an exception was submitted', async () => {
    const request = await requests.create(owner, {
      workDate: '2026-10-15',
      checkIn: '2026-10-15T00:00:00Z',
      reason: '누락',
    });

    const now = new Date('2026-10-15T00:30:00Z');

    await service.punch(owner, punch('in', '00000000-0000-4000-8000-000000000015', now), now);

    await expect(
      requests.decide(master, ['master'], request.id, { version: 1, status: 'approved', reason: '' }),
    ).rejects.toThrow();

    expect((await repo.records(owner))[0].checkIn.toISOString()).toBe(now.toISOString());
  });

  it('allows owner cancellation and a safe history while rejecting another employee', async () => {
    const request = await requests.create(owner, {
      workDate: '2026-10-15',
      checkIn: '2026-10-15T00:00:00Z',
      reason: '누락',
    });

    await expect(requests.cancel(other, request.id, 1)).rejects.toThrow();

    await requests.cancel(owner, request.id, 1);

    const history = await requests.history(owner, false, request.id);

    expect(history.some((entry) => entry.kind === 'request.cancelled')).toBe(true);

    expect(history[0]).not.toHaveProperty('aiResult');

    await expect(requests.history(other, false, request.id)).rejects.toThrow();

    await expect(
      requests.decide(master, ['master'], request.id, { version: 2, status: 'approved', reason: '' }),
    ).rejects.toThrow();
  });

  it.each(['expired', 'crashed'] as const)('terminates %s AI work and exposes manual review fallback', async (mode) => {
    const request = await requests.create(owner, {
      workDate: '2026-10-15',
      checkIn: '2026-10-15T00:00:00Z',
      reason: '기록 누락',
    });

    await database.db.execute(sql`DELETE FROM attendance_jobs WHERE kind <> 'ai'`);

    await database.db.update(attendanceRequests).set({ aiStatus: mode === 'crashed' ? 'running' : 'queued' });

    await database.db.update(attendanceJobs).set({
      status: mode === 'crashed' ? 'running' : 'pending',
      attempts: mode === 'crashed' ? 3 : 0,
      leaseUntil: new Date(Date.now() - 1000),
      expiresAt: new Date(Date.now() + (mode === 'crashed' ? 60000 : -1000)),
    });

    await new AttendanceJobsService(repo).tick();

    const jobs = await database.db.select().from(attendanceJobs);
    const rows = await database.db.select().from(attendanceRequests);

    expect(jobs[0].status).toBe('failed');
    expect(rows.find((row) => row.id === request.id)?.aiStatus).toBe('failed');
  });

  it('allows a master to inspect another staff record and denies ordinary staff', async () => {
    const now = new Date('2026-10-15T00:00:00Z');

    await service.punch(owner, punch('in', '00000000-0000-4000-8000-000000000016', now), now);

    const controller = new AttendanceController(service, repo, calendar);
    const masterUser = { id: master, roles: ['master'] } as JwtPayload;
    const otherUser = { id: other, roles: ['admin'] } as JwtPayload;

    const rows = await controller.records(masterUser, owner);

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(owner);

    await expect(controller.records(otherUser, owner)).rejects.toThrow();
    expect(await controller.records(otherUser)).toHaveLength(0);
  });

  it('versions worksite corrections and rejects punches at a disabled site', async () => {
    const controller = new AttendanceController(service, repo, calendar);
    const masterUser = { id: master, roles: ['master'] } as JwtPayload;
    const input = {
      name: '이전 본사',
      latitude: 37.5,
      longitude: 127,
      radiusMeters: 150,
      accuracyMeters: 50,
      active: false,
      version: 1,
    };

    expect(Reflect.getMetadata(GUARDS_METADATA, controller.updateSite)).toContain(MasterRoleGuard);

    const changed = await controller.updateSite(masterUser, site, input);

    expect(changed).toMatchObject({ active: false, version: 2 });
    await expect(controller.updateSite(masterUser, site, input)).rejects.toThrow();

    const now = new Date('2026-10-15T00:00:00Z');

    await expect(
      service.punch(owner, punch('in', '00000000-0000-4000-8000-000000000017', now), now),
    ).rejects.toThrow();

    expect(await repo.records(owner)).toHaveLength(0);
  });
});
