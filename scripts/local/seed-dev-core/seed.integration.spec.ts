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
    const scopeCountRows = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM auth.scopes`);
    expect(scopeCountRows[0].n).toBeGreaterThan(0);

    const roleScopeRows = await db.execute<{ role_name: string; scope_key: string }>(sql`
      SELECT rsm.role_name, s.key AS scope_key
      FROM auth.role_scope_mapping rsm
      JOIN auth.scopes s ON s.id = rsm.scope_id
      ORDER BY rsm.role_name, s.key
    `);

    const scopeKeysByRole = new Map<string, string[]>();
    for (const row of roleScopeRows) {
      const scopeKeys = scopeKeysByRole.get(row.role_name) ?? [];
      scopeKeys.push(row.scope_key);
      scopeKeysByRole.set(row.role_name, scopeKeys);
    }

    // 기대값은 apps/core/src/platform/auth/fulfillment-scopes.ts 의 FULFILLMENT_ROLE_MAPPINGS 를
    // import 하지 않고 여기 직접 적는다 — 검증 대상 상수를 그대로 가져와 비교하면 그 상수 자체가
    // 잘못됐을 때도 테스트가 통과해버려 회귀를 잡지 못한다.
    expect(scopeKeysByRole.get('logistics_worker')).toEqual(['fulfillment.warehouse.operate']);
    expect(scopeKeysByRole.get('logistics_manager')).toEqual([
      'fulfillment.dispatch.force',
      'fulfillment.dispatch.recall',
      'fulfillment.reservation.transfer',
      'fulfillment.shipment.consolidate',
      'fulfillment.shipment.override_recipient',
      'fulfillment.shipment.reopen',
      'fulfillment.warehouse.operate',
    ]);
  });
});
