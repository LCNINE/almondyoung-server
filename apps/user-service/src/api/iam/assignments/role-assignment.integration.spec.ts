import { DbService } from '@app/db';
import {
  iamAuditLogs,
  roles,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { and, count, eq, inArray, isNull, like, notLike } from 'drizzle-orm';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import { IamAuditRepository } from '../audit/iam-audit.repository';
import { SYSTEM_ROLE_NAME } from '../iam.constants';
import { IamLastMasterError } from '../iam.errors';
import { IamRepository } from '../iam.repository';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository } from '../roles/role.repository';
import { RoleAssignmentManager } from './role-assignment.manager';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzp4';

describeIfDb('role assignments against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let manager: RoleAssignmentManager;

  const roleId = async (name: string) => {
    const [found] = await dbService.db.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));
    if (found) return found.id;
    const [made] = await dbService.db.insert(roles).values({ name }).returning({ id: roles.roleId });
    return made.id;
  };
  const makeUser = async (suffix: string) => {
    const [row] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
      })
      .returning({ id: users.id });
    return row.id;
  };
  const actor = (userId: string) => ({
    userId,
    loginId: null,
    roles: [SYSTEM_ROLE_NAME],
    userAgent: null,
    requestId: null,
    ip: null,
  });
  const cleanup = async () => {
    const ids = (
      await dbService.db
        .select({ id: users.id })
        .from(users)
        .where(like(users.loginId, `${PREFIX}%`))
    ).map((u) => u.id);
    if (ids.length > 0) await dbService.db.delete(iamAuditLogs).where(inArray(iamAuditLogs.targetId, ids));
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    const iam = new IamRepository(dbService);
    const snapshots = new RolePermissionsReader(iam);
    manager = new RoleAssignmentManager(
      dbService,
      new RoleRepository(dbService),
      new IamAuditCreator(new IamAuditRepository(dbService)),
      new MyPermissionsReader(snapshots, iam),
      snapshots,
    );
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('serializes changes to the system role so the last permanent holder survives', async () => {
    const system = await roleId(SYSTEM_ROLE_NAME);
    const [others] = await dbService.db
      .select({ n: count() })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(
        and(
          eq(userRoleAssignments.roleId, system),
          isNull(userRoleAssignments.expiresAt),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
          notLike(users.loginId, `${PREFIX}%`),
        ),
      );
    if (Number(others?.n ?? 0) > 0) {
      // 다른 무기한 보유자가 있으면 «둘 다 성공»이 정답이라 이 경합을 볼 수 없다 — 남의 데이터는 바꾸지 않는다.
      console.warn('skipped: this database already has a permanent system-role holder; use a scratch database');
      return;
    }
    const a = await makeUser('a');
    const b = await makeUser('b');
    await dbService.db.insert(userRoleAssignments).values([
      { userId: a, roleId: system },
      { userId: b, roleId: system },
    ]);

    // 다른 요청이 시스템 역할 행을 잡고 있는 동안 회수 요청은 기다려야 하고, 그 요청이 다른 보유자를 회수한 뒤에는
    // 마지막 보유자를 지키려고 거절해야 한다. 잠금이 없으면 기다리지 않고 둘 다 회수해 0명이 된다.
    let settled = false;
    let outcome: unknown;
    await dbService.db.transaction(async (tx) => {
      await tx.select().from(roles).where(eq(roles.roleId, system)).for('update');
      const pending = manager.replaceStaff(actor(a), b, []).then(
        () => (outcome = 'saved'),
        (error: unknown) => (outcome = error),
      );
      void pending.finally(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await tx
        .delete(userRoleAssignments)
        .where(and(eq(userRoleAssignments.userId, a), eq(userRoleAssignments.roleId, system)));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 50 && !settled; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    expect(outcome).toBeInstanceOf(IamLastMasterError);
    const [left] = await dbService.db
      .select({ n: count() })
      .from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.roleId, system), inArray(userRoleAssignments.userId, [a, b])));
    expect(Number(left?.n)).toBe(1);
  });

  it('lets only one of the last two permanent holders withdraw at the same time', async () => {
    const system = await roleId(SYSTEM_ROLE_NAME);
    const [others] = await dbService.db
      .select({ n: count() })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .where(
        and(
          eq(userRoleAssignments.roleId, system),
          isNull(userRoleAssignments.expiresAt),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
          notLike(users.loginId, `${PREFIX}%`),
        ),
      );
    if (Number(others?.n ?? 0) > 0) {
      console.warn('skipped: this database already has a permanent system-role holder; use a scratch database');
      return;
    }
    const a = await makeUser('wa');
    const b = await makeUser('wb');
    await dbService.db.insert(userRoleAssignments).values([
      { userId: a, roleId: system },
      { userId: b, roleId: system },
    ]);
    const withdraw = (tx: Parameters<Parameters<typeof dbService.run>[0]>[0], userId: string) =>
      tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));

    // 앞 탈퇴가 검사(잠금)를 마치고 익명화 중인 동안 뒤 탈퇴는 기다려야 하고, 앞이 커밋되면 거절돼야 한다.
    let settled = false;
    let outcome: unknown;
    await dbService.run(async (tx) => {
      await manager.assertCanLeave(a, tx);
      const pending = dbService
        .run(async (tx2) => {
          await manager.assertCanLeave(b, tx2);
          await withdraw(tx2, b);
        })
        .then(
          () => (outcome = 'withdrawn'),
          (error: unknown) => (outcome = error),
        );
      void pending.finally(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await withdraw(tx, a);
    });
    for (let i = 0; i < 50 && !settled; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    expect(outcome).toBeInstanceOf(IamLastMasterError);
    const [b_] = await dbService.db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, b));
    expect(b_?.deletedAt).toBeNull();
  });

  it('keeps the end date and assignment time of a role the save did not change', async () => {
    const boss = await makeUser('boss');
    const target = await makeUser('c');
    const intern = await roleId('intern');
    const membership = await roleId('membership');
    const admin = await roleId('admin');
    const end = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await dbService.db.insert(userRoleAssignments).values([
      { userId: target, roleId: intern, expiresAt: end },
      { userId: target, roleId: membership },
    ]);
    const [before] = await dbService.db
      .select({ assignedAt: userRoleAssignments.assignedAt, expiresAt: userRoleAssignments.expiresAt })
      .from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, target), eq(userRoleAssignments.roleId, intern)));

    await manager.replaceAll(actor(boss), target, [intern, membership, admin]);

    const rows = await dbService.db
      .select({
        roleId: userRoleAssignments.roleId,
        assignedAt: userRoleAssignments.assignedAt,
        expiresAt: userRoleAssignments.expiresAt,
      })
      .from(userRoleAssignments)
      .where(eq(userRoleAssignments.userId, target));
    const kept = rows.find((r) => r.roleId === intern);
    expect(kept?.expiresAt?.getTime()).toBe(before.expiresAt?.getTime());
    expect(kept?.assignedAt.getTime()).toBe(before.assignedAt.getTime());
    expect(rows).toHaveLength(3);
    const history = await dbService.db.select().from(iamAuditLogs).where(eq(iamAuditLogs.targetId, target));
    expect(history).toHaveLength(1);
    expect(history[0].action).toBe('user.roles.replace');
  });
});
