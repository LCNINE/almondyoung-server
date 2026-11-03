import { DbService } from '@app/db';
import {
  profiles,
  tenants,
  userConsents,
  users,
  userServiceSchema,
  type UserServiceSchema,
  type UserServiceTx,
} from 'apps/user-service/database/drizzle/schema';
import { eq, like } from 'drizzle-orm';
import { UsersService } from './users.service';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzrc06';
const HOME = `${PREFIX}a`;
const OTHER = `${PREFIX}b`;
// 전화번호는 unique 가 아니라 지금 스키마로도 두 테넌트에 같은 번호를 둘 수 있다. 저장 표기가 섞여 있으니 일부러 다르게 적는다.
const PHONE = '01099050606';

class RolledBack extends Error {}

/**
 * 아이디·비밀번호 찾기·재설정과 전화번호로 계정을 찾는 내부 조회는 그 테넌트의 계정만 본다(ADR-0056).
 * 다른 테넌트에 같은 번호·이메일이 있어도 섞이지 않는다. 모든 변경은 되돌린다.
 */
describeIfDb('recovery and phone lookups stay within the tenant (real database)', () => {
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
  /** 두 테넌트에 같은 번호·마케팅 동의를 가진 계정 하나씩. */
  const samePhoneInTwoTenants = async (tx: UserServiceTx) => {
    for (const id of [HOME, OTHER]) {
      await tx.insert(tenants).values({ id, slug: `${PREFIX}-${id}`, status: 'active', displayName: id });
    }
    const make = async (tenantId: string, phoneNumber: string) => {
      const [account] = await tx
        .insert(users)
        .values({
          loginId: `${PREFIX}${tenantId}`,
          username: tenantId,
          nickname: tenantId,
          email: `${PREFIX}${tenantId}@example.test`,
          tenantId,
        })
        .returning({ id: users.id });
      await tx.insert(profiles).values({ userId: account.id, phoneNumber });
      await tx.insert(userConsents).values({ userId: account.id, marketingConsent: true });
      return account.id;
    };
    return { home: await make(HOME, PHONE), other: await make(OTHER, '+82 10-9905-0606') };
  };

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    usersService = new UsersService(dbService, undefined as never, undefined as never);
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  });
  afterAll(async () => {
    await dbService.onApplicationShutdown();
  });

  it('아이디 찾기의 전화번호 조회는 그 테넌트의 계정만 돌려준다', async () => {
    await rolledBack(async (tx) => {
      const { home, other } = await samePhoneInTwoTenants(tx);

      await expect(usersService.findUsersByPhoneNumber(HOME, PHONE, tx)).resolves.toEqual([
        expect.objectContaining({ id: home }),
      ]);
      await expect(usersService.findUsersByPhoneNumber(OTHER, PHONE, tx)).resolves.toEqual([
        expect.objectContaining({ id: other }),
      ]);
    });
  });

  it('비밀번호 찾기·재설정의 계정 조회(아이디·계정 id·레거시 이메일)는 다른 테넌트 계정을 찾지 않는다', async () => {
    await rolledBack(async (tx) => {
      const { home, other } = await samePhoneInTwoTenants(tx);

      await expect(usersService.findUserByLoginIdInTenant(HOME, `${PREFIX}${OTHER}`, tx)).resolves.toBeNull();
      await expect(usersService.findUserByIdInTenant(HOME, other, tx)).resolves.toBeNull();
      await expect(usersService.findUserByIdInTenant(HOME, home, tx)).resolves.toEqual(
        expect.objectContaining({ id: home }),
      );
      await expect(
        usersService.findUserByEmailInTenant(HOME, `${PREFIX}${OTHER}@example.test`, tx),
      ).resolves.toBeNull();
    });
  });

  it('내부 연락처 조회(by-phone)는 호출 테넌트의 활성 계정만 돌려준다', async () => {
    await rolledBack(async (tx) => {
      const { home } = await samePhoneInTwoTenants(tx);

      await expect(usersService.findActiveContactsByPhone(HOME, PHONE, tx)).resolves.toEqual([
        { userId: home, username: HOME },
      ]);
    });
  });

  it('문자 발송 대상과 그 요약은 호출 테넌트의 계정만 센다', async () => {
    await rolledBack(async (tx) => {
      const { home, other } = await samePhoneInTwoTenants(tx);

      const audience = (await usersService.findSmsAudience(HOME, true, tx)).map((c) => c.userId);
      expect(audience).toContain(home);
      expect(audience).not.toContain(other);
      // HOME 은 이 스펙이 만든 테넌트라 계정이 하나뿐이다 — 요약도 그 하나만 센다.
      await expect(usersService.summarizeSmsAudience(HOME, tx)).resolves.toEqual({
        active: 1,
        withPhone: 1,
        consented: 1,
      });
    });
  });

  it('마케팅 수신 철회는 호출 테넌트의 같은 번호 계정만 철회한다', async () => {
    await rolledBack(async (tx) => {
      const { home, other } = await samePhoneInTwoTenants(tx);

      await expect(usersService.withdrawMarketingConsentByPhone(HOME, PHONE, 'sms-reply', tx)).resolves.toEqual({
        userIds: [home],
        withdrawnUserIds: [home],
      });
      const [untouched] = await tx
        .select({ marketingConsent: userConsents.marketingConsent })
        .from(userConsents)
        .where(eq(userConsents.userId, other));
      expect(untouched.marketingConsent).toBe(true);
    });
  });
});
