import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import {
  createCheckpointsForTesting,
  PermissionCache,
  RolePermissionSource,
  type SnapshotFetch,
} from '@app/authorization';
import { DbService } from '@app/db';
import { and, eq, ne, sql } from 'drizzle-orm';
import { createServer } from 'node:http';
import { seoulDate } from '@packages/domain-types/attendance';
import {
  attendanceAudit,
  attendanceJobs,
  attendanceLeaves,
  attendancePreferences,
  attendanceRequests,
  userServiceSchema,
} from '../../../database/drizzle/schema';
import { AttendanceRepository } from './repositories/attendance.repository';
import { IamRepository } from '../iam/iam.repository';
import { PermissionCatalogSyncManager } from '../iam/permission-catalog-sync.manager';
import { RolePermissionsReader } from '../iam/role-permissions.reader';
import { AttendanceService } from './services/attendance.service';
import { AttendanceStatisticsService } from './services/attendance-statistics.service';
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

/** 운영과 같은 경로로 사본을 만든다 — 권한 목록 동기화(첫 부여) → 역할별 스냅샷 → 사본. */
class DatabaseRolePermissionSource extends RolePermissionSource {
  constructor(private readonly reader: RolePermissionsReader) {
    super();
  }

  isConfigured(): boolean {
    return true;
  }

  async fetch(): Promise<SnapshotFetch> {
    const snapshot = await this.reader.snapshot();

    return {
      status: 'loaded',
      snapshot: { version: snapshot.version, roles: new Map(Object.entries(snapshot.roles)) },
    };
  }
}

