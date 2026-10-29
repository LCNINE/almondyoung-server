import { DbService } from '@app/db';
import {
  roles,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, like } from 'drizzle-orm';
import { UserRolesReader } from './user-roles.reader';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzp7r';
const DAY = 24 * 60 * 60 * 1000;

describeIfDb('UserRolesReader.findLiveRoles against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let reader: UserRolesReader;
  let subjectId: string;

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

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    reader = new UserRolesReader(dbService);
    await cleanup();
    subjectId = await makeUser('s');
    const otherId = await makeUser('o');
    await grant(subjectId, 'user', null);
    await grant(subjectId, 'intern', new Date(Date.now() + DAY));
    await grant(subjectId, 'admin', new Date(Date.now() - DAY));
    await grant(otherId, 'membership', null);
  });
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('returns open-ended and future-dated grants (customer roles included), by name', async () => {
    const result = await reader.findLiveRoles(subjectId);
    expect(result.map((r) => r.role?.name)).toEqual(['intern', 'user']);
  });

  it('leaves out expired grants and other users grants', async () => {
    const names = (await reader.findLiveRoles(subjectId)).map((r) => r.role?.name);
    expect(names).not.toContain('admin');
    expect(names).not.toContain('membership');
  });
});
