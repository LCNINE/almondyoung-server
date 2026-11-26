import { DbService } from '@app/db';
import {
  roles,
  tenants,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, like } from 'drizzle-orm';
import { RoleRepository } from '../roles/role.repository';
import { ActorTenantReader } from '../tenancy/actor-tenant.reader';
import { TenancyRepository } from '../tenancy/tenancy.repository';
import { StaffNamesReader } from './staff-names.reader';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzsn';

describeIfDb('staff names against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let reader: StaffNamesReader;
  const OTHER_TENANT = `${PREFIX}t`;

  const roleId = async (name: string) => {
    const [found] = await dbService.db.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));

    if (found) return found.id;

    const [made] = await dbService.db.insert(roles).values({ name }).returning({ id: roles.roleId });

    return made.id;
  };

  const makeUser = async (suffix: string, tenantId = '1', deletedAt: Date | null = null) => {
    const [row] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: `name-${suffix}`,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
        tenantId,
        deletedAt,
      })
      .returning({ id: users.id });

    return row.id;
  };

  const actor = (userId: string, tenantId: string) => ({
    userId,
    loginId: null,
    roles: [],
    userAgent: null,
    requestId: null,
    ip: null,
    tenantId,
  });

  const cleanup = async () => {
    await dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
    await dbService.db.delete(roles).where(like(roles.name, `${PREFIX}%`));
    await dbService.db.delete(tenants).where(like(tenants.id, `${PREFIX}%`));
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    reader = new StaffNamesReader(new RoleRepository(dbService), new ActorTenantReader(new TenancyRepository(dbService)));
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('names only live staff of the requester tenant and leaves every other id out', async () => {
    await dbService.db.insert(tenants).values({ id: OTHER_TENANT, slug: OTHER_TENANT, displayName: OTHER_TENANT });
    const staffRole = await roleId(`${PREFIX}_picker`);
    const customerRole = await roleId('user');
    const staff = await makeUser('staff');
    const twoRoles = await makeUser('two');
    const customer = await makeUser('customer');
    const expired = await makeUser('expired');
    const deleted = await makeUser('deleted', '1', new Date());
    const otherTenantStaff = await makeUser('other', OTHER_TENANT);
    const plain = await makeUser('plain');
    await dbService.db.insert(userRoleAssignments).values([
      { userId: staff, roleId: staffRole, tenantId: '1' },
      { userId: twoRoles, roleId: staffRole, tenantId: '1' },
      { userId: twoRoles, roleId: customerRole, tenantId: '1' },
      { userId: customer, roleId: customerRole, tenantId: '1' },
      { userId: expired, roleId: staffRole, tenantId: '1', expiresAt: new Date(Date.now() - 60_000) },
      { userId: deleted, roleId: staffRole, tenantId: '1' },
      { userId: otherTenantStaff, roleId: staffRole, tenantId: OTHER_TENANT },
    ]);

    const names = await reader.namesOf(actor(staff, '1'), [
      staff,
      twoRoles,
      customer,
      expired,
      deleted,
      otherTenantStaff,
      plain,
    ]);

    expect(names.map((n) => n.name).sort()).toEqual(['name-staff', 'name-two']);
    expect(names.find((n) => n.id === staff)).toEqual({ id: staff, name: 'name-staff' });
  });
});
