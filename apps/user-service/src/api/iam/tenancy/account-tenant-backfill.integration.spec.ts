import { DbService } from '@app/db';
import {
  emailVerifications,
  iamAuditLogs,
  phoneVerifications,
  roles,
  tenantMemberships,
  tenants,
  userConsents,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { eq, inArray, like, sql } from 'drizzle-orm';
import {
  accountTenantBackfillStatements,
  tenantOneBackfillStatements,
} from '../../../../../../scripts/seeding/lib/tenant-one-backfill';
import {
  ACCOUNT_TENANT_PREVIEW_SQL,
  type AccountTenantPreviewRow,
} from '../../../../../../scripts/tenancy/account-tenant-preview/preview-query';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzt02';
const OTHER = 'zzt02-acme';
const DAY = 24 * 60 * 60 * 1000;

class RolledBack extends Error {}

/**
 * 계정 테넌트 채우기 마이그를 «그대로» 다시 돌려 본다. 채우기 전 모양(계정 테넌트 NULL)의 행을 만들어 넣고 돌린 뒤 모든 변경을
 * 되돌린다 — 남의 데이터는 바뀌지 않는다. 마이그 전에 사람이 돌리는 읽기 전용 미리보기가 같은 계정을 같은 테넌트로 고르는지도 본다.
 */
describeIfDb('account tenant backfill migration against a real database', () => {
  let dbService: DbService<UserServiceSchema>;

  // 기본값을 거는 ALTER 는 이미 적용된 마이그가 걸어 두었다 — 다시 돌리면 테이블을 잠가 같은 DB 를 쓰는 다른 스펙과 부딪힌다.
  const statements = accountTenantBackfillStatements().filter((s) => !/^ALTER TABLE/im.test(s.replace(/^--.*$/gm, '')));
  const backfill = async (tx: UserServiceTx) => {
    for (const statement of statements) await tx.execute(sql.raw(statement));
  };
  const preview = async (tx: UserServiceTx, ids: string[]) => {
    // 미리보기 CLI 가 postgres.js 로 그대로 돌리는 원문 SQL 이라 drizzle 이 결과 행 모양을 모른다 — 행 모양은 그 SQL 의 SELECT 목록이다.
    const rows = (await tx.execute(sql.raw(ACCOUNT_TENANT_PREVIEW_SQL))) as unknown as AccountTenantPreviewRow[];
    return rows.filter((r) => ids.includes(r.user_id));
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
  const otherTenant = async (tx: UserServiceTx) => {
    await tx.insert(tenants).values({ id: OTHER, slug: OTHER, displayName: 'acme', status: 'active' }).onConflictDoNothing();
  };
  // 채우기 전 모양 — 옛 코드가 만든 계정에는 테넌트가 없다(DB 기본값을 피해 NULL 을 명시한다).
  const account = async (tx: UserServiceTx, suffix: string, extra: Partial<typeof users.$inferInsert> = {}) => {
    const [row] = await tx
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
        tenantId: null,
        ...extra,
      })
      .returning({ id: users.id });
    return row.id;
  };
  const grant = async (tx: UserServiceTx, userId: string, role: string, tenantId: string, expiresAt: Date | null = null) =>
    tx.insert(userRoleAssignments).values({ userId, roleId: await roleId(tx, role), tenantId, expiresAt });
  const member = (tx: UserServiceTx, userId: string, tenantId: string) =>
    tx.insert(tenantMemberships).values({ userId, tenantId });
  const signedUpCustomer = (tx: UserServiceTx, userId: string) =>
    tx.insert(userConsents).values({
      userId,
      isOver14: true,
      termsOfService: true,
      electronicTransaction: true,
      privacyPolicy: true,
      thirdPartySharing: false,
      marketingConsent: false,
    });

  const tenantOf = async (tx: UserServiceTx, userId: string) => {
    const [row] = await tx.select({ tenantId: users.tenantId }).from(users).where(eq(users.id, userId));
    return row?.tenantId;
  };
  const grantTenants = async (tx: UserServiceTx, userId: string) =>
    (
      await tx
        .select({ tenantId: userRoleAssignments.tenantId })
        .from(userRoleAssignments)
        .where(eq(userRoleAssignments.userId, userId))
    )
      .map((r) => r.tenantId)
      .sort();
  const memberTenants = async (tx: UserServiceTx, userId: string) =>
    (
      await tx
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(eq(tenantMemberships.userId, userId))
    )
      .map((r) => r.tenantId)
      .sort();

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  });
  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('gives an account tied only to another tenant that tenant', async () => {
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      const staff = await account(tx, 'staff2');
      await member(tx, staff, OTHER);
      await grant(tx, staff, 'admin', OTHER);

      await backfill(tx);

      await expect(tenantOf(tx, staff)).resolves.toBe(OTHER);
      await expect(grantTenants(tx, staff)).resolves.toEqual([OTHER]);
      await expect(memberTenants(tx, staff)).resolves.toEqual([OTHER]);
    });
  });

  it('ignores a stray tenant 1 membership on an account staffed only elsewhere, and drops it', async () => {
    // 테넌트 1 백필을 시드가 다시 돌리면 다른 테넌트의 직원 부여를 보고도 테넌트 1 소속을 만든다.
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      const check = await account(tx, 'check2');
      await member(tx, check, OTHER);
      await member(tx, check, '1');
      await grant(tx, check, 'admin', OTHER);

      await backfill(tx);

      await expect(tenantOf(tx, check)).resolves.toBe(OTHER);
      await expect(memberTenants(tx, check)).resolves.toEqual([OTHER]);
    });
  });

  it('keeps an account tied to tenant 1 and another tenant in tenant 1, and revokes the other side with history', async () => {
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      const both = await account(tx, 'both');
      await member(tx, both, '1');
      await grant(tx, both, 'admin', '1');
      await member(tx, both, OTHER);
      // 부여 unique 가 아직 (계정, 역할)이라 다른 테넌트에서는 다른 역할이다.
      await grant(tx, both, `${PREFIX}_staff`, OTHER);
      await grant(tx, both, 'intern', OTHER, new Date(Date.now() + DAY));

      await backfill(tx);

      await expect(tenantOf(tx, both)).resolves.toBe('1');
      await expect(grantTenants(tx, both)).resolves.toEqual(['1']);
      await expect(memberTenants(tx, both)).resolves.toEqual(['1']);
      const history = await tx
        .select({
          tenantId: iamAuditLogs.tenantId,
          action: iamAuditLogs.action,
          actor: iamAuditLogs.actorLoginId,
          before: iamAuditLogs.before,
          after: iamAuditLogs.after,
        })
        .from(iamAuditLogs)
        .where(eq(iamAuditLogs.targetId, both));
      expect(history).toEqual([
        {
          tenantId: OTHER,
          action: 'user.roles.replace',
          actor: 'migration',
          before: [
            expect.objectContaining({ name: 'intern' }),
            expect.objectContaining({ name: `${PREFIX}_staff`, expiresAt: null }),
          ],
          after: [],
        },
      ]);
    });
  });

  it('keeps a tenant 1 shopper who was also made staff elsewhere in tenant 1', async () => {
    // 고객 역할이 없어도 가입 동의가 있으면 테넌트 1 쇼핑몰 계정이다 — 옮기면 주문·적립금이 걸린 계정 id 를 잃는다.
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      const shopper = await account(tx, 'shopper');
      await signedUpCustomer(tx, shopper);
      await member(tx, shopper, OTHER);
      await grant(tx, shopper, 'admin', OTHER);

      await backfill(tx);

      await expect(tenantOf(tx, shopper)).resolves.toBe('1');
      await expect(grantTenants(tx, shopper)).resolves.toEqual([]);
      await expect(memberTenants(tx, shopper)).resolves.toEqual([]);
    });
  });

  it('keeps a platform operator in tenant 1 even when their only grants are elsewhere', async () => {
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      const op = await account(tx, 'op', { isPlatformOperator: true });
      await member(tx, op, OTHER);
      await grant(tx, op, 'master', OTHER);

      await backfill(tx);

      await expect(tenantOf(tx, op)).resolves.toBe('1');
    });
  });

  it('puts everyone else in tenant 1 — customers, tenant 1 staff, and accounts tied to nothing', async () => {
    await rolledBack(async (tx) => {
      const customer = await account(tx, 'customer');
      await grant(tx, customer, 'user', '1');
      const staff = await account(tx, 'staff1');
      await member(tx, staff, '1');
      await grant(tx, staff, 'admin', '1', new Date(Date.now() - DAY));
      const loose = await account(tx, 'loose');

      await backfill(tx);

      for (const id of [customer, staff, loose]) await expect(tenantOf(tx, id)).resolves.toBe('1');
      await expect(grantTenants(tx, customer)).resolves.toEqual(['1']);
      await expect(grantTenants(tx, staff)).resolves.toEqual(['1']);
      const [left] = await tx.execute<{ n: string }>(sql`select count(*)::text as n from users where tenant_id is null`);
      expect(left.n).toBe('0');
    });
  });

  it('gives the same result when run twice', async () => {
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      const staff = await account(tx, 'again2');
      await member(tx, staff, OTHER);
      await grant(tx, staff, 'admin', OTHER);
      const both = await account(tx, 'againboth');
      await grant(tx, both, 'admin', '1');
      await grant(tx, both, 'intern', OTHER);

      await backfill(tx);
      const once = { staff: await tenantOf(tx, staff), both: await tenantOf(tx, both) };
      const historyOnce = await tx.select().from(iamAuditLogs).where(inArray(iamAuditLogs.targetId, [staff, both]));
      await backfill(tx);

      expect({ staff: await tenantOf(tx, staff), both: await tenantOf(tx, both) }).toEqual(once);
      expect(once).toEqual({ staff: OTHER, both: '1' });
      await expect(
        tx.select().from(iamAuditLogs).where(inArray(iamAuditLogs.targetId, [staff, both])),
      ).resolves.toHaveLength(historyOnce.length);
    });
  });

  it('previews exactly the accounts the backfill moves or strips, read before it runs', async () => {
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      const moving = await account(tx, 'pmove');
      await member(tx, moving, OTHER);
      await member(tx, moving, '1');
      await grant(tx, moving, 'admin', OTHER);
      const kept = await account(tx, 'pkept');
      await grant(tx, kept, 'admin', '1');
      await grant(tx, kept, 'intern', OTHER);
      const customer = await account(tx, 'pcustomer');
      await grant(tx, customer, 'user', '1');

      const before = await preview(tx, [moving, kept, customer]);
      await backfill(tx);

      expect(before.map((r) => [r.login_id, r.outcome, r.account_tenant, r.loses])).toEqual([
        [`${PREFIX}pkept`, 'keep-in-tenant-one', '1', [OTHER]],
        [`${PREFIX}pmove`, 'move', OTHER, ['1']],
      ]);
      for (const row of before) await expect(tenantOf(tx, row.user_id)).resolves.toBe(row.account_tenant);
      // 다시 보면 잃을 것이 남아 있지 않다 — 마이그 뒤에 돌려 본 미리보기가 «끝났다»의 확인이 된다.
      const after = await preview(tx, [moving, kept, customer]);
      expect(after.filter((r) => r.loses.length > 0)).toEqual([]);
    });
  });

  it('does not let a seed re-run of the tenant 1 backfill put other-tenant staff back into tenant 1', async () => {
    // 시드는 관리자 계정을 넣은 뒤 테넌트 1 백필을 다시 돌린다 — 그 첫 문장이 다른 테넌트 직원 부여를 보고 테넌트 1 소속을 만든다.
    const seedRerun = tenantOneBackfillStatements().filter((s) => !/^ALTER TABLE/im.test(s.replace(/^--.*$/gm, '')));
    await rolledBack(async (tx) => {
      await otherTenant(tx);
      // 테넌트 1 백필은 직원이 있는데 운영자가 0명이면 멈춘다 — 빈 DB 에서도 돌게 운영자를 하나 둔다.
      await account(tx, 'seedop', { isPlatformOperator: true });
      const staff = await account(tx, 'seed2');
      await member(tx, staff, OTHER);
      await grant(tx, staff, 'admin', OTHER);
      await backfill(tx);

      for (const statement of seedRerun) await tx.execute(sql.raw(statement));

      await expect(tenantOf(tx, staff)).resolves.toBe(OTHER);
      await expect(memberTenants(tx, staff)).resolves.toEqual([OTHER]);
      await expect(grantTenants(tx, staff)).resolves.toEqual([OTHER]);
    });
  });

  it('records verification codes in progress as tenant 1', async () => {
    await rolledBack(async (tx) => {
      const phone = `010${PREFIX}`;
      await tx.insert(phoneVerifications).values({
        phoneNumber: phone,
        code: '123456',
        purpose: 'phone_verify',
        expiresAt: new Date(Date.now() + DAY),
        tenantId: null,
      });
      const email = `${PREFIX}code@example.test`;
      await tx.insert(emailVerifications).values({
        email,
        code: '123456',
        purpose: 'password_change',
        expiresAt: new Date(Date.now() + DAY),
        tenantId: null,
      });

      await backfill(tx);

      const [p] = await tx
        .select({ tenantId: phoneVerifications.tenantId })
        .from(phoneVerifications)
        .where(eq(phoneVerifications.phoneNumber, phone));
      const [e] = await tx
        .select({ tenantId: emailVerifications.tenantId })
        .from(emailVerifications)
        .where(eq(emailVerifications.email, email));
      expect([p.tenantId, e.tenantId]).toEqual(['1', '1']);
    });
  });

  it('keeps writers that do not name a tenant yet (old tasks during the rollout) in tenant 1', async () => {
    await rolledBack(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({ loginId: `${PREFIX}old`, username: 'old', nickname: 'old', email: `${PREFIX}old@example.test` })
        .returning({ tenantId: users.tenantId });
      expect(row.tenantId).toBe('1');
    });
  });
});
