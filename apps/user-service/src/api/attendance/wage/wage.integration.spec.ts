import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DbService } from '@app/db';
import { BadRequestError, ConflictError, NotFoundError } from '@app/shared';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql } from 'drizzle-orm';
import { userServiceSchema } from '../../../../database/drizzle/schema';
import { AttendanceRepository } from '../repositories/attendance.repository';
import { WageSettingsManager } from './wage-settings.manager';
import { WageSettlementManager } from './wage-settlement.manager';
import { WageSettlementReader } from './wage-settlement.reader';
import { WageRepository } from './wage.repository';

const run = process.env.REQUIRE_ATTENDANCE_DB === '1' ? describe : describe.skip;
const master = '00000000-0000-4000-8000-000000000101';
const first = '00000000-0000-4000-8000-000000000102';
const second = '00000000-0000-4000-8000-000000000103';

/** 근태 직원 = admin 보유자(이 스펙은 급여만 본다 — 권한 사본 경로는 근태 통합 스펙이 지킨다). */
const staffHolders = { rolesHolding: () => ['admin'] };

const WAGE_TABLES = [
  'attendance_pay_groups',
  'attendance_pay_policies',
  'attendance_workers',
  'attendance_wage_rates',
  'attendance_work_schedules',
  'attendance_overtime_decisions',
  'attendance_absence_decisions',
  'attendance_pay_settlements',
  'attendance_minimum_wages',
  'attendance_audit',
];

