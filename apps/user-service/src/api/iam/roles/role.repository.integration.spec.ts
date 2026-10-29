import { DbService } from '@app/db';
import {
  roles,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, like } from 'drizzle-orm';
import { RoleRepository } from './role.repository';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzp7b';
const DAY = 24 * 60 * 60 * 1000;

describeIfDb('RoleRepository.hasLiveStaffRole against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let repository: RoleRepository;

  const roleId = async (name: string) => {
    const [found] = await dbService.db.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));
    if (found) return found.id;
    const [made] = await dbService.db.insert(roles).values({ name }).returning({ id: roles.roleId });
    return made.id;
  };
  const makeUser = async (suffix: string) => {
    const [u] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
      })
      .returning({ id: users.id });
    return u.id;
  };
  const grant = async (userId: string, roleName: string, expiresAt: Date | null) => {
    await dbService.db.insert(userRoleAssignments).values({ userId, roleId: await roleId(roleName), expiresAt });
  };
  const cleanup = () => dbService.db.delete(users).where(like(users.loginId, `${PREFIX}%`));
  const has = (userId: string) => dbService.run((trx) => repository.hasLiveStaffRole(userId, trx));

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    repository = new RoleRepository(dbService);
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('is true for a staff role with no end date', async () => {
    const id = await makeUser('live');
    await grant(id, 'intern', null);
    await expect(has(id)).resolves.toBe(true);
  });

  it('is true for a staff role that ends in the future', async () => {
    const id = await makeUser('future');
    await grant(id, 'intern', new Date(Date.now() + DAY));
    await expect(has(id)).resolves.toBe(true);
  });

  it('is false for an expired staff role', async () => {
    const id = await makeUser('expired');
    await grant(id, 'intern', new Date(Date.now() - DAY));
    await expect(has(id)).resolves.toBe(false);
  });

  it('is false when only customer roles are held', async () => {
    const id = await makeUser('customer');
    await grant(id, 'user', null);
    await grant(id, 'membership', null);
    await expect(has(id)).resolves.toBe(false);
  });

  it('is false for a user whose only staff role belongs to someone else', async () => {
    const holder = await makeUser('holder');
    const other = await makeUser('other');
    await grant(holder, 'intern', null);
    await expect(has(other)).resolves.toBe(false);
  });
});
