import { DbService } from '@app/db';
import {
  iamAuditLogs,
  oauthClients,
  piiAccessLogs,
  roles,
  tenantDomains,
  tenantMemberships,
  tenants,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { randomUUID } from 'node:crypto';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { tenantOneBackfillStatements } from '../../../../../../scripts/seeding/lib/tenant-one-backfill';
import { UsersService } from '../../users/users.service';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzt04';
const DAY = 24 * 60 * 60 * 1000;

class RolledBack extends Error {}

/**
 * 백필 마이그를 «그대로» 다시 돌려 본다. 이미 적용된 DB 에서도 같은 결과가 나와야 하므로(멱등) 아직 백필되지 않은
 * 모양(테넌트 칸 NULL)의 행을 만들어 넣고 돌린 뒤, 모든 변경을 되돌린다 — 남의 데이터는 바뀌지 않는다.
 */
describeIfDb('tenant 1 backfill migration against a real database', () => {
  let dbService: DbService<UserServiceSchema>;

  // 기본값을 거는 ALTER 는 이미 적용된 마이그가 걸어 두었다 — 다시 돌리면 테이블 전체를 잠가(ACCESS EXCLUSIVE) 같은 DB 를
  // 쓰는 다른 스펙과 부딪히므로 데이터 문장만 다시 돌린다. 기본값 자체는 아래 «테넌트를 모르는 쓰기» 스펙이 본다.
  const statements = tenantOneBackfillStatements().filter((s) => !/^ALTER TABLE/i.test(s));
  const backfill = async (tx: UserServiceTx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  };
  const rolledBack = async (work: (tx: UserServiceTx) => Promise<void>) => {
    try {
      await dbService.db.transaction(async (tx) => {
        await work(tx);
        throw new RolledBack();
      });
    } catch (error) {
      if (!(error instanceof RolledBack)) throw error;
    }
  };

  const roleId = async (tx: UserServiceTx, name: string) => {
    const [found] = await tx.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));
    if (found) return found.id;
    const [made] = await tx.insert(roles).values({ name }).returning({ id: roles.roleId });
    return made.id;
  };
  const account = async (tx: UserServiceTx, suffix: string, extra: Partial<typeof users.$inferInsert> = {}) => {
    const [row] = await tx
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
        ...extra,
      })
      .returning({ id: users.id });
    return row.id;
  };
  // 백필 전 모양 — 옛 코드가 쓰던 행에는 테넌트가 없다.
  const legacyGrant = async (tx: UserServiceTx, userId: string, role: string, expiresAt: Date | null) => {
    await tx.insert(userRoleAssignments).values({ userId, roleId: await roleId(tx, role), expiresAt, tenantId: null });
  };
  const membershipsOf = async (tx: UserServiceTx, userIds: string[]) =>
    tx
      .select({ userId: tenantMemberships.userId, tenantId: tenantMemberships.tenantId })
      .from(tenantMemberships)
      .where(inArray(tenantMemberships.userId, userIds));
  const operatorFlag = async (tx: UserServiceTx, userId: string) => {
    const [row] = await tx.select({ op: users.isPlatformOperator }).from(users).where(eq(users.id, userId));
    return row?.op;
  };

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  });
  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('creates tenant 1 as active, with the admin address as its domain', async () => {
    await rolledBack(async (tx) => {
      await tx.delete(tenantDomains).where(eq(tenantDomains.tenantId, '1'));
      await tx
        .insert(oauthClients)
        .values({
          clientId: 'admin-web',
          clientSecretHash: 'x',
          redirectUris: ['https://Admin.Example.test/auth/callback', 'http://localhost:3000/auth/callback'],
        })
        .onConflictDoUpdate({
          target: oauthClients.clientId,
          set: { redirectUris: ['https://Admin.Example.test/auth/callback', 'http://localhost:3000/auth/callback'] },
        });

      await backfill(tx);

      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, '1'));
      expect(tenant).toEqual(expect.objectContaining({ id: '1', slug: 'almondyoung', status: 'active' }));
      const hosts = await tx
        .select({ host: tenantDomains.host })
        .from(tenantDomains)
        .where(eq(tenantDomains.tenantId, '1'));
      expect(hosts.map((h) => h.host).sort()).toEqual(['admin.example.test', 'localhost:3000']);
    });
  });

  it('makes accounts with a live staff grant members of tenant 1, and nobody else', async () => {
    await rolledBack(async (tx) => {
      const staff = await account(tx, 'staff');
      const ending = await account(tx, 'ending');
      const former = await account(tx, 'former');
      const customer = await account(tx, 'customer');
      const boss = await account(tx, 'mboss');
      await legacyGrant(tx, boss, 'master', null);
      await legacyGrant(tx, staff, 'intern', null);
      await legacyGrant(tx, ending, 'admin', new Date(Date.now() + DAY));
      await legacyGrant(tx, former, 'intern', new Date(Date.now() - DAY));
      await legacyGrant(tx, customer, 'user', null);
      await legacyGrant(tx, customer, 'membership', null);

      await backfill(tx);

      const rows = await membershipsOf(tx, [staff, ending, former, customer]);
      expect(rows).toEqual(
        expect.arrayContaining([
          { userId: staff, tenantId: '1' },
          { userId: ending, tenantId: '1' },
        ]),
      );
      expect(rows).toHaveLength(2);
    });
  });

  it('puts every existing grant in tenant 1, expired and customer ones included', async () => {
    await rolledBack(async (tx) => {
      const former = await account(tx, 'grants');
      await legacyGrant(tx, former, 'intern', new Date(Date.now() - DAY));
      await legacyGrant(tx, former, 'user', null);

      await backfill(tx);

      const rows = await tx
        .select({ tenantId: userRoleAssignments.tenantId })
        .from(userRoleAssignments)
        .where(eq(userRoleAssignments.userId, former));
      expect(rows).toEqual([{ tenantId: '1' }, { tenantId: '1' }]);
      const [left] = await tx.execute<{ n: string }>(
        sql`select count(*)::text as n from user_roles where tenant_id is null`,
      );
      expect(left.n).toBe('0');
    });
  });

  it('turns permanent master holders into platform operators, and only them', async () => {
    await rolledBack(async (tx) => {
      const boss = await account(tx, 'boss');
      const temp = await account(tx, 'tempmaster');
      const admin = await account(tx, 'admin');
      await legacyGrant(tx, boss, 'master', null);
      await legacyGrant(tx, temp, 'master', new Date(Date.now() + DAY));
      await legacyGrant(tx, admin, 'admin', null);

      await backfill(tx);

      await expect(operatorFlag(tx, boss)).resolves.toBe(true);
      await expect(operatorFlag(tx, temp)).resolves.toBe(false);
      await expect(operatorFlag(tx, admin)).resolves.toBe(false);
      const [ops] = await tx.execute<{ n: string }>(
        sql`select count(*)::text as n from users where is_platform_operator and deleted_at is null and dormant_at is null`,
      );
      expect(Number(ops.n)).toBeGreaterThanOrEqual(1);
    });
  });

  it('leaves the roles a tenant 1 token carries exactly as they were', async () => {
    // 토큰의 roles 클레임을 만드는 바로 그 질의 — 이벤트 발행·역할 리더는 이 경로에서 쓰이지 않는다.
    const issuer = new UsersService(dbService, undefined as never, undefined as never);
    await rolledBack(async (tx) => {
      const person = await account(tx, 'token');
      await legacyGrant(tx, await account(tx, 'tboss'), 'master', null);
      await legacyGrant(tx, person, 'admin', null);
      await legacyGrant(tx, person, 'intern', new Date(Date.now() + DAY));
      await legacyGrant(tx, person, 'user', null);
      await legacyGrant(tx, person, 'master', new Date(Date.now() - DAY));
      const before = (await issuer.getUserRoleNames(person, tx)).sort();

      await backfill(tx);

      expect(before).toEqual(['admin', 'intern', 'user']);
      expect((await issuer.getUserRoleNames(person, tx)).sort()).toEqual(before);
    });
  });

  it('records old history and access-log rows as tenant 1', async () => {
    await rolledBack(async (tx) => {
      const actor = randomUUID();
      await tx.insert(iamAuditLogs).values({
        actorUserId: actor,
        action: 'role.update',
        targetType: 'role',
        targetId: randomUUID(),
        targetLabel: PREFIX,
        tenantId: null,
      });
      await tx.insert(piiAccessLogs).values({
        eventId: randomUUID(),
        occurredAt: new Date(),
        actorUserId: actor,
        sourceService: 'core',
        method: 'GET',
        route: '/x',
        action: 'view',
        subjects: [],
        subjectCount: 0,
        kinds: [],
        queryKeys: [],
        tenantId: null,
      });

      await backfill(tx);

      const audit = await tx
        .select({ tenantId: iamAuditLogs.tenantId })
        .from(iamAuditLogs)
        .where(eq(iamAuditLogs.actorUserId, actor));
      const pii = await tx
        .select({ tenantId: piiAccessLogs.tenantId })
        .from(piiAccessLogs)
        .where(eq(piiAccessLogs.actorUserId, actor));
      expect(audit).toEqual([{ tenantId: '1' }]);
      expect(pii).toEqual([{ tenantId: '1' }]);
    });
  });

  it('keeps writers that do not name a tenant yet in tenant 1 until the contract migration', async () => {
    await rolledBack(async (tx) => {
      await backfill(tx);
      const signedUp = await account(tx, 'signup');
      // 고객 가입 경로처럼 테넌트를 모르는 쓰기 — 쓰는 쪽이 테넌트를 넘기기 전까지 DB 가 테넌트 1 로 채운다.
      await tx.insert(userRoleAssignments).values({ userId: signedUp, roleId: await roleId(tx, 'user') });
      const [row] = await tx
        .select({ tenantId: userRoleAssignments.tenantId })
        .from(userRoleAssignments)
        .where(eq(userRoleAssignments.userId, signedUp));
      expect(row.tenantId).toBe('1');
    });
  });

  it('refuses to finish when staff exist but no platform operator would remain', async () => {
    await rolledBack(async (tx) => {
      const master = await roleId(tx, 'master');
      await tx.update(users).set({ isPlatformOperator: false });
      await tx.delete(userRoleAssignments).where(eq(userRoleAssignments.roleId, master));
      const staff = await account(tx, 'lonely');
      await legacyGrant(tx, staff, 'admin', null);

      await expect(backfill(tx)).rejects.toThrow(/platform operator/);
    });
  });
});