run('attendance wage against PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let database: DbService<typeof userServiceSchema>;
  let settings: WageSettingsManager;
  let reader: WageSettlementReader;
  let settlements: WageSettlementManager;
  let groupId: string;

  const session = (userId: string, date: string, start: string, end: string | null) =>
    database.db.execute(sql`
      INSERT INTO attendance_sessions (user_id, work_date, check_in, check_out)
      VALUES (${userId}, ${date}, ${`${date}T${start}:00+09:00`}, ${end === null ? null : `${date}T${end}:00+09:00`})
    `);

  const counts = async () => {
    const result: Record<string, number> = {};

    for (const table of WAGE_TABLES) {
      const [row] = await database.db.execute<{ count: number }>(
        sql.raw(`SELECT count(*)::int AS count FROM ${table}`),
      );
      result[table] = row?.count ?? -1;
    }

    return result;
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();

    database = new DbService({ connectionString: container.getConnectionUri() }, userServiceSchema);

    await migrate(database.db, { migrationsFolder: 'apps/user-service/database/drizzle' });

    const repository = new WageRepository(database);
    const attendance = new AttendanceRepository(database, staffHolders);

    settings = new WageSettingsManager(repository);
    reader = new WageSettlementReader(repository, attendance);
    settlements = new WageSettlementManager(repository, reader);
  }, 120000);

  afterAll(async () => {
    await database?.onApplicationShutdown();

    await container?.stop();
  });

  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users, roles, attendance_pay_groups CASCADE`);

    await database.db.execute(sql`
      INSERT INTO users (id, login_id, username, nickname, email) VALUES
      (${master}, 'master', '관리자', 'master', 'master@example.test'),
      (${first}, 'first', '근무자하나', 'first', 'first@example.test'),
      (${second}, 'second', '근무자둘', 'second', 'second@example.test');
    `);

    await database.db.execute(sql`INSERT INTO roles (name) VALUES ('admin'), ('master')`);

    await database.db.execute(sql`
      INSERT INTO user_roles (user_id, role_id)
      SELECT u.id, r.role_id FROM users u JOIN roles r
        ON (u.id = ${master} AND r.name = 'master') OR (u.id <> ${master} AND r.name = 'admin')
    `);

    const group = await settings.createGroup(master, {
      name: '시급제',
      payBasis: 'hourly',
      payday: 23,
      periodCloseDay: 0,
      payMonthOffset: 1,
      rulesEffectiveFrom: '2026-01-01',
    });

    groupId = group.id;

    for (const [userId, hourlyWage] of [
      [first, 10000],
      [second, 12000],
    ] as const) {
      await settings.saveWorker(master, userId, { groupId });
      await settings.addRate(master, userId, { effectiveFrom: '2026-01-01', hourlyWage });
    }

    await session(first, '2026-08-03', '09:00', '13:00');
    await session(second, '2026-08-04', '09:00', '18:00');
  });

  it('confirms a period into a frozen snapshot', async () => {
    const confirmed = await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    expect(confirmed).toMatchObject({ periodStart: '2026-08-01', periodEnd: '2026-08-31', total: 136000 });

    await expect(
      settings.addRate(master, first, { effectiveFrom: '2026-08-01', hourlyWage: 20000 }),
    ).rejects.toBeInstanceOf(ConflictError);

    await settlements.reopen(master, confirmed.id, { reason: '시급 정정' });
    await settings.addRate(master, first, { effectiveFrom: '2026-08-01', hourlyWage: 20000 });

    expect((await reader.preview(groupId, '2026-09')).totals.total).toBe(176000);
    expect((await reader.settlement(confirmed.id)).snapshot.totals.total).toBe(136000);
  });

  it('refuses to confirm while issues remain', async () => {
    await session(first, '2026-08-05', '09:00', null);

    await expect(settlements.confirm(master, { groupId, paydayMonth: '2026-09' })).rejects.toThrow(
      '퇴근 기록 없음 1건',
    );
    await expect(settlements.confirm(master, { groupId, paydayMonth: '2026-09' })).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it('refuses a second confirmation of the same period', async () => {
    await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    await expect(settlements.confirm(master, { groupId, paydayMonth: '2026-09' })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('reopens with a reason and allows a new confirmation', async () => {
    const confirmed = await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    await expect(settlements.reopen(master, confirmed.id, { reason: '  ' })).rejects.toBeInstanceOf(BadRequestError);

    await settlements.reopen(master, confirmed.id, { reason: '근무 기록 정정' });

    await expect(settlements.reopen(master, confirmed.id, { reason: '두 번' })).rejects.toBeInstanceOf(ConflictError);

    const again = await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    expect(again.id).not.toBe(confirmed.id);
  });

  it('shows a worker only their own pay and hides others as not found', async () => {
    const estimate = await reader.mine(first, '2026-09');

    expect(estimate.status).toBe('estimate');
    expect(estimate.person).toMatchObject({ userId: first, amounts: { total: 40000 } });

    await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    const confirmed = await reader.mine(second, '2026-09');

    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.person).toMatchObject({ userId: second, amounts: { total: 96000 } });
    expect(JSON.stringify(confirmed)).not.toContain(first);

    await expect(reader.mine(master, '2026-09')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lists staff missing from the roster without pricing them', async () => {
    const outsider = '00000000-0000-4000-8000-000000000104';

    await database.db.execute(sql`
      INSERT INTO users (id, login_id, username, nickname, email)
      VALUES (${outsider}, 'outsider', '명단밖', 'outsider', 'outsider@example.test')
    `);
    await database.db.execute(sql`
      INSERT INTO user_roles (user_id, role_id) SELECT ${outsider}, role_id FROM roles WHERE name = 'admin'
    `);

    const result = await reader.preview(groupId, '2026-09');

    expect(result.issues).toEqual([{ userId: outsider, workDate: null, kind: 'not_on_roster' }]);
    expect(result.people.map((person) => person.userId).sort()).toEqual([first, second].sort());
  });

  it('decides overtime once and refuses a stale second decision', async () => {
    await settings.addSchedule(master, first, {
      effectiveFrom: '2026-08-01',
      days: [{ weekday: 1, start: '09:00', end: '12:00', breakMinutes: 0 }],
    });

    const decisions = await reader.decisions(groupId, '2026-09');
    const overtime = decisions.items.find((item) => item.kind === 'overtime' && item.userId === first);

    expect(overtime).toMatchObject({ workDate: '2026-08-03', recordedMinutes: 60, overtime: null });

    await settlements.decideOvertime(master, first, '2026-08-03', {
      status: 'recognized',
      recognizedMinutes: 60,
      recordedMinutes: 60,
    });

    await expect(
      settlements.decideOvertime(master, first, '2026-08-03', {
        status: 'rejected',
        recognizedMinutes: 0,
        recordedMinutes: 60,
        reason: '지시 없음',
      }),
    ).rejects.toBeInstanceOf(ConflictError);

    await settlements.decideOvertime(master, first, '2026-08-03', {
      status: 'rejected',
      recognizedMinutes: 0,
      recordedMinutes: 60,
      reason: '지시 없음',
      version: 1,
    });

    const after = await reader.decisions(groupId, '2026-09');

    expect(after.items.find((item) => item.kind === 'overtime' && item.userId === first)?.overtime).toMatchObject({
      status: 'rejected',
      version: 2,
    });
  });

  it('lets a reopened earlier period be decided while a later one stays confirmed', async () => {
    const august = await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    await settlements.confirm(master, { groupId, paydayMonth: '2026-10' });
    await settlements.reopen(master, august.id, { reason: '부재 정정' });

    await expect(
      settlements.decideAbsence(master, first, '2026-08-05', { kind: 'excused_unpaid' }),
    ).resolves.toBeUndefined();
    await expect(
      settlements.decideAbsence(master, first, '2026-09-08', { kind: 'excused_unpaid' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses to pay the same period twice after a worker moves between groups', async () => {
    await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    const other = await settings.createGroup(master, {
      name: '다른 그룹',
      payBasis: 'hourly',
      payday: 23,
      periodCloseDay: 0,
      payMonthOffset: 1,
      rulesEffectiveFrom: '2026-01-01',
    });

    await settings.saveWorker(master, first, { groupId: other.id, version: 1 });

    await expect(settlements.confirm(master, { groupId: other.id, paydayMonth: '2026-09' })).rejects.toThrow(
      '근무자하나',
    );

    const mine = await reader.mine(first, '2026-09');

    expect(mine).toMatchObject({ status: 'confirmed', person: { userId: first, amounts: { total: 40000 } } });
  });

  it('serializes a confirmation and a rate change in the same group', async () => {
    const [confirmed, rate] = await Promise.allSettled([
      settlements.confirm(master, { groupId, paydayMonth: '2026-09' }),
      settings.addRate(master, first, { effectiveFrom: '2026-08-01', hourlyWage: 20000 }),
    ]);

    // 둘 다 성공했다면 시급 변경이 먼저 커밋되고 확정이 그 값을 읽었어야 한다.
    if (confirmed.status === 'fulfilled' && rate.status === 'fulfilled') {
      expect(confirmed.value.total).toBe(176000);
    } else {
      expect([confirmed.status, rate.status].sort()).toEqual(['fulfilled', 'rejected']);
    }
  });

  it('tells a worker which of their days could not be computed yet', async () => {
    await session(first, '2026-08-05', '09:00', null);

    const mine = await reader.mine(first, '2026-09');

    expect(mine.status).toBe('estimate');
    expect(mine.issues).toEqual([{ userId: first, workDate: '2026-08-05', kind: 'missing_checkout' }]);
  });

  it('rejects a second schedule starting the same day at the database', async () => {
    await settings.addSchedule(master, first, {
      effectiveFrom: '2026-08-01',
      days: [{ weekday: 1, start: '09:00', end: '13:00' }],
    });

    await expect(
      database.db.execute(sql`
        INSERT INTO attendance_work_schedules (user_id, effective_from, days, created_by)
        VALUES (${first}, '2026-08-01', '[]'::jsonb, ${master})
      `),
    ).rejects.toThrow();
  });

  it('corrects a contracted rate and blocks the correction once the period is confirmed', async () => {
    const worker = await reader.mine(first, '2026-09');

    expect(worker.person?.amounts?.total).toBe(40000);

    const repository = new WageRepository(database);
    const [rate] = await repository.rates([first]);

    await settings.updateRate(master, first, rate?.id ?? '', { hourlyWage: 11000 });

    expect((await reader.mine(first, '2026-09')).person?.amounts?.total).toBe(44000);

    await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    await expect(settings.updateRate(master, first, rate?.id ?? '', { hourlyWage: 12000 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(settings.deleteRate(master, first, rate?.id ?? '')).rejects.toBeInstanceOf(ConflictError);
  });

  it('turns a decision back into an open question', async () => {
    await settings.addSchedule(master, first, {
      effectiveFrom: '2026-08-01',
      days: [{ weekday: 1, start: '09:00', end: '12:00', breakMinutes: 0 }],
    });
    await settlements.decideOvertime(master, first, '2026-08-03', {
      status: 'recognized',
      recognizedMinutes: 60,
      recordedMinutes: 60,
    });

    await settlements.clearDecision(master, 'overtime', first, '2026-08-03');

    expect((await reader.preview(groupId, '2026-09')).issues).toContainEqual({
      userId: first,
      workDate: '2026-08-03',
      kind: 'overtime_undecided',
    });
    await expect(settlements.clearDecision(master, 'overtime', first, '2026-08-03')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('deletes only a group nothing depends on', async () => {
    await expect(settings.deleteGroup(master, groupId)).rejects.toBeInstanceOf(ConflictError);

    const spare = await settings.createGroup(master, {
      name: '빈 그룹',
      payBasis: 'hourly',
      payday: 10,
      periodCloseDay: 0,
      payMonthOffset: 1,
    });

    await settings.deleteGroup(master, spare.id);

    const [row] = await database.db.execute<{ count: number }>(
      sql`SELECT count(*)::int AS count FROM attendance_pay_groups WHERE id = ${spare.id}`,
    );

    expect(row?.count).toBe(0);
  });

  it('keeps a period confirmed in the previous group frozen after the worker moves', async () => {
    await settlements.decideAbsence(master, first, '2026-08-05', { kind: 'excused_unpaid' });
    await settlements.confirm(master, { groupId, paydayMonth: '2026-09' });

    const other = await settings.createGroup(master, {
      name: '옮길 그룹',
      payBasis: 'hourly',
      payday: 23,
      periodCloseDay: 0,
      payMonthOffset: 1,
    });

    await settings.saveWorker(master, first, { groupId: other.id, version: 1 });

    const [rate] = await new WageRepository(database).rates([first]);

    await expect(settings.updateRate(master, first, rate?.id ?? '', { hourlyWage: 20000 })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(settlements.clearDecision(master, 'absence', first, '2026-08-05')).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it('keeps the read path free of writes', async () => {
    const before = await counts();

    await reader.preview(groupId, '2026-09');
    await reader.decisions(groupId, '2026-09');
    await reader.mine(first, '2026-09');

    expect(await counts()).toEqual(before);
  });
});
