import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as postgres from 'postgres';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';
import {
  applyMigrations,
  databaseUrl,
  describeIfDb,
  DRIZZLE_DIR,
  openClient,
} from './__fixtures__/purchase-order-receiving-contract-harness';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sellmateSql: {
  MARK_SALES_ORDERS_SHIPPED: string;
  MARK_FULFILLMENT_ORDERS_SHIPPED: string;
  MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED: string;
} = require('../../../../../../scripts/ops/cellmate-local/mark-core-shipped.sql.js');

/**
 * K3 PR 8 contract 마이그(`drop-legacy-drop-ship`) 사슬 검증. 자기 DB 를 만들어 그 직전까지 적용하고, 옛 값을
 * raw SQL 로 심은 뒤 마지막 마이그를 적용한다. 실행:
 * DATABASE_URL=postgresql://postgres:postgres@localhost:5432/<scratch> npx jest --runInBand --runTestsByPath <이 파일>
 * (DATABASE_URL 은 DB 이름만 바꿔 `postgres` 관리 DB 와 이 스펙 전용 DB 를 연다 — 그 DB 자체엔 아무것도 안 쓴다)
 */

interface Chain {
  before: MigrationMeta[];
  through: MigrationMeta[];
}

function dropLegacyDropShipChain(): Chain {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>;
  };
  const index = journal.entries.findIndex(({ tag }) => tag.endsWith('_drop-legacy-drop-ship'));
  if (index < 0) throw new Error('drop-legacy-drop-ship migration must exist');
  const migrations = readMigrationFiles({ migrationsFolder: DRIZZLE_DIR });
  return { before: migrations.slice(0, index), through: migrations.slice(0, index + 1) };
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`unsafe database identifier: ${value}`);
  return `"${value}"`;
}

describeIfDb('drop-legacy-drop-ship 마이그 (K3 PR 8 contract, DB integration)', () => {
  jest.setTimeout(300_000);
  const databaseName = `k3_pr8_mig_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
  let admin: postgres.Sql | undefined;
  let client: postgres.Sql | undefined;
  const profileIds = { mixed: randomUUID(), dropOnly: randomUUID(), unset: randomUUID() };
  const shippedFoId = randomUUID();
  const readyFoId = randomUUID();
  const readyChannelOrderId = `k3-pr8-mig-ready-${randomUUID()}`;

  function db(): postgres.Sql {
    if (!client) throw new Error('migration database is not initialized');
    return client;
  }

  beforeAll(async () => {
    const chain = dropLegacyDropShipChain();
    admin = openClient(databaseUrl('postgres'));
    await admin.unsafe(`CREATE DATABASE ${quotedIdentifier(databaseName)} TEMPLATE template0`);
    client = openClient(databaseUrl(databaseName));
    await applyMigrations(client, chain.before);

    // 옛 값을 심는다 — 라이브엔 0행이지만(Task 0) 마이그의 array_remove 가 안전망이다.
    await client`INSERT INTO delivery_profiles (id, name, source_type, supported_fulfillment_modes) VALUES
      (${profileIds.mixed}, 'k3-pr8-mixed', 'in_house', '{in_house,drop_ship}'::fulfillment_mode[]),
      (${profileIds.dropOnly}, 'k3-pr8-drop-only', 'direct', '{drop_ship}'::fulfillment_mode[]),
      (${profileIds.unset}, 'k3-pr8-unset', 'in_house', NULL)`;
    const shippedSalesOrderId = randomUUID();
    const readySalesOrderId = randomUUID();
    await client`INSERT INTO sales_orders (id, channel_order_id, order_date, sales_channel, shipping_address) VALUES
      (${shippedSalesOrderId}, ${`k3-pr8-mig-shipped-${randomUUID()}`}, now(), 'medusa', '{}'::json),
      (${readySalesOrderId}, ${readyChannelOrderId}, now(), 'medusa', '{}'::json)`;
    // 셀메이트 과도기 스크립트가 쓴 'shipped' FO 한 행(N1) + 그 스크립트가 마이그 뒤에 덮을 FO 한 행.
    await client`INSERT INTO fulfillment_orders (id, sales_order_id, status, fulfillment_mode) VALUES
      (${shippedFoId}, ${shippedSalesOrderId}, 'shipped', 'in_house'),
      (${readyFoId}, ${readySalesOrderId}, 'ready', 'in_house')`;

    await applyMigrations(client, chain.through);
  });

  afterAll(async () => {
    await client?.end();
    if (!admin) return;
    await admin`SELECT pg_terminate_backend(pid)
                  FROM pg_stat_activity
                 WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
    await admin.end();
  });

  it('배송 프로필의 drop_ship 이 빠진다 — {in_house}·{}·NULL', async () => {
    const rows = await db()<Array<{ id: string; modes: string | null }>>`
      SELECT id, supported_fulfillment_modes::text AS modes
        FROM delivery_profiles
       WHERE id IN (${profileIds.mixed}, ${profileIds.dropOnly}, ${profileIds.unset})`;
    const byId = new Map(rows.map((row) => [row.id, row.modes]));
    expect(byId.get(profileIds.mixed)).toBe('{in_house}');
    expect(byId.get(profileIds.dropOnly)).toBe('{}');
    expect(byId.has(profileIds.unset)).toBe(true);
    expect(byId.get(profileIds.unset)).toBeNull();
  });

  it('셀메이트가 쓴 shipped FO 는 그대로다(N1)', async () => {
    const [before] = await db()<Array<{ status: string; mode: string | null }>>`
      SELECT status::text AS status, fulfillment_mode::text AS mode FROM fulfillment_orders WHERE id = ${shippedFoId}`;
    expect(before).toEqual({ status: 'shipped', mode: 'in_house' });

    await db().unsafe(sellmateSql.MARK_SALES_ORDERS_SHIPPED, [[readyChannelOrderId]]);
    await db().unsafe(sellmateSql.MARK_FULFILLMENT_ORDERS_SHIPPED, [[readyChannelOrderId]]);
    await db().unsafe(sellmateSql.MARK_FULFILLMENT_ORDER_ITEMS_SHIPPED, [[readyChannelOrderId]]);

    const [after] = await db()<Array<{ status: string }>>`
      SELECT status::text AS status FROM fulfillment_orders WHERE id = ${readyFoId}`;
    expect(after.status).toBe('shipped');
  });

  it('칸과 타입이 없다', async () => {
    const columns = await db()<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           ('fulfillment_orders', 'direct_ship_status'),
           ('direct_ship_cancel_notices', 'holder_id')
         )`;
    expect(columns).toEqual([]);
    const types = await db()<Array<{ typname: string }>>`
      SELECT typname FROM pg_type WHERE typname = 'direct_ship_status'`;
    expect(types).toEqual([]);
    const [modes] = await db()<Array<{ modes: string }>>`SELECT enum_range(NULL::fulfillment_mode)::text AS modes`;
    expect(modes.modes).toBe('{in_house,3pl}');
  });
});
