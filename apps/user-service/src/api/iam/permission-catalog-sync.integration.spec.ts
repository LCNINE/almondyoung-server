import { DbService } from '@app/db';
import type { PermissionDefinition } from '@app/authorization';
import {
  iamPermissions,
  iamRolePermissions,
  roles,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { IamRepository } from './iam.repository';
import { PermissionCatalogSyncManager } from './permission-catalog-sync.manager';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// 테스트 키는 실제 목록과 겹치지 않는 영역(zz)만 쓰고, 폐기 판정도 그 안으로 한정한다.
const ZZ = { scopePrefix: 'zz.' };

const def = (key: string, grant: PermissionDefinition['grantOnFirstRegistration'] = []): PermissionDefinition => ({
  key,
  label: key,
  description: key,
  dangerous: false,
  systemOnly: false,
  ownerServices: ['core'],
  grantOnFirstRegistration: grant,
});

describeIfDb('permission catalog sync against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  const manager = () => new PermissionCatalogSyncManager(new IamRepository(dbService), dbService);
  const grantsOf = (key: string) =>
    dbService.db.select().from(iamRolePermissions).where(eq(iamRolePermissions.permissionKey, key));

  const cleanup = async () => {
    await dbService.db.delete(iamRolePermissions).where(like(iamRolePermissions.permissionKey, 'zz.%'));
    await dbService.db.delete(iamPermissions).where(like(iamPermissions.key, 'zz.%'));
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbService.onModuleDestroy();
  });

  it('grants once even when two instances boot together', async () => {
    const catalog = [def('zz.item.read', ['admin'])];
    await Promise.all([manager().sync(catalog, ZZ), manager().sync(catalog, ZZ)]);

    expect(await grantsOf('zz.item.read')).toHaveLength(1);
  });

  it('does not bring back a grant that was revoked after the first boot', async () => {
    const catalog = [def('zz.item.read', ['admin'])];
    await manager().sync(catalog, ZZ);
    await dbService.db.delete(iamRolePermissions).where(eq(iamRolePermissions.permissionKey, 'zz.item.read'));
    await manager().sync(catalog, ZZ);

    expect(await grantsOf('zz.item.read')).toHaveLength(0);
  });

  it('keeps grants of a key that leaves and comes back', async () => {
    await manager().sync([def('zz.item.read', ['admin'])], ZZ);
    await manager().sync([], ZZ);
    const [gone] = await dbService.db.select().from(iamPermissions).where(eq(iamPermissions.key, 'zz.item.read'));
    expect(gone.deprecatedAt).not.toBeNull();

    await manager().sync([def('zz.item.read', ['admin'])], ZZ);
    const [back] = await dbService.db.select().from(iamPermissions).where(eq(iamPermissions.key, 'zz.item.read'));
    expect(back.deprecatedAt).toBeNull();
    expect(await grantsOf('zz.item.read')).toHaveLength(1);
  });

  it('skips a missing role without failing', async () => {
    const result = await manager().sync([def('zz.item.read', ['admin', 'logistics_worker'])], ZZ);
    const present = await dbService.db
      .select({ name: roles.name })
      .from(roles)
      .where(inArray(roles.name, ['logistics_worker']));
    expect(result.missingRoles).toEqual(present.length === 0 ? ['logistics_worker'] : []);
  });
});
