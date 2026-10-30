import { DbService } from '@app/db';
import {
  iamAuditLogs,
  roles,
  tenantMemberships,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { and, count, eq, inArray, isNull, like, notLike } from 'drizzle-orm';
import { IamAuditCreator } from '../audit/iam-audit.creator';
import { IamAuditRepository } from '../audit/iam-audit.repository';
import { SYSTEM_ROLE_NAME } from '../iam.constants';
import { IamLastOperatorError } from '../iam.errors';
import { IamRepository } from '../iam.repository';
import { MyPermissionsReader } from '../my-permissions.reader';
import { RolePermissionsReader } from '../role-permissions.reader';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { PlatformOperatorManager } from '../tenancy/platform-operator.manager';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { RoleAssignmentManager } from './role-assignment.manager';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// 경합을 볼 수 없는 DB 에서 조용히 초록이 되지 않게 — 반드시 돌려야 하는 실행이면 실패로 알린다.
const cannotObserve = (reason: string): true => {
  if (process.env.REQUIRE_USER_SERVICE_DB === '1') throw new Error(`${reason} — use a scratch database`);
  console.warn(`skipped: ${reason}; use a scratch database`);
  return true;
};

const PREFIX = 'zzp4';

describeIfDb('role assignments against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let manager: RoleAssignmentManager;
  let operators: PlatformOperatorManager;

  const roleId = async (name: string) => {
    const [found] = await dbService.db.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));
    if (found) return found.id;
    const [made] = await dbService.db.insert(roles).values({ name }).returning({ id: roles.roleId });
    return made.id;
  };
  const makeUser = async (suffix: string, isPlatformOperator = false) => {
    const [row] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
        isPlatformOperator,
      })
      .returning({ id: users.id });
    return row.id;
  };
  // 테넌트 1 행은 백필 마이그가 만든다.
  const joinTenantOne = (userId: string) => dbService.db.insert(tenantMemberships).values({ userId, tenantId: '1' });
  const otherSignInOperators = async () => {
    const [row] = await dbService.db
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.isPlatformOperator, true),
          isNull(users.deletedAt),
          isNull(users.dormantAt),
          notLike(users.loginId, `${PREFIX}%`),
        ),
      );
    return Number(row?.n ?? 0);
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
    const roleRepository = new RoleRepository(dbService);
    const tenancy = new TenancyRepository(dbService);
    const audit = new IamAuditCreator(new IamAuditRepository(dbService));
    manager = new RoleAssignmentManager(
      dbService,
      roleRepository,
      audit,
      new MyPermissionsReader(snapshots, iam),
      snapshots,
      tenancy,
      new ActorTenantReader(tenancy),
    );
    operators = new PlatformOperatorManager(dbService, tenancy, roleRepository, audit);
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('serializes operator demotions so the last operator who can sign in survives', async () => {
    // 다른 운영자가 있으면 «둘 다 성공»이 정답이라 이 경합을 볼 수 없다 — 남의 데이터는 바꾸지 않는다.
    if ((await otherSignInOperators()) > 0 && cannotObserve('this database already has a platform operator')) return;
    const a = await makeUser('a', true);
    const b = await makeUser('b', true);

    // 다른 요청이 운영자 행을 잡고 있는 동안 강등 요청은 기다려야 하고, 그 요청이 다른 운영자를 강등한 뒤에는
    // 마지막 운영자를 지키려고 거절해야 한다. 잠금이 없으면 기다리지 않고 둘 다 강등해 0명이 된다.
    let settled = false;
    let outcome: unknown;
    await dbService.db.transaction(async (tx) => {
      await tx.select({ id: users.id }).from(users).where(eq(users.isPlatformOperator, true)).for('update');
      const pending = operators.setOperator(actor(a), b, false).then(
        () => (outcome = 'saved'),
        (error: unknown) => (outcome = error),
      );
      void pending.finally(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);
      await tx.update(users).set({ isPlatformOperator: false }).where(eq(users.id, a));
    });
    for (let i = 0; i < 50 && !settled; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    expect(outcome).toBeInstanceOf(IamLastOperatorError);
    const [b_] = await dbService.db.select({ op: users.isPlatformOperator }).from(users).where(eq(users.id, b));
    expect(b_?.op).toBe(true);
  });

  it('lets only one of the last two operators withdraw at the same time', async () => {
    if ((await otherSignInOperators()) > 0 && cannotObserve('this database already has a platform operator')) return;
    const a = await makeUser('wa', true);
    const b = await makeUser('wb', true);
    const withdraw = (tx: Parameters<Parameters<typeof dbService.run>[0]>[0], userId: string) =>
      tx.update(users).set({ deletedAt: new Date() }).where(eq(users.id, userId));

    // 앞 탈퇴가 검사(잠금)를 마치고 익명화 중인 동안 뒤 탈퇴는 기다려야 하고, 앞이 커밋되면 거절돼야 한다.
    let settled = false;
    let outcome: unknown;
    await dbService.run(async (tx) => {
      await operators.assertCanLeave(a, tx);
      const pending = dbService
        .run(async (tx2) => {
          await operators.assertCanLeave(b, tx2);
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

    expect(outcome).toBeInstanceOf(IamLastOperatorError);
    const [b_] = await dbService.db.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, b));
    expect(b_?.deletedAt).toBeNull();
  });

  it('keeps the end date and assignment time of a role the save did not change', async () => {
    const boss = await makeUser('boss');
    const target = await makeUser('c');
    await joinTenantOne(boss);
    await joinTenantOne(target);
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
    expect(history[0].tenantId).toBe('1');
    const [added] = await dbService.db
      .select({ tenantId: userRoleAssignments.tenantId })
      .from(userRoleAssignments)
      .where(and(eq(userRoleAssignments.userId, target), eq(userRoleAssignments.roleId, admin)));
    expect(added?.tenantId).toBe('1');
  });
});
