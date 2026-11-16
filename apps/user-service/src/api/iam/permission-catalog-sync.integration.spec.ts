import { DbService } from '@app/db';
import {
  iamInitialGrantDeliveries,
  iamPermissions,
  iamRolePermissions,
  roles,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { IamRepository } from './iam.repository';
import { PermissionCatalogSyncManager, type SyncablePermission } from './permission-catalog-sync.manager';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

// 테스트 키는 실제 목록과 겹치지 않는 영역(zz)만 쓰고, 폐기 판정도 그 안으로 한정한다.
const ZZ = { scopePrefix: 'zz.' };

// 역할은 seed 가 없는 DB 에서도 돌게 테스트가 만드는 zz_ 역할만 쓴다(missing role 테스트만 예외).
const def = (key: string, grant: readonly string[] = []): SyncablePermission => ({
  key,
  label: key,
  description: key,
  dangerous: false,
  systemOnly: false,
  ownerServices: ['core'],
  grantOnFirstRegistration: grant,
  requires: [],
  standalone: false,
});

describeIfDb('permission catalog sync against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  const manager = () => new PermissionCatalogSyncManager(new IamRepository(dbService), dbService);
  const grantsOf = (key: string) =>
    dbService.db.select().from(iamRolePermissions).where(eq(iamRolePermissions.permissionKey, key));

  const createRole = async (name: string) => {
    const [row] = await dbService.db.insert(roles).values({ name, displayName: name }).returning();
    return row.roleId;
  };
  const deleteRole = (name: string) => dbService.db.delete(roles).where(eq(roles.name, name));

  const cleanup = async () => {
    await dbService.db.delete(iamInitialGrantDeliveries).where(like(iamInitialGrantDeliveries.permissionKey, 'zz.%'));
    await dbService.db.delete(iamRolePermissions).where(like(iamRolePermissions.permissionKey, 'zz.%'));
    await dbService.db.delete(iamPermissions).where(like(iamPermissions.key, 'zz.%'));
    await dbService.db.delete(roles).where(like(roles.name, 'zz_%'));
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
  });
  beforeEach(async () => {
    await cleanup();
    await createRole('zz_admin');
  });
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('grants once even when two instances boot together', async () => {
    const catalog = [def('zz.item.read', ['zz_admin'])];
    await Promise.all([manager().sync(catalog, ZZ), manager().sync(catalog, ZZ)]);

    expect(await grantsOf('zz.item.read')).toHaveLength(1);
  });

  it('does not bring back a grant that was revoked after the first boot', async () => {
    const catalog = [def('zz.item.read', ['zz_admin'])];
    await manager().sync(catalog, ZZ);
    await dbService.db.delete(iamRolePermissions).where(eq(iamRolePermissions.permissionKey, 'zz.item.read'));
    await manager().sync(catalog, ZZ);

    expect(await grantsOf('zz.item.read')).toHaveLength(0);
  });

  it('keeps grants of a key that leaves and comes back', async () => {
    await manager().sync([def('zz.item.read', ['zz_admin'])], ZZ);
    await manager().sync([], ZZ);
    const [gone] = await dbService.db.select().from(iamPermissions).where(eq(iamPermissions.key, 'zz.item.read'));
    expect(gone.deprecatedAt).not.toBeNull();

    await manager().sync([def('zz.item.read', ['zz_admin'])], ZZ);
    const [back] = await dbService.db.select().from(iamPermissions).where(eq(iamPermissions.key, 'zz.item.read'));
    expect(back.deprecatedAt).toBeNull();
    expect(await grantsOf('zz.item.read')).toHaveLength(1);
  });

  it('skips a missing role without failing', async () => {
    const result = await manager().sync([def('zz.item.read', ['zz_admin', 'logistics_worker'])], ZZ);
    const present = await dbService.db
      .select({ name: roles.name })
      .from(roles)
      .where(inArray(roles.name, ['logistics_worker']));
    expect(result.missingRoles).toEqual(present.length === 0 ? ['logistics_worker'] : []);
  });

  // #1248: 키가 등록될 때 없던 역할
  it('grants a role that appears after its key was registered', async () => {
    const catalog = [def('zz.item.read', ['zz_late_worker'])];
    const before = await manager().sync(catalog, ZZ);
    expect(before.missingRoles).toEqual(['zz_late_worker']);
    expect(await grantsOf('zz.item.read')).toHaveLength(0);

    await createRole('zz_late_worker');
    const after = await manager().sync(catalog, ZZ);

    expect(await grantsOf('zz.item.read')).toHaveLength(1);
    expect(after.granted).toEqual([{ permissionKey: 'zz.item.read', roleName: 'zz_late_worker' }]);
  });

  it('does not bring back a late grant that was revoked', async () => {
    const catalog = [def('zz.item.read', ['zz_late_worker'])];
    await manager().sync(catalog, ZZ);
    await createRole('zz_late_worker');
    await manager().sync(catalog, ZZ);
    await dbService.db.delete(iamRolePermissions).where(eq(iamRolePermissions.permissionKey, 'zz.item.read'));
    await manager().sync(catalog, ZZ);

    expect(await grantsOf('zz.item.read')).toHaveLength(0);
  });

  it('gives a recreated role its share again', async () => {
    const catalog = [def('zz.item.read', ['zz_late_worker'])];
    await createRole('zz_late_worker');
    await manager().sync(catalog, ZZ);
    await deleteRole('zz_late_worker');
    const recreated = await createRole('zz_late_worker');
    await manager().sync(catalog, ZZ);

    const grants = await grantsOf('zz.item.read');
    expect(grants.map((g) => g.roleId)).toEqual([recreated]);
  });

  it('grants a late role once when two instances boot together', async () => {
    const catalog = [def('zz.item.read', ['zz_late_worker'])];
    await manager().sync(catalog, ZZ);
    await createRole('zz_late_worker');
    const results = await Promise.all([manager().sync(catalog, ZZ), manager().sync(catalog, ZZ)]);

    expect(await grantsOf('zz.item.read')).toHaveLength(1);
    expect(results[0].grants + results[1].grants).toBe(1);
  });
});
