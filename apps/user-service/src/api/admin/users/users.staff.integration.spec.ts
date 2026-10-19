import { DbService } from '@app/db';
import {
  roles,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, like } from 'drizzle-orm';
import { UsersService } from './users.service';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzp4s';
const DAY = 24 * 60 * 60 * 1000;

describeIfDb('admin user list — staff filter against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let service: UsersService;

  const roleId = async (name: string) => {
    const [found] = await dbService.db.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));
    if (found) return found.id;
    const [made] = await dbService.db.insert(roles).values({ name }).returning({ id: roles.roleId });
    return made.id;
  };
  const makeUser = async (suffix: string, roleName: string, expiresAt: Date | null) => {
    const [u] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
      })
      .returning({ id: users.id });
    await dbService.db.insert(userRoleAssignments).values({ userId: u.id, roleId: await roleId(roleName), expiresAt });
  };
  const cleanup = () => dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    service = new UsersService(dbService);
    await cleanup();
    await makeUser('a', 'intern', null);
    await makeUser('b', 'admin', new Date(Date.now() + DAY));
    await makeUser('c', 'user', null);
    await makeUser('d', 'intern', new Date(Date.now() - DAY));
  });
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('lists staff whose role has an end date and leaves customers and expired staff out', async () => {
    const result = await service.getUsers({ audience: 'staff', q: PREFIX, page: 1, limit: 100 });
    expect(result.data.map((u) => u.loginId).sort()).toEqual([`${PREFIX}a`, `${PREFIX}b`]);
  });

  it('shows each staff member their live staff roles with display names and end dates', async () => {
    const result = await service.getUsers({ audience: 'staff', q: `${PREFIX}b`, page: 1, limit: 100 });
    expect(result.data[0]?.staffRoles).toEqual([
      { name: 'admin', displayName: expect.any(String), expiresAt: expect.any(Date) },
    ]);
  });

  it('keeps the old list unchanged when the staff filter is not asked for', async () => {
    const result = await service.getUsers({ q: PREFIX, page: 1, limit: 100 });
    expect(result.data).toHaveLength(4);
    expect(result.data.every((u) => u.staffRoles === undefined)).toBe(true);
  });
});
