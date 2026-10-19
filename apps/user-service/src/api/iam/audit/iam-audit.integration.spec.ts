import { DbService } from '@app/db';
import { iamAuditLogs, userServiceSchema, type UserServiceSchema } from 'apps/user-service/database/drizzle/schema';
import { randomUUID } from 'crypto';
import { inArray } from 'drizzle-orm';
import { IamAuditReader } from './iam-audit.reader';
import { IamAuditRepository } from './iam-audit.repository';

const DATABASE_URL = process.env.DATABASE_URL;
if (process.env.REQUIRE_USER_SERVICE_DB === '1' && !DATABASE_URL) {
  throw new Error('REQUIRE_USER_SERVICE_DB requires an explicit DATABASE_URL');
}
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('role change history against a real database', () => {
  let dbService: DbService<UserServiceSchema>;
  let reader: IamAuditReader;
  const actor = randomUUID();
  const role = randomUUID();
  const person = randomUUID();
  const ids: string[] = [];

  beforeAll(async () => {
    dbService = new DbService({ connectionString: DATABASE_URL ?? '' }, userServiceSchema);
    reader = new IamAuditReader(new IamAuditRepository(dbService));
    const base = { actorUserId: actor, actorLoginId: 'zz', targetLabel: 'zz' };
    const at = new Date('2026-10-13T00:00:00.000Z');
    const rows = await dbService.db
      .insert(iamAuditLogs)
      .values([
        { ...base, occurredAt: at, action: 'role.update', targetType: 'role', targetId: role, before: {}, after: {} },
        // 같은 ms 에 두 행 — 커서가 빠뜨리지 않아야 한다
        {
          ...base,
          occurredAt: new Date(at.getTime() + 1),
          action: 'user.roles.replace',
          targetType: 'user',
          targetId: person,
          before: [],
          after: [{ roleId: role, name: 'zz', expiresAt: null }],
        },
        {
          ...base,
          occurredAt: new Date(at.getTime() + 1),
          action: 'user.roles.replace',
          targetType: 'user',
          targetId: person,
          before: [{ roleId: randomUUID(), name: 'other', expiresAt: null }],
          after: [],
        },
      ])
      .returning({ id: iamAuditLogs.id });
    ids.push(...rows.map((r) => r.id));
  });
  afterAll(async () => {
    await dbService.db.delete(iamAuditLogs).where(inArray(iamAuditLogs.id, ids));
    await dbService.onApplicationShutdown();
  });

  it('finds a role by its own changes and by the assignments it entered or left', async () => {
    const page = await reader.page({ actorUserId: actor, roleId: role });
    expect(page.items.map((i) => i.action).sort()).toEqual(['role.update', 'user.roles.replace']);
  });

  it('walks every row one by one without skipping rows written in the same millisecond', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    for (let i = 0; i < 5; i += 1) {
      const page = await reader.page({ actorUserId: actor, limit: 1, cursor });
      seen.push(...page.items.map((r) => r.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(seen.sort()).toEqual([...ids].sort());
  });
});
