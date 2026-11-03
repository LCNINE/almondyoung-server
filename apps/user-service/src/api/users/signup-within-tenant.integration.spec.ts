import { DbService } from '@app/db';
import {
  tenants,
  userIdentities,
  users,
  userServiceSchema,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { like } from 'drizzle-orm';
import { ProviderType } from '../../commons/types/auth.type';
import { UsersService } from './users.service';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzsu05';
const HOME = `${PREFIX}a`;
const OTHER = `${PREFIX}b`;

class RolledBack extends Error {}

/**
 * 가입·소셜 로그인의 중복 확인은 그 앱의 테넌트 안에서만 판단한다(ADR-0056). 다른 테넌트 계정이 가진 값은 중복이 아니다.
 * 모든 변경은 되돌린다.
 */
describeIfDb('sign-up and social lookups stay within the tenant (real database)', () => {
  let dbService: DbService<UserServiceSchema>;
  let usersService: UsersService;

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
  const twoTenants = async (tx: UserServiceTx) => {
    for (const id of [HOME, OTHER]) {
      await tx.insert(tenants).values({ id, slug: `${PREFIX}-${id}`, status: 'active', displayName: id });
    }
  };
  /** OTHER 테넌트의 계정 하나 — 가입 폼이 묻는 세 값과 카카오 신원을 가진다. */
  const otherTenantAccount = async (tx: UserServiceTx) => {
    const [account] = await tx
      .insert(users)
      .values({
        loginId: `${PREFIX}taken`,
        username: 'o',
        nickname: `${PREFIX}nick`,
        email: `${PREFIX}taken@example.test`,
        tenantId: OTHER,
      })
      .returning({ id: users.id });
    await tx
      .insert(userIdentities)
      .values({ userId: account.id, provider: ProviderType.KAKAO, providerId: `${PREFIX}-kakao-1` });
    return account.id;
  };

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    usersService = new UsersService(dbService, undefined as never, undefined as never);
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  });
  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('가입 폼의 세 값은 다른 테넌트 계정이 쓰고 있어도 이 테넌트에선 비어 있다', async () => {
    await rolledBack(async (tx) => {
      await twoTenants(tx);
      await otherTenantAccount(tx);

      await expect(usersService.isEmailAvailable(HOME, `${PREFIX}taken@example.test`, tx)).resolves.toBe(true);
      await expect(usersService.isLoginIdAvailable(HOME, `${PREFIX}taken`, tx)).resolves.toBe(true);
      await expect(usersService.isNicknameAvailable(HOME, `${PREFIX}nick`, tx)).resolves.toBe(true);

      // 같은 테넌트 안에서는 여전히 중복이다.
      await expect(usersService.isEmailAvailable(OTHER, `${PREFIX}taken@example.test`, tx)).resolves.toBe(false);
      await expect(usersService.isLoginIdAvailable(OTHER, `${PREFIX}taken`, tx)).resolves.toBe(false);
      await expect(usersService.isNicknameAvailable(OTHER, `${PREFIX}nick`, tx)).resolves.toBe(false);
    });
  });

  it('가입 시점의 이메일·닉네임 조회도 그 테넌트의 계정만 돌려준다', async () => {
    await rolledBack(async (tx) => {
      await twoTenants(tx);
      const id = await otherTenantAccount(tx);

      await expect(usersService.findUserByEmailInTenant(HOME, `${PREFIX}taken@example.test`, tx)).resolves.toBeNull();
      await expect(usersService.findUserByNicknameInTenant(HOME, `${PREFIX}nick`, tx)).resolves.toBeNull();
      await expect(usersService.findUserByEmailInTenant(OTHER, `${PREFIX}taken@example.test`, tx)).resolves.toEqual(
        expect.objectContaining({ id }),
      );
      await expect(usersService.findUserByNicknameInTenant(OTHER, `${PREFIX}nick`, tx)).resolves.toEqual(
        expect.objectContaining({ id }),
      );
    });
  });

  it('소셜 신원은 그 테넌트의 계정에 붙은 것만 «기존 계정»이다', async () => {
    await rolledBack(async (tx) => {
      await twoTenants(tx);
      const id = await otherTenantAccount(tx);

      await expect(
        usersService.findSocialAccountInTenant(HOME, ProviderType.KAKAO, `${PREFIX}-kakao-1`, tx),
      ).resolves.toBeNull();
      await expect(
        usersService.findSocialAccountInTenant(OTHER, ProviderType.KAKAO, `${PREFIX}-kakao-1`, tx),
      ).resolves.toEqual(expect.objectContaining({ id }));
      // provider 가 다르면 같은 provider 쪽 id 라도 다른 신원이다.
      await expect(
        usersService.findSocialAccountInTenant(OTHER, ProviderType.NAVER, `${PREFIX}-kakao-1`, tx),
      ).resolves.toBeNull();
    });
  });

  // 10(contract)이 unique 를 (테넌트, …) 로 넓힌 뒤에 켠다 — 지금 스키마는 전역 unique 라 두 번째 insert 가 23505 로 실패한다.
  it.skip('같은 이메일·아이디·소셜 신원의 계정이 두 테넌트에 함께 있을 수 있다 [10 에서 켠다]', async () => {
    await rolledBack(async (tx) => {
      await twoTenants(tx);
      await otherTenantAccount(tx);
      const [mine] = await tx
        .insert(users)
        .values({
          loginId: `${PREFIX}taken`,
          username: 'h',
          nickname: `${PREFIX}nick`,
          email: `${PREFIX}taken@example.test`,
          tenantId: HOME,
        })
        .returning({ id: users.id });
      await tx
        .insert(userIdentities)
        .values({ userId: mine.id, provider: ProviderType.KAKAO, providerId: `${PREFIX}-kakao-1` });

      await expect(
        usersService.findSocialAccountInTenant(HOME, ProviderType.KAKAO, `${PREFIX}-kakao-1`, tx),
      ).resolves.toEqual(expect.objectContaining({ id: mine.id }));
      await expect(usersService.isEmailAvailable(HOME, `${PREFIX}taken@example.test`, tx)).resolves.toBe(false);
    });
  });
});
