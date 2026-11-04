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
import { eq, like, sql } from 'drizzle-orm';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ProviderType } from '../commons/types/auth.type';
import { accountTenantOf } from './account-owned-row-tenant';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzt10a';
const OTHER = `${PREFIX}-acme`;
const BACKFILL = join(__dirname, '../../database/drizzle/20261104044945_backfill-identity-license-tenant.sql');

class RolledBack extends Error {}

/**
 * 소셜 신원·사업자 등록은 그 행이 붙은 계정의 테넌트를 든다(ADR-0056) — 테넌트 안 unique 의 재료다.
 * 새 행은 쓰는 문장이 계정의 테넌트를 읽어 적고, 옛 행은 채우기 마이그가 채운다. 모든 변경은 되돌린다.
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
      .values({ loginId: `${PREFIX}o`, username: 'o', nickname: 'o', email: `${PREFIX}o@example.test`, tenantId: OTHER })
      .returning({ id: users.id });
    return row.id;
  };
  const identityTenant = async (tx: UserServiceTx, userId: string) =>
    (await tx.select({ t: userIdentities.tenantId }).from(userIdentities).where(eq(userIdentities.userId, userId)))[0]?.t;
  const licenseTenant = async (tx: UserServiceTx, userId: string) =>
    (await tx.select({ t: businessLicenses.tenantId }).from(businessLicenses).where(eq(businessLicenses.userId, userId)))[0]
      ?.t;

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
      await tx.insert(businessLicenses).values({ userId, fileUrl: 'https://example.test/l.png', tenantId: accountTenantOf(userId) });

      expect(await identityTenant(tx, userId)).toBe(OTHER);
      expect(await licenseTenant(tx, userId)).toBe(OTHER);
    });
  });

  it('채우기 마이그는 빈 칸만 계정의 테넌트로 채우고 다시 돌려도 같다', async () => {
    const statements = readFileSync(BACKFILL, 'utf8')
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);
    await rolledBack(async (tx) => {
      const userId = await otherTenantAccount(tx);
      await tx.insert(userIdentities).values({ userId, provider: ProviderType.KAKAO, providerId: `${PREFIX}-kakao` });
      await tx.insert(businessLicenses).values({ userId, fileUrl: 'https://example.test/l.png' });
      expect(await identityTenant(tx, userId)).toBeNull();

      for (const s of [...statements, ...statements]) await tx.execute(sql.raw(s));

      expect(await identityTenant(tx, userId)).toBe(OTHER);
      expect(await licenseTenant(tx, userId)).toBe(OTHER);
    });
  });
});
