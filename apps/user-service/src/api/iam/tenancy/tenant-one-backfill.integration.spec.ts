import { DbService } from '@app/db';
import {
  iamAuditLogs,
  oauthClients,
  piiAccessLogs,
  roles,
  tenantDomains,
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
 * 시드가 다시 돌리는 테넌트 1 백필(`tenantOneBackfillStatements`)을 실 DB 에서 돌려 본다. 이미 적용된 DB 에서도 같은 결과가
 * 나와야 하므로(멱등) 시드가 넣는 모양의 행을 만들어 넣고 돌린 뒤, 모든 변경을 되돌린다 — 남의 데이터는 바뀌지 않는다.
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
        tenantId: '1',
        ...extra,
      })
      .returning({ id: users.id });
    return row.id;
  };
  // 부여는 테넌트를 늘 든다(NOT NULL, impl-b 28) — 시드가 넣는 테넌트 1 계정의 부여 모양.
  const legacyGrant = async (tx: UserServiceTx, userId: string, role: string, expiresAt: Date | null) => {
    await tx.insert(userRoleAssignments).values({ userId, roleId: await roleId(tx, role), expiresAt, tenantId: '1' });
  };
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
      // 토큰은 토큰 테넌트의 부여만 싣는다 — 백필 뒤 테넌트 1 토큰의 역할이 백필 전 전체 역할과 같다.
      expect((await issuer.getTokenRoleNames(person, '1', tx)).sort()).toEqual(before);
    });
  });

  // 시드가 다시 돌려도 테넌트 밖의 일(운영자 성질 변경)로 일부러 테넌트 없이 적은 이력은 그대로다.
  it('leaves a history row written without a tenant as it is', async () => {
    await rolledBack(async (tx) => {
      const actor = randomUUID();
      await tx.insert(iamAuditLogs).values({
        actorUserId: actor,
        action: 'user.platform_operator.set',
        targetType: 'user',
        targetId: randomUUID(),
        targetLabel: PREFIX,
        tenantId: null,
      });

      await backfill(tx);

      const audit = await tx
        .select({ tenantId: iamAuditLogs.tenantId })
        .from(iamAuditLogs)
        .where(eq(iamAuditLogs.actorUserId, actor));
      expect(audit).toEqual([{ tenantId: null }]);
    });
  });

  // contract 뒤엔 기본 테넌트가 없다 — 테넌트를 말하지 않는 부여 쓰기는 DB 가 거절한다(23502 not_null_violation).
  it('refuses a grant that names no tenant', async () => {
    const refused = rolledBack(async (tx) => {
      const user = await account(tx, 'signup');
      await tx.execute(sql`INSERT INTO user_roles (user_id, role_id) VALUES (${user}, ${await roleId(tx, 'user')})`);
    });
    await expect(refused).rejects.toThrow();
    const error: unknown = await refused.catch((e: unknown) => e);
    const codeOf = (e: unknown): unknown =>
      typeof e === 'object' && e !== null ? (Reflect.get(e, 'code') ?? codeOf(Reflect.get(e, 'cause'))) : undefined;
    expect(codeOf(error)).toBe('23502');
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
