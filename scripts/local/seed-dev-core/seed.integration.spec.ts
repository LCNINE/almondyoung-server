import { execFileSync } from 'child_process';
import * as postgres from 'postgres';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { wmsSchema } from '../../../apps/core/src/modules/inventory/schema/inventory.schema';

const SEED_URL = process.env.SEED_DEV_CORE_URL;
const describeIfSeedDb = SEED_URL ? describe : describe.skip;

describeIfSeedDb('dev_core 시드', () => {
  jest.setTimeout(300_000);
  let client: postgres.Sql;
  let db: PostgresJsDatabase<typeof wmsSchema>;

  beforeAll(() => {
    execFileSync(
      'npx',
      ['ts-node', '-r', 'tsconfig-paths/register', '--transpile-only', 'scripts/local/seed-dev-core/index.ts'],
      { stdio: 'inherit', env: { ...process.env, SEED_DEV_CORE_URL: SEED_URL } },
    );
    client = postgres(SEED_URL as string, { max: 1 });
    db = drizzle(client, { schema: wmsSchema });
  });

  afterAll(async () => {
    await client?.end();
  });

  it('scope 와 role→scope 매핑이 채워진다', async () => {
    const scopeRows = await db.execute(sql`SELECT count(*)::int AS n FROM auth.scopes`);
    expect(Number((scopeRows as unknown as Array<{ n: number }>)[0].n)).toBeGreaterThan(0);

    const mappingRows = await db.execute(
      sql`SELECT role_name FROM auth.role_scope_mapping GROUP BY role_name ORDER BY role_name`,
    );
    const roles = (mappingRows as unknown as Array<{ role_name: string }>).map((row) => row.role_name);
    expect(roles).toEqual(['logistics_manager', 'logistics_worker']);
  });
});
