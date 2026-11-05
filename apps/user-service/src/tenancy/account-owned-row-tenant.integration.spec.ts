import { DbService } from '@app/db';
import {
  businessLicenses,
  emailVerifications,
  tenants,
  userIdentities,
  users,
  userServiceSchema,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { eq, like } from 'drizzle-orm';
import { AccountLinkingService } from '../api/auth/account-linking.service';
import { IdentityVerificationService } from '../api/email-verification/services/identity-verification.service';
import { ProviderType } from '../commons/types/auth.type';
import { accountTenantOf } from './account-owned-row-tenant';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzt10a';
const OTHER = `${PREFIX}-acme`;

class RolledBack extends Error {}

/**
 * 소셜 신원·사업자 등록은 그 행이 붙은 계정의 테넌트를 든다(ADR-0056) — 테넌트 안 unique 의 재료다.
 * 새 행은 쓰는 문장이 계정의 테넌트를 읽어 적고, DB 는 (계정, 테넌트) FK 로 그 둘이 같은지 지킨다. 모든 변경은 되돌린다.
 */
describeIfDb('account-owned rows carry the account tenant (real database)', () => {
  let dbService: DbService<UserServiceSchema>;

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
  const otherTenantAccount = async (tx: UserServiceTx) => {
    await tx.insert(tenants).values({ id: OTHER, slug: OTHER, displayName: 'acme', status: 'active' });
    const [row] = await tx
      .insert(users)
      .values({
        loginId: `${PREFIX}o`,
        username: 'o',
        nickname: 'o',
        email: `${PREFIX}o@example.test`,
        tenantId: OTHER,
      })
      .returning({ id: users.id });
    return row.id;
  };
  const identityTenant = async (tx: UserServiceTx, userId: string) =>
    (await tx.select({ t: userIdentities.tenantId }).from(userIdentities).where(eq(userIdentities.userId, userId)))[0]
      ?.t;
  const licenseTenant = async (tx: UserServiceTx, userId: string) =>
    (
      await tx
        .select({ t: businessLicenses.tenantId })
        .from(businessLicenses)
        .where(eq(businessLicenses.userId, userId))
    )[0]?.t;

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  });
  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('새 신원·사업자 등록은 계정의 테넌트를 적는다', async () => {
    await rolledBack(async (tx) => {
      const userId = await otherTenantAccount(tx);
      await tx.insert(userIdentities).values({
        userId,
        provider: ProviderType.KAKAO,
        providerId: `${PREFIX}-kakao`,
        tenantId: accountTenantOf(userId),
      });
      await tx
        .insert(businessLicenses)
        .values({ userId, fileUrl: 'https://example.test/l.png', tenantId: accountTenantOf(userId) });

      expect(await identityTenant(tx, userId)).toBe(OTHER);
      expect(await licenseTenant(tx, userId)).toBe(OTHER);
    });
  });

  it('계정의 테넌트가 아닌 테넌트로는 신원·사업자 등록을 붙일 수 없다 — DB 가 (계정, 테넌트) 로 지킨다', async () => {
    const refused = async (write: (tx: UserServiceTx, userId: string) => Promise<unknown>) => {
      let failure: unknown;
      await rolledBack(async (tx) => {
        const userId = await otherTenantAccount(tx);
        failure = await write(tx, userId).then(
          () => undefined,
          (error: unknown) => error,
        );
      });
      return failure;
    };
    const foreignKeyViolation = expect.objectContaining({ cause: expect.objectContaining({ code: '23503' }) });

    expect(
      await refused((tx, userId) =>
        tx
          .insert(userIdentities)
          .values({ userId, provider: ProviderType.KAKAO, providerId: `${PREFIX}-kakao`, tenantId: '1' }),
      ),
    ).toEqual(foreignKeyViolation);
    expect(
      await refused((tx, userId) =>
        tx.insert(businessLicenses).values({ userId, fileUrl: 'https://example.test/l.png', tenantId: '1' }),
      ),
    ).toEqual(foreignKeyViolation);
  });

  it('소셜 계정 연결은 이 계정의 테넌트 안에서만 «이미 남에게 붙은 신원»을 본다', async () => {
    const linking = new AccountLinkingService(
      dbService,
      undefined as never,
      undefined as never,
      {
        publishEvent: () => Promise.resolve(),
      } as never,
    );
    await rolledBack(async (tx) => {
      const theirs = await otherTenantAccount(tx);
      await tx.insert(userIdentities).values({
        userId: theirs,
        provider: ProviderType.KAKAO,
        providerId: `${PREFIX}-kakao`,
        tenantId: accountTenantOf(theirs),
      });
      const [mine] = await tx
        .insert(users)
        .values({
          loginId: `${PREFIX}m`,
          username: 'm',
          nickname: 'm',
          email: `${PREFIX}m@example.test`,
          tenantId: '1',
        })
        .returning({ id: users.id });
      const [sibling] = await tx
        .insert(users)
        .values({
          loginId: `${PREFIX}s`,
          username: 's',
          nickname: 's',
          email: `${PREFIX}s@example.test`,
          tenantId: OTHER,
        })
        .returning({ id: users.id });
      const profile = { name: 'm', email: `${PREFIX}m@example.test`, providerId: `${PREFIX}-kakao` };

      await linking.linkSocialAccount(mine.id, ProviderType.KAKAO, profile, tx);
      expect(await identityTenant(tx, mine.id)).toBe('1');

      await expect(linking.linkSocialAccount(sibling.id, ProviderType.KAKAO, profile, tx)).rejects.toThrow(
        /already linked to another user/,
      );
    });
  });

  it('같은 이메일의 두 테넌트 계정은 서로의 이메일 인증을 «통과»로 보지 않는다', async () => {
    // 이 서비스는 트랜잭션을 받지 않는다 — 실제로 쓰고 끝에 지운다(PREFIX 계정은 beforeAll 이 지운다).
    const verifier = new IdentityVerificationService(dbService);
    const email = `${PREFIX}same@example.test`;
    await dbService.db
      .insert(tenants)
      .values({ id: OTHER, slug: OTHER, displayName: 'acme', status: 'active' })
      .onConflictDoNothing();
    try {
      const made = await dbService.db
        .insert(users)
        .values([
          { loginId: `${PREFIX}e1`, username: 'a', nickname: 'a', email, tenantId: '1' },
          { loginId: `${PREFIX}e2`, username: 'b', nickname: 'b', email, tenantId: OTHER },
        ])
        .returning({ id: users.id, tenantId: users.tenantId });
      const theirs = made.find((u) => u.tenantId === OTHER)!;
      const mine = made.find((u) => u.tenantId === '1')!;
      await dbService.db.insert(emailVerifications).values({
        email,
        code: '123456',
        purpose: 'password_change',
        tenantId: OTHER,
        isVerified: true,
        verifiedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });

      expect(await verifier.isVerified(theirs.id, 'password_change')).toBe(true);
      expect(await verifier.isVerified(mine.id, 'password_change')).toBe(false);
    } finally {
      await dbService.db.delete(emailVerifications).where(eq(emailVerifications.email, email));
      await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
      await dbService.db.delete(tenants).where(eq(tenants.id, OTHER));
    }
  });
});