run('attendance PostgreSQL transactions', () => {
  let container: StartedPostgreSqlContainer;
  let database: DbService<typeof userServiceSchema>;
  let repo: AttendanceRepository;
  let service: AttendanceService;
  let calendar: AttendanceCalendarService;
  let requests: AttendanceRequestManager;
  let permissionCache: PermissionCache;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    database = new DbService({ connectionString: container.getConnectionUri() }, userServiceSchema);

    await migrate(database.db, { migrationsFolder: 'apps/user-service/database/drizzle' });

    permissionCache = new PermissionCache(
      new DatabaseRolePermissionSource(new RolePermissionsReader(new IamRepository(database))),
      {
        service: 'user-service',
        enforce: false,
        refreshIntervalMs: 30000,
        retryBaseMs: 1000,
        summaryIntervalMs: 300000,
      },
    );

    repo = new AttendanceRepository(database, permissionCache);

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

    await database.db.execute(sql`INSERT INTO roles (name) VALUES ('admin'), ('master'), ('intern')`);

    await database.db.execute(sql`TRUNCATE iam_permissions CASCADE`);

    await new PermissionCatalogSyncManager(new IamRepository(database), database).sync();

    await permissionCache.refresh();

    await database.db.execute(sql`
      INSERT INTO user_roles (user_id, role_id)
      SELECT id, role_id FROM users CROSS JOIN roles
      WHERE (users.id = ${master} AND roles.name = 'master')
         OR (users.id <> ${master} AND roles.name = 'admin')
    `);

    await database.db.execute(
      sql`INSERT INTO attendance_worksites (id, name, latitude, longitude, radius_meters, accuracy_meters) VALUES (${site}, '본사', '37.5', '127', 150, 50)`,
    );
  });

  it('keeps the staff set equal to admin and master holders under the first-grant permissions', async () => {
    expect(permissionCache.rolesHolding('attendance.own.write')).toEqual(['admin', 'master']);
    expect(permissionCache.rolesHolding('attendance.request.review')).toEqual(['master']);

    const intern = '00000000-0000-4000-8000-000000000011';
    const expired = '00000000-0000-4000-8000-000000000012';
    const dormant = '00000000-0000-4000-8000-000000000013';

    await database.db.execute(sql`
      INSERT INTO users (id, login_id, username, nickname, email, dormant_at) VALUES
      (${intern}, 'intern', '인턴', 'intern', 'intern@example.test', NULL),
      (${expired}, 'expired', '만료', 'expired', 'expired@example.test', NULL),
      (${dormant}, 'dormant', '휴면', 'dormant', 'dormant@example.test', now())
    `);

    await database.db.execute(sql`
      INSERT INTO user_roles (user_id, role_id, expires_at)
      SELECT u.id, r.role_id, CASE WHEN u.id = ${expired} THEN now() - interval '1 day' ELSE NULL END
      FROM users u JOIN roles r ON
        (u.id = ${intern} AND r.name = 'intern') OR (u.id IN (${expired}, ${dormant}) AND r.name = 'admin')
    `);

    const legacy = await database.db.execute<{ id: string }>(sql`
      SELECT DISTINCT u.id FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.role_id = ur.role_id
      WHERE r.name IN ('admin', 'master') AND u.deleted_at IS NULL AND u.dormant_at IS NULL
        AND (ur.expires_at IS NULL OR ur.expires_at > now())
    `);
    const legacyIds = [...legacy].map((row) => row.id).sort();

    const staffIds = (await repo.staff()).map((person) => person.userId).sort();

    expect(staffIds).toEqual(legacyIds);
    expect(staffIds).toEqual([owner, other, master].sort());

    for (const id of [owner, other, master]) {
      await expect(repo.isActiveStaff(id)).resolves.toBe(true);
    }

    for (const id of [intern, expired, dormant]) {
      await expect(repo.isActiveStaff(id)).resolves.toBe(false);
    }

    expect((await repo.holdersOf('attendance.request.review')).map((person) => person.userId)).toEqual([master]);
  });

  it('follows grants changed after the first registration', async () => {
    const intern = '00000000-0000-4000-8000-000000000011';

    await database.db.execute(sql`
      INSERT INTO users (id, login_id, username, nickname, email)
      VALUES (${intern}, 'intern', '인턴', 'intern', 'intern@example.test')
    `);
    await database.db.execute(sql`
      INSERT INTO user_roles (user_id, role_id) SELECT ${intern}, role_id FROM roles WHERE name = 'intern'
    `);

    // intern 에게 근태 직원 권한을, admin 에게 검토 권한을 주고 admin 의 근태 직원 권한은 거둔다.
    await database.db.execute(sql`
      INSERT INTO iam_role_permissions (role_id, permission_key)
      SELECT role_id, 'attendance.own.write' FROM roles WHERE name = 'intern'
      UNION ALL SELECT role_id, 'attendance.request.review' FROM roles WHERE name = 'admin'
    `);
    await database.db.execute(sql`
      DELETE FROM iam_role_permissions
      WHERE permission_key = 'attendance.own.write' AND role_id = (SELECT role_id FROM roles WHERE name = 'admin')
    `);

    await permissionCache.refresh();

    expect((await repo.staff()).map((person) => person.userId).sort()).toEqual([intern, master].sort());
    await expect(repo.isActiveStaff(owner)).resolves.toBe(false);
    await expect(repo.isActiveStaff(intern)).resolves.toBe(true);
    expect((await repo.holdersOf('attendance.request.review')).map((person) => person.userId).sort()).toEqual(
      [owner, other, master].sort(),
    );
  });

  it('filters sessions by work-date month and includes staff with no records', async () => {
    await database.db.execute(sql`
      INSERT INTO attendance_sessions (user_id, work_date, check_in, check_out) VALUES
      (${owner}, '2026-09-30', '2026-09-30T13:00:00Z', '2026-09-30T17:00:00Z'),
      (${owner}, '2026-10-31', '2026-10-31T13:00:00Z', '2026-10-31T17:00:00Z'),
      (${owner}, '2026-11-01', '2026-11-01T00:00:00Z', '2026-11-01T09:00:00Z')
    `);

    const statistics = await new AttendanceStatisticsService(repo).monthly('2026-10');
    const person = statistics.people.find((item) => item.userId === owner);

    expect(person).toMatchObject({ recordedDays: 1, completedDays: 1, recordedMinutes: 240 });
    expect(statistics.people.find((item) => item.userId === other)).toMatchObject({ recordedDays: 0 });
    expect(statistics.totals.employeeCount).toBe(3);
  });

  function punch(kind: 'in' | 'out', requestId: string, now: Date) {
    return {
      kind,
      requestId,
      siteId: site,
      location: { latitude: 37.5, longitude: 127, accuracy: 10, timestamp: now.getTime() },
    };
  }

  it('schedules a changed checkout reminder again on the same day without duplicating the same time', async () => {
    const settings = { ...(await repo.settings(owner)), outEnabled: true, outTime: '16:52' };

    await database.db.insert(attendancePreferences).values({ userId: owner, settings });
    await database.db.execute(sql`
      INSERT INTO attendance_sessions (user_id, work_date, check_in)
      VALUES (${owner}, '2026-10-19', '2026-10-19T00:00:00Z')
    `);

    const worker = new AttendanceJobsService(repo) as unknown as {
      scheduleReminders: (now: Date) => Promise<void>;
    };

    await worker.scheduleReminders(new Date('2026-10-19T16:52:00+09:00'));
    await database.db.update(attendanceJobs).set({ status: 'done' });
    await database.db
      .update(attendancePreferences)
      .set({ settings: { ...settings, outTime: '17:01' } })
      .where(eq(attendancePreferences.userId, owner));

    await worker.scheduleReminders(new Date('2026-10-19T17:01:00+09:00'));
    await worker.scheduleReminders(new Date('2026-10-19T17:01:30+09:00'));

    const jobs = await database.db.select().from(attendanceJobs).where(eq(attendanceJobs.userId, owner));

    expect(jobs).toHaveLength(2);
    expect(jobs.map((job) => job.payload.clock).sort()).toEqual(['16:52', '17:01']);
    expect(jobs.filter((job) => job.status === 'done')).toHaveLength(1);
  });

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

  it('persists recurring leave and D-day while preserving metadata on a single-day edit', async () => {
    const recurrence = { frequency: 'weekly' as const, until: '2026-10-30' };
    const rows = await calendar.save(owner, [{ date: '2026-10-16', type: 'full' }], {
      recurrence,
      showDday: true,
    });

    expect(rows.map((row) => row.date)).toEqual(['2026-10-16', '2026-10-23', '2026-10-30']);
    expect(new Set(rows.map((row) => row.seriesId)).size).toBe(1);
    expect(rows[0].seriesId).toEqual(expect.any(String));

    const listed = await calendar.list('2026-10-16', '2026-10-30');

    expect(listed).toHaveLength(3);
    expect(listed.every((row) => row.showDday && row.recurrence?.frequency === 'weekly')).toBe(true);

    const changed = await calendar.update(owner, rows[0].id, {
      date: '2026-10-16',
      type: 'am',
      start: '13:00',
      end: '18:00',
    });

    expect(changed).toMatchObject({ recurrence, seriesId: rows[0].seriesId, showDday: true });

    const hidden = await calendar.update(owner, rows[0].id, { date: '2026-10-16', type: 'full', showDday: false });

    expect(hidden).toMatchObject({ recurrence, seriesId: rows[0].seriesId, showDday: false });
    await expect(
      calendar.update(other, rows[1].id, { date: '2026-10-23', type: 'full', showDday: false }),
    ).rejects.toThrow();
  });

  it('preserves existing dates when adding a recurring vacation', async () => {
    const [existing] = await calendar.save(owner, [{ date: '2026-10-23', type: 'full', showDday: false }]);

    await calendar.save(owner, [{ date: '2026-10-16', type: 'am', start: '13:00', end: '18:00' }], {
      recurrence: { frequency: 'weekly', until: '2026-10-30' },
      showDday: true,
    });

    const rows = await calendar.list('2026-10-16', '2026-10-30');

    expect(rows[1]).toMatchObject({ id: existing.id, type: 'full', showDday: false, recurrence: null });
  });

  it('stores reminders only on the first day of each repeated vacation and supports clearing them', async () => {
    const rows = await calendar.save(
      owner,
      [
        { date: '2030-10-16', type: 'full' },
        { date: '2030-10-17', type: 'full' },
      ],
      {
        recurrence: { frequency: 'weekly', until: '2030-10-23' },
        reminderMinutes: [10, 60],
      },
    );

    expect(rows.map((row) => row.reminderMinutes)).toEqual([[10, 60], [], [10, 60], []]);

    const listed = await calendar.list('2030-10-16', '2030-10-24');

    expect(listed[0].reminderMinutes).toEqual([10, 60]);

    const preserved = await calendar.update(owner, rows[0].id, { date: '2030-10-16', type: 'full', showDday: true });

    expect(preserved.reminderMinutes).toEqual([10, 60]);

    const cleared = await calendar.update(owner, rows[0].id, { date: '2030-10-16', type: 'full', reminderMinutes: [] });

    expect(cleared.reminderMinutes).toEqual([]);
    expect(cleared.reminderSetAt).toBeNull();
  });

  it('deduplicates vacation jobs and sends through the push transport while rechecking cancelled alerts', async () => {
    const now = new Date();
    const date = seoulDate(new Date(now.getTime() + 86400000));
    const start = new Date(`${date}T09:00:00+09:00`);
    const due = Math.floor(now.getTime() / 60000) * 60000;
    const minutes = (start.getTime() - due) / 60000;
    const [leave] = await calendar.save(owner, [{ date, type: 'full' }], { reminderMinutes: [minutes] });

    await database.db
      .update(attendanceLeaves)
      .set({ reminderSetAt: new Date(due - 60000) })
      .where(eq(attendanceLeaves.id, leave.id));

    let sentPayload: unknown;
    let sends = 0;
    const server = createServer((request, response) => {
      let body = '';

      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });
      request.on('end', () => {
        sentPayload = JSON.parse(body) as unknown;
        sends++;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{}');
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

    const address = server.address();

    if (!address || typeof address === 'string') {
      throw new Error('The local notification fixture did not open a TCP port.');
    }

    const originalUrl = process.env.NOTIFICATION_SERVICE_URL;
    const originalKey = process.env.NOTIFICATION_INTERNAL_KEY;

    process.env.NOTIFICATION_SERVICE_URL = `http://127.0.0.1:${address.port}`;
    process.env.NOTIFICATION_INTERNAL_KEY = 'isolated-integration-key';

    try {
      const worker = new AttendanceJobsService(repo) as unknown as {
        scheduleVacationReminders: (now: Date) => Promise<void>;
        run: (job: typeof attendanceJobs.$inferSelect) => Promise<void>;
      };

      await worker.scheduleVacationReminders(now);
      await worker.scheduleVacationReminders(now);

      const jobs = await database.db.select().from(attendanceJobs).where(eq(attendanceJobs.kind, 'leave-reminder'));

      expect(jobs).toHaveLength(1);

      await worker.run(jobs[0]);

      expect(sends).toBe(1);
      expect(sentPayload).toMatchObject({ userId: owner, title: '휴가 일정 알림', url: '/attendance/calendar' });

      await calendar.update(owner, leave.id, { date, type: 'full', reminderMinutes: [] });
      await worker.run(jobs[0]);

      expect(sends).toBe(1);
    } finally {
      if (originalUrl === undefined) {
        delete process.env.NOTIFICATION_SERVICE_URL;
      } else {
        process.env.NOTIFICATION_SERVICE_URL = originalUrl;
      }

      if (originalKey === undefined) {
        delete process.env.NOTIFICATION_INTERNAL_KEY;
      } else {
        process.env.NOTIFICATION_INTERNAL_KEY = originalKey;
      }

      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('shares multiple staff schedules while only permitting the owner to edit or remove each leave', async () => {
    const [ownLeave] = await calendar.save(owner, [{ date: '2026-10-16', type: 'full' }]);
    const [otherLeave] = await calendar.save(other, [{ date: '2026-10-16', type: 'am', start: '13:00', end: '18:00' }]);

    const controller = new AttendanceController(service, repo, calendar, createCheckpointsForTesting());
    const shared = await controller.calendarList('2026-10-16', '2026-10-16');

    expect(shared).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ownLeave.id, userId: owner, name: '직원하나' }),
        expect.objectContaining({ id: otherLeave.id, userId: other, name: '직원둘' }),
      ]),
    );
    expect(shared).toHaveLength(2);
    expect(Object.keys(shared[0]).sort()).toEqual([
      'date',
      'end',
      'id',
      'name',
      'recurrence',
      'reminderMinutes',
      'seriesId',
      'showDday',
      'start',
      'type',
      'userId',
    ]);

    await expect(calendar.update(owner, otherLeave.id, { date: otherLeave.date, type: 'full' })).rejects.toThrow();
    await expect(calendar.remove(owner, otherLeave.id)).rejects.toThrow();
    await expect(calendar.remove(master, otherLeave.id)).rejects.toThrow();

    await calendar.remove(owner, ownLeave.id);

    expect(await calendar.list('2026-10-16', '2026-10-16')).toEqual([
      expect.objectContaining({ id: otherLeave.id, userId: other, type: 'am' }),
    ]);
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
      requests.decide(master, true, request.id, { version: 1, status: 'approved', reason: '확인' }),
      requests.decide(master, true, request.id, { version: 1, status: 'approved', reason: '재시도' }),
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
      requests.decide(master, true, request.id, { version: 1, status: 'approved', reason: '' }),
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
      requests.decide(master, true, request.id, { version: 2, status: 'approved', reason: '' }),
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

    const controller = new AttendanceController(service, repo, calendar, createCheckpointsForTesting());
    const masterUser = { id: master, roles: ['master'] } as JwtPayload;
    const otherUser = { id: other, roles: ['admin'] } as JwtPayload;

    const rows = await controller.records(masterUser, owner);

    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(owner);

    await expect(controller.records(otherUser, owner)).rejects.toThrow();
    expect(await controller.records(otherUser)).toHaveLength(0);
  });

  it('versions worksite corrections and rejects punches at a disabled site', async () => {
    const controller = new AttendanceController(service, repo, calendar, createCheckpointsForTesting());
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

    // Metadata inspection reads the method reference without invoking it or losing its receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.updateSite)).toContain(MasterRoleGuard);

    const changed = await controller.updateSite(masterUser, site, input);

    expect(changed).toMatchObject({ active: false, version: 2 });
    await expect(controller.updateSite(masterUser, site, input)).rejects.toThrow();

    const now = new Date('2026-10-15T00:00:00Z');

    await expect(service.punch(owner, punch('in', '00000000-0000-4000-8000-000000000017', now), now)).rejects.toThrow();

    expect(await repo.records(owner)).toHaveLength(0);
  });

  describe('AI worker retry and request version boundaries', () => {
    const environmentNames = ['AI_SERVICE_URL', 'AI_INTERNAL_KEY', 'APP_STAGE'] as const;
    const attendanceAiResponse = {
      result: {
        summary: '출근 누락 사유와 제시된 근무 시각을 함께 검토해 주세요.',
        evidence: ['직원이 실제 출근 시각을 제출했습니다.'],
        questions: [],
        opinion: 'reviewable',
      },
      model: 'integration-review-model',
      promptVersion: 'attendance-review-v1',
    };

    let originalEnvironment: Record<string, string | undefined>;
    let fetchSpy: jest.SpiedFunction<typeof fetch>;

    beforeEach(() => {
      originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));

      process.env.AI_SERVICE_URL = 'http://attendance-ai.test';
      process.env.AI_INTERNAL_KEY = 'test-key';
      process.env.APP_STAGE = 'test';

      fetchSpy = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected external request'));
    });

    afterEach(() => {
      fetchSpy.mockRestore();

      for (const name of environmentNames) {
        const original = originalEnvironment[name];

        if (original === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = original;
        }
      }
    });

    it('preserves records after AI 503, permits manual decisions and persists a successful retry with its audit', async () => {
      const retryRequest = await requests.create(owner, {
        workDate: '2026-10-15',
        checkIn: '2026-10-15T00:00:00Z',
        reason: '출근 기록 누락',
      });
      const manualRequest = await requests.create(other, {
        workDate: '2026-10-15',
        checkIn: '2026-10-15T01:00:00Z',
        reason: '출근 기록 수동 확인 요청',
      });

      await database.db.execute(sql`DELETE FROM attendance_jobs WHERE kind <> 'ai'`);

      // Keep eligibility independent of small database/application clock offsets.
      await database.db.update(attendanceJobs).set({ runAfter: new Date(Date.now() - 1000) });

      fetchSpy.mockImplementation(() => Promise.resolve(new Response('Service unavailable', { status: 503 })));

      const worker = new AttendanceJobsService(repo);

      await worker.tick();

      const failedAttempts = await database.db.select().from(attendanceJobs);
      const pendingRequests = await database.db.select().from(attendanceRequests);

      expect(failedAttempts).toHaveLength(2);
      expect(failedAttempts.every((job) => job.status === 'pending' && job.attempts === 1)).toBe(true);
      expect(pendingRequests.every((request) => request.status === 'pending' && request.aiResult === null)).toBe(true);
      expect(await repo.records(owner)).toHaveLength(0);
      expect(await repo.records(other)).toHaveLength(0);
      expect(
        await database.db.select().from(attendanceAudit).where(eq(attendanceAudit.kind, 'request.ai_reviewed')),
      ).toHaveLength(0);

      const decision = await requests.decide(master, true, manualRequest.id, {
        version: 1,
        status: 'approved',
        reason: 'AI 응답 지연 중 담당자가 실제 근무를 확인했습니다.',
      });

      expect(decision).toMatchObject({ status: 'approved', version: 2 });
      expect(await repo.records(other)).toHaveLength(1);

      await database.db.update(attendanceJobs).set({ runAfter: new Date(Date.now() + 60_000) });

      await database.db
        .update(attendanceJobs)
        .set({ runAfter: new Date(Date.now() - 1000) })
        .where(eq(attendanceJobs.key, `ai:${retryRequest.id}:1`));

      fetchSpy.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: attendanceAiResponse }))));

      await worker.tick();

      const [reviewed] = await database.db
        .select()
        .from(attendanceRequests)
        .where(eq(attendanceRequests.id, retryRequest.id));
      const [retriedJob] = await database.db
        .select()
        .from(attendanceJobs)
        .where(eq(attendanceJobs.key, `ai:${retryRequest.id}:1`));
      const audit = await database.db
        .select()
        .from(attendanceAudit)
        .where(and(eq(attendanceAudit.entityId, retryRequest.id), eq(attendanceAudit.kind, 'request.ai_reviewed')));

      expect(reviewed).toMatchObject({
        status: 'pending',
        version: 1,
        aiStatus: 'succeeded',
        aiResult: attendanceAiResponse.result,
      });
      expect(retriedJob).toMatchObject({ status: 'done', attempts: 2, leaseUntil: null });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        actorId: owner,
        subjectId: owner,
        after: {
          inputVersion: 1,
          model: 'integration-review-model',
          promptVersion: 'attendance-review-v1',
          result: attendanceAiResponse.result,
        },
      });
      expect(await repo.records(owner)).toHaveLength(0);
    });

    it('discards an in-flight AI result after a manual information request and resubmission creates a new version', async () => {
      const request = await requests.create(owner, {
        workDate: '2026-10-15',
        checkIn: '2026-10-15T00:00:00Z',
        reason: '출근 기록 누락',
      });

      await database.db.execute(sql`DELETE FROM attendance_jobs WHERE kind <> 'ai'`);

      await database.db.update(attendanceJobs).set({ runAfter: new Date(Date.now() - 60_000) });

      const [originalJob] = await database.db.select().from(attendanceJobs);

      fetchSpy.mockImplementationOnce(async () => {
        const [running] = await database.db
          .select()
          .from(attendanceRequests)
          .where(eq(attendanceRequests.id, request.id));

        expect(running).toMatchObject({ status: 'pending', version: 1, aiStatus: 'running' });

        await requests.decide(master, true, request.id, {
          version: 1,
          status: 'needs_information',
          reason: '누락된 근무 내용을 보완해 주세요.',
        });

        await requests.resubmit(owner, request.id, {
          workDate: '2026-10-15',
          checkIn: '2026-10-15T00:10:00Z',
          reason: '실제 출근 시각과 근무 내용을 보완했습니다.',
        });

        // Keep the next version queued while this tick finishes the previous response.
        await database.db
          .update(attendanceJobs)
          .set({ runAfter: new Date(Date.now() + 60_000) })
          .where(ne(attendanceJobs.id, originalJob.id));

        return new Response(JSON.stringify(attendanceAiResponse));
      });

      await new AttendanceJobsService(repo).tick();

      const [resubmitted] = await database.db
        .select()
        .from(attendanceRequests)
        .where(eq(attendanceRequests.id, request.id));
      const aiJobs = await database.db.select().from(attendanceJobs).where(eq(attendanceJobs.kind, 'ai'));
      const audit = await database.db
        .select()
        .from(attendanceAudit)
        .where(and(eq(attendanceAudit.entityId, request.id), eq(attendanceAudit.kind, 'request.ai_reviewed')));

      expect(resubmitted).toMatchObject({
        status: 'pending',
        version: 3,
        aiStatus: 'queued',
        aiResult: null,
        reason: '실제 출근 시각과 근무 내용을 보완했습니다.',
      });
      expect(resubmitted.checkIn?.toISOString()).toBe('2026-10-15T00:10:00.000Z');
      expect(aiJobs).toHaveLength(2);
      expect(aiJobs.find((job) => job.id === originalJob.id)).toMatchObject({
        status: 'done',
        attempts: 1,
        leaseUntil: null,
      });
      expect(aiJobs.find((job) => job.key === `ai:${request.id}:3`)).toMatchObject({ status: 'pending', attempts: 0 });
      expect(audit).toHaveLength(0);
      expect(await repo.records(owner)).toHaveLength(0);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('retries malformed AI responses without persisting an unvalidated review', async () => {
    await requests.create(owner, {
      workDate: '2026-10-15',
      checkIn: '2026-10-15T00:00:00Z',
      reason: '기록 누락',
    });

    await database.db.execute(sql`DELETE FROM attendance_jobs WHERE kind <> 'ai'`);

    const previousUrl = process.env.AI_SERVICE_URL;
    const previousKey = process.env.AI_INTERNAL_KEY;

    process.env.AI_SERVICE_URL = 'http://attendance-ai.test';
    process.env.AI_INTERNAL_KEY = 'test-key';

    const fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ result: { opinion: 'approved' }, model: 'test', promptVersion: 'v1' })),
      );

    try {
      const worker = new AttendanceJobsService(repo);

      for (let attempt = 0; attempt < 3; attempt++) {
        await database.db.update(attendanceJobs).set({ runAfter: new Date(Date.now() - 1000) });

        // Each response has its own body stream, as a real HTTP retry does.
        fetchSpy.mockResolvedValueOnce(
          new Response(JSON.stringify({ result: { opinion: 'approved' }, model: 'test', promptVersion: 'v1' })),
        );

        await worker.tick();
      }

      const [request] = await database.db.select().from(attendanceRequests);
      const [job] = await database.db.select().from(attendanceJobs);

      expect(request.aiResult).toBeNull();
      expect(request.aiStatus).toBe('failed');
      expect(job).toMatchObject({ status: 'failed', attempts: 3 });
    } finally {
      fetchSpy.mockRestore();

      if (previousUrl === undefined) {
        delete process.env.AI_SERVICE_URL;
      } else {
        process.env.AI_SERVICE_URL = previousUrl;
      }

      if (previousKey === undefined) {
        delete process.env.AI_INTERNAL_KEY;
      } else {
        process.env.AI_INTERNAL_KEY = previousKey;
      }
    }
  });
});
