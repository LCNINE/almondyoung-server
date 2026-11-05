import { DbService } from '@app/db';
import {
  businessLicenses,
  tenants,
  userIdentities,
  users,
  userServiceSchema,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { like } from 'drizzle-orm';
import { ProviderType } from '../../commons/types/auth.type';
import { accountUniqueFieldOf } from './account-unique-field';
import { UsersService } from './users.service';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzsu05';
const HOME = `${PREFIX}a`;
const OTHER = `${PREFIX}b`;
const BUSINESS_NUMBER = '1234567890';

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
  /** OTHER 테넌트의 계정 하나 — 가입 폼이 묻는 세 값과 카카오 신원·사업자번호를 가진다. */
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
      .values({ userId: account.id, provider: ProviderType.KAKAO, providerId: `${PREFIX}-kakao-1`, tenantId: OTHER });
    await tx.insert(businessLicenses).values({
      userId: account.id,
      businessNumber: BUSINESS_NUMBER,
      representativeName: 'o',
      tenantId: OTHER,
    });
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

  it('같은 아이디·이메일·소셜 신원·사업자번호의 계정이 두 테넌트에 함께 있고, 각 테넌트의 조회는 자기 계정만 본다', async () => {
    await rolledBack(async (tx) => {
      await twoTenants(tx);
      const theirs = await otherTenantAccount(tx);
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
        .values({ userId: mine.id, provider: ProviderType.KAKAO, providerId: `${PREFIX}-kakao-1`, tenantId: HOME });
      await tx
        .insert(businessLicenses)
        .values({ userId: mine.id, businessNumber: BUSINESS_NUMBER, representativeName: 'h', tenantId: HOME });

      for (const [tenantId, id] of [
        [HOME, mine.id],
        [OTHER, theirs],
      ]) {
        await expect(usersService.findUserByLoginIdInTenant(tenantId, `${PREFIX}taken`, tx)).resolves.toEqual(
          expect.objectContaining({ id }),
        );
        await expect(
          usersService.findUserByEmailInTenant(tenantId, `${PREFIX}taken@example.test`, tx),
        ).resolves.toEqual(expect.objectContaining({ id }));
        await expect(
          usersService.findSocialAccountInTenant(tenantId, ProviderType.KAKAO, `${PREFIX}-kakao-1`, tx),
        ).resolves.toEqual(expect.objectContaining({ id }));
        await expect(usersService.isLoginIdAvailable(tenantId, `${PREFIX}taken`, tx)).resolves.toBe(false);
      }
    });
  });

  it('한 테넌트 안에서는 같은 아이디·이메일·소셜 신원·사업자번호가 여전히 하나뿐이다', async () => {
    const insertTwice = async (second: (tx: UserServiceTx, otherAccount: string) => Promise<unknown>) => {
      let failure: unknown;
      await rolledBack(async (tx) => {
        await twoTenants(tx);
        await otherTenantAccount(tx);
        const [sibling] = await tx
          .insert(users)
          .values({
            loginId: `${PREFIX}sib`,
            username: 's',
            nickname: 's',
            email: `${PREFIX}sib@example.test`,
            tenantId: OTHER,
          })
          .returning({ id: users.id });
        failure = await second(tx, sibling.id).then(
          () => undefined,
          (error: unknown) => error,
        );
      });
      return failure;
    };
    const uniqueViolation = expect.objectContaining({ cause: expect.objectContaining({ code: '23505' }) });

    // 경합을 409 로 바꾸는 판정이 실제 제약 이름을 알아본다.
    expect(
      accountUniqueFieldOf(
        await insertTwice((tx) =>
          tx.insert(users).values({
            loginId: `${PREFIX}taken`,
            username: 'x',
            nickname: 'x',
            email: `${PREFIX}x@example.test`,
            tenantId: OTHER,
          }),
        ),
      ),
    ).toBe('loginId');
    expect(
      accountUniqueFieldOf(
        await insertTwice((tx) =>
          tx.insert(users).values({
            loginId: `${PREFIX}x`,
            username: 'x',
            nickname: 'x',
            email: `${PREFIX}taken@example.test`,
            tenantId: OTHER,
          }),
        ),
      ),
    ).toBe('email');
    expect(
      await insertTwice((tx, sibling) =>
        tx
          .insert(userIdentities)
          .values({ userId: sibling, provider: ProviderType.KAKAO, providerId: `${PREFIX}-kakao-1`, tenantId: OTHER }),
      ),
    ).toEqual(uniqueViolation);
    expect(
      await insertTwice((tx, sibling) =>
        tx
          .insert(businessLicenses)
          .values({ userId: sibling, businessNumber: BUSINESS_NUMBER, representativeName: 's', tenantId: OTHER }),
      ),
    ).toEqual(uniqueViolation);
  });
});
