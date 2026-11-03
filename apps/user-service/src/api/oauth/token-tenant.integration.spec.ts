import { DbService } from '@app/db';
import {
  oauthClients,
  roles,
  tenantDomains,
  tenants,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { eq, like, sql } from 'drizzle-orm';
import { tenantOneBackfillStatements } from '../../../../../scripts/seeding/lib/tenant-one-backfill';
import { UsersService } from '../users/users.service';
import { OAuthRepository } from './oauth.repository';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzt05';
const DAY = 24 * 60 * 60 * 1000;

class RolledBack extends Error {}

/** 토큰 테넌트가 쓰는 실제 질의 — 테넌트 하나의 역할, 주소 → 테넌트, 클라이언트 고정 테넌트 백필. 모든 변경은 되돌린다. */
describeIfDb('token tenant queries against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let issuer: UsersService;
  let repo: OAuthRepository;

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
  const tenant = async (tx: UserServiceTx, id: string, status: 'preparing' | 'active' | 'suspended') => {
    await tx
      .insert(tenants)
      .values({ id, slug: `${PREFIX}-${id}`, status, displayName: id })
      .onConflictDoUpdate({ target: tenants.id, set: { status } });
  };
  const roleId = async (tx: UserServiceTx, name: string) => {
    const [found] = await tx.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));
    if (found) return found.id;
    const [made] = await tx.insert(roles).values({ name }).returning({ id: roles.roleId });
    return made.id;
  };
  const grant = async (
    tx: UserServiceTx,
    userId: string,
    role: string,
    tenantId: string,
    expiresAt: Date | null = null,
  ) => tx.insert(userRoleAssignments).values({ userId, roleId: await roleId(tx, role), tenantId, expiresAt });

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    issuer = new UsersService(dbService, undefined as never, undefined as never);
    repo = new OAuthRepository(dbService);
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  });
  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('토큰 역할은 그 테넌트의 살아 있는 부여뿐이다 — 한 계정이 두 테넌트에 부여가 있어도', async () => {
    await rolledBack(async (tx) => {
      await tenant(tx, `${PREFIX}b`, 'active');
      const [person] = await tx
        .insert(users)
        .values({ loginId: `${PREFIX}both`, username: 'b', nickname: `${PREFIX}b`, email: `${PREFIX}b@example.test` })
        .returning({ id: users.id });
      await grant(tx, person.id, 'user', '1');
      await grant(tx, person.id, 'admin', '1');
      await grant(tx, person.id, `${PREFIX}_catalog`, `${PREFIX}b`);
      await grant(tx, person.id, `${PREFIX}_expired`, `${PREFIX}b`, new Date(Date.now() - DAY));

      expect((await issuer.getTokenRoleNames(person.id, '1', tx)).sort()).toEqual(['admin', 'user']);
      expect(await issuer.getTokenRoleNames(person.id, `${PREFIX}b`, tx)).toEqual([`${PREFIX}_catalog`]);
    });
  });

  it('계정의 테넌트는 계정 행이 정한다 — 발급·갱신은 이것과 토큰 테넌트를 대조한다', async () => {
    await rolledBack(async (tx) => {
      await tenant(tx, `${PREFIX}t`, 'active');
      const [one] = await tx
        .insert(users)
        .values({ loginId: `${PREFIX}one`, username: 'o', nickname: `${PREFIX}o`, email: `${PREFIX}o@example.test` })
        .returning({ id: users.id });
      const [two] = await tx
        .insert(users)
        .values({
          loginId: `${PREFIX}two`,
          username: 't',
          nickname: `${PREFIX}t`,
          email: `${PREFIX}t@example.test`,
          tenantId: `${PREFIX}t`,
        })
        .returning({ id: users.id });

      // 테넌트를 넘기지 않은 쓰기는 expand 다리(DB 기본값)로 테넌트 1 이다.
      await expect(issuer.accountTenantOf(one.id, tx)).resolves.toBe('1');
      await expect(issuer.accountTenantOf(two.id, tx)).resolves.toBe(`${PREFIX}t`);
    });
  });

  it('로그인 화면의 테넌트로 찾으면 그 테넌트의 계정만 나온다', async () => {
    await rolledBack(async (tx) => {
      await tenant(tx, `${PREFIX}t`, 'active');
      await tx.insert(users).values({
        loginId: `${PREFIX}staff`,
        username: 's',
        nickname: `${PREFIX}s`,
        email: `${PREFIX}s@example.test`,
        tenantId: `${PREFIX}t`,
      });

      await expect(issuer.findUserByLoginIdInTenant(`${PREFIX}t`, `${PREFIX}staff`, tx)).resolves.toEqual(
        expect.objectContaining({ loginId: `${PREFIX}staff` }),
      );
      await expect(issuer.findUserByLoginIdInTenant('1', `${PREFIX}staff`, tx)).resolves.toBeNull();
    });
  });

  it('테넌트가 빈 계정에는 테넌트를 짐작하지 않는다(채우기 마이그 전 DB)', async () => {
    await rolledBack(async (tx) => {
      const [loose] = await tx
        .insert(users)
        .values({
          loginId: `${PREFIX}loose`,
          username: 'l',
          nickname: `${PREFIX}l`,
          email: `${PREFIX}l@example.test`,
          tenantId: null,
        })
        .returning({ id: users.id });

      await expect(issuer.accountTenantOf(loose.id, tx)).rejects.toThrow(/has no tenant/);
    });
  });

  it('주소는 그 주소를 테넌트 도메인으로 가진 테넌트와 그 상태를 돌려준다. 모르는 주소는 null', async () => {
    await rolledBack(async (tx) => {
      await tenant(tx, `${PREFIX}s`, 'suspended');
      await tx.insert(tenantDomains).values({ host: `admin.${PREFIX}.test:8443`, tenantId: `${PREFIX}s` });

      expect(await repo.findTenantByHost(`admin.${PREFIX}.test:8443`, tx)).toEqual({
        id: `${PREFIX}s`,
        status: 'suspended',
      });
      expect(await repo.findTenantByHost(`admin.${PREFIX}.test`, tx)).toBeNull();
      expect(await repo.findTenantById(`${PREFIX}s`, tx)).toEqual({ id: `${PREFIX}s`, status: 'suspended' });
      expect(await repo.findTenantById(`${PREFIX}none`, tx)).toBeNull();
    });
  });

  it('백필: 리디렉트 host 가 테넌트 도메인이 아닌 클라이언트만 테넌트 1 로 고정한다(멱등)', async () => {
    const backfill = async (tx: UserServiceTx) => {
      // 04 의 ALTER(기본값)는 이미 걸려 있다 — 다시 돌리면 테이블을 잠가 다른 스펙과 부딪힌다.
      for (const s of tenantOneBackfillStatements().filter((st) => !/^ALTER TABLE/i.test(st))) {
        await tx.execute(sql.raw(s));
      }
    };
    await rolledBack(async (tx) => {
      await tx
        .insert(tenantDomains)
        .values({ host: `staff.${PREFIX}.test`, tenantId: '1' })
        .onConflictDoNothing();
      const client = (clientId: string, redirectUris: string[]) =>
        tx.insert(oauthClients).values({ clientId, clientSecretHash: 'x', redirectUris, tenantId: null });
      await client(`${PREFIX}-staff`, [`https://STAFF.${PREFIX}.test/auth/callback`]);
      await client(`${PREFIX}-shop`, ['https://shop.example.test/cb', `${PREFIX}app://callback`]);

      await backfill(tx);
      await backfill(tx);

      const tenantOf = async (clientId: string) =>
        (await tx.select({ t: oauthClients.tenantId }).from(oauthClients).where(eq(oauthClients.clientId, clientId)))[0]
          ?.t;
      expect(await tenantOf(`${PREFIX}-staff`)).toBeNull();
      expect(await tenantOf(`${PREFIX}-shop`)).toBe('1');
    });
  });
});
