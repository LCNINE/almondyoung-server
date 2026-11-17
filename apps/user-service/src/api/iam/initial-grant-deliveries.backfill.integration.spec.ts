import { DbService } from '@app/db';
import {
  iamAuditLogs,
  iamInitialGrantDeliveries,
  iamPermissions,
  iamRolePermissions,
  roles,
  userServiceSchema,
  type UserServiceSchema,
} from 'apps/user-service/database/drizzle/schema';
import { like, sql } from 'drizzle-orm';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const MIGRATIONS_DIR = join(__dirname, '../../../database/drizzle');
const backfillSql = () => {
  const file = readdirSync(MIGRATIONS_DIR).find((name) => name.endsWith('_backfill-initial-grant-deliveries.sql'));
  if (!file) throw new Error('backfill migration not found');
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
};

// #1248 마이그의 채우기 규칙 — 이미 준 몫(지금 부여됨·키 등록 때 역할이 있었음·회수 이력)만 기록하고 나머지는 남긴다.
describeIfDb('initial grant deliveries backfill', () => {
  let dbService: DbService<UserServiceSchema>;

  const cleanup = async () => {
    await dbService.db.delete(iamInitialGrantDeliveries).where(like(iamInitialGrantDeliveries.permissionKey, 'zz.%'));
    await dbService.db.delete(iamRolePermissions).where(like(iamRolePermissions.permissionKey, 'zz.%'));
    await dbService.db.delete(iamAuditLogs).where(like(iamAuditLogs.targetLabel, 'zz_%'));
    await dbService.db.delete(iamPermissions).where(like(iamPermissions.key, 'zz.%'));
    await dbService.db.delete(roles).where(like(roles.name, 'zz_%'));
  };

  const role = async (name: string, createdAt: string) => {
    const [row] = await dbService.db
      .insert(roles)
      .values({ name, displayName: name, createdAt: new Date(createdAt) })
      .returning({ roleId: roles.roleId });
    return row.roleId;
  };

  beforeAll(() => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
  });
  beforeEach(cleanup);
  afterAll(async () => {
    await cleanup();
    await dbService.onApplicationShutdown();
  });

  it('records shares the old one-time sync already gave or a person took back', async () => {
    await dbService.db.insert(iamPermissions).values({
      key: 'zz.item.read',
      domain: 'zz',
      label: 'zz.item.read',
      description: 'zz.item.read',
      dangerous: false,
      systemOnly: false,
      registeredAt: new Date('2026-03-01T00:00:00Z'),
    });
    const early = await role('zz_early', '2026-01-01T00:00:00Z');
    const lateGranted = await role('zz_late_granted', '2026-06-01T00:00:00Z');
    const lateRevoked = await role('zz_late_revoked', '2026-06-01T00:00:00Z');
    const latePlain = await role('zz_late_plain', '2026-06-01T00:00:00Z');
    await dbService.db.insert(iamRolePermissions).values({ roleId: lateGranted, permissionKey: 'zz.item.read' });
    await dbService.db.insert(iamAuditLogs).values({
      actorUserId: '00000000-0000-4000-8000-000000000001',
      action: 'role.permissions.replace',
      targetType: 'role',
      targetId: lateRevoked,
      targetLabel: 'zz_late_revoked',
      before: { permissions: ['zz.item.read'] },
      after: { permissions: [], added: [], removed: ['zz.item.read'] },
    });

    await dbService.db.execute(sql.raw(backfillSql()));

    const delivered = new Set(
      (
        await dbService.db
          .select({ roleId: iamInitialGrantDeliveries.roleId })
          .from(iamInitialGrantDeliveries)
          .where(like(iamInitialGrantDeliveries.permissionKey, 'zz.%'))
      ).map((row) => row.roleId),
    );
    expect(delivered.has(early)).toBe(true);
    expect(delivered.has(lateGranted)).toBe(true);
    expect(delivered.has(lateRevoked)).toBe(true);
    expect(delivered.has(latePlain)).toBe(false);
  });
});
