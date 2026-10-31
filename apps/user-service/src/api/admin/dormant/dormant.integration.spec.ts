import { DbService } from '@app/db';
import {
  roles,
  userRoleAssignments,
  users,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { eq, inArray, like } from 'drizzle-orm';
import { SYSTEM_ROLE_NAME } from '../../iam/iam.constants';
import { DormantService } from './dormant.service';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const PREFIX = 'zzp6d';
const LONG_AGO = new Date('2020-01-01T00:00:00Z');

describeIfDb('dormant candidates against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let service: DormantService;

  const roleId = async (name: string) => {
    const [found] = await dbService.db.select({ id: roles.roleId }).from(roles).where(eq(roles.name, name));
    if (found) return found.id;
    const [made] = await dbService.db.insert(roles).values({ name }).returning({ id: roles.roleId });
    return made.id;
  };
  const makeUser = async (
    suffix: string,
    roleNames: { name: string; expiresAt?: Date }[],
    isPlatformOperator = false,
  ) => {
    const [row] = await dbService.db
      .insert(users)
      .values({
        loginId: `${PREFIX}${suffix}`,
        username: suffix,
        nickname: suffix,
        email: `${PREFIX}${suffix}@example.test`,
        lastActivityAt: LONG_AGO,
        isPlatformOperator,
      })
      .returning({ id: users.id });
    for (const r of roleNames) {
      await dbService.db
        .insert(userRoleAssignments)
        .values({ userId: row.id, roleId: await roleId(r.name), expiresAt: r.expiresAt ?? null });
    }
    return row.id;
  };
  const cleanup = async () => {
    const ids = (
      await dbService.db
        .select({ id: users.id })
        .from(users)
        .where(like(users.loginId, `${PREFIX}%`))
    ).map((r) => r.id);
    if (ids.length === 0) return;
    await dbService.db.delete(userRoleAssignments).where(inArray(userRoleAssignments.userId, ids));
    await dbService.db.delete(users).where(inArray(users.id, ids));
  };
  const candidates = async () => {
    const found = await service.findDormantCandidates(new Date(), 10_000);
    const mine = await dbService.db
      .select({ id: users.id, loginId: users.loginId })
      .from(users)
      .where(like(users.loginId, `${PREFIX}%`));
    const names = new Map(mine.map((u) => [u.id, u.loginId]));
    return found.flatMap((c) => (names.has(c.id) ? [names.get(c.id)] : [])).sort();
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    service = new DormantService(dbService, { publishEvent: async () => undefined });
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('still selects an inactive customer', async () => {
    await makeUser('customer', [{ name: 'user' }]);
    expect(await candidates()).toEqual([`${PREFIX}customer`]);
  });

  it('never selects a platform operator', async () => {
    await makeUser('operator', [{ name: 'user' }], true);
    expect(await candidates()).toEqual([]);
  });

  it('selects a master holder who is not a platform operator — master is a role inside a tenant now', async () => {
    await makeUser('master', [{ name: 'user' }, { name: SYSTEM_ROLE_NAME }]);
    expect(await candidates()).toEqual([`${PREFIX}master`]);
  });
});
