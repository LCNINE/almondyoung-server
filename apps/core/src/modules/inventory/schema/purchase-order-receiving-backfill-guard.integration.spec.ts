import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as postgres from 'postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;
const DRIZZLE_DIR = join(__dirname, '..', '..', '..', '..', 'drizzle');

interface MigrationJournal {
  entries: Array<{ tag: string }>;
}

interface MigrationChain {
  beforePrB: MigrationMeta[];
  throughPrB: MigrationMeta[];
}

interface LegacyFixture {
  warehouseId: string;
  otherWarehouseId: string;
  holderId: string;
  skuIds: string[];
}

interface AcceptanceFixture extends LegacyFixture {
  partialPoId: string;
  shortClosedPoId: string;
  fullPoId: string;
  cancelledPoId: string;
  requestedPoId: string;
  shortClosedBy: string;
  linkedReceiptLineIds: string[];
  directReceiptLineId: string;
}

function migrationChain(): MigrationChain {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as MigrationJournal;
  const ddlIndex = journal.entries.findIndex(({ tag }) => tag.endsWith('_purchase-order-owns-receiving'));
  const backfillIndex = journal.entries.findIndex(({ tag }) => tag.endsWith('_backfill-purchase-order-receiving'));

  if (ddlIndex < 0 || backfillIndex < 0) {
    throw new Error('PR-B DDL and backfill migration files must both exist');
  }
  if (backfillIndex !== ddlIndex + 1) {
    throw new Error('PR-B DDL and backfill migrations must be consecutive, with backfill second');
  }

  const migrations = readMigrationFiles({ migrationsFolder: DRIZZLE_DIR });
  return {
    beforePrB: migrations.slice(0, ddlIndex),
    throughPrB: migrations.slice(0, backfillIndex + 1),
  };
}

function databaseUrl(databaseName: string): string {
  const url = new URL(DATABASE_URL as string);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function ownedDatabaseName(label: string): string {
  return `pr_c_t1_pr_b_${label}_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`unsafe database identifier: ${value}`);
  return `"${value}"`;
}

function openClient(url: string): postgres.Sql {
  return postgres(url, { max: 1, onnotice: () => undefined });
}

/** postgres.js TransactionSql loses Sql's call signature through Omit; runtime values remain tagged-template clients. */
function taggable(tx: postgres.TransactionSql): postgres.Sql {
  return tx as unknown as postgres.Sql;
}

async function applyMigrations(client: postgres.Sql, migrations: MigrationMeta[]): Promise<void> {
  const db = drizzle(client);
  const session = db._.session as unknown as Parameters<PgDialect['migrate']>[1];
  await new PgDialect().migrate(migrations, session, { migrationsFolder: DRIZZLE_DIR });
}

function causeChainMessage(error: unknown): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('message' in current && typeof current.message === 'string') messages.push(current.message);
    current = 'cause' in current ? current.cause : undefined;
  }
  return messages.join('\n');
}

describeIfDb('purchase-order receiving PR-B migration acceptance (isolated PostgreSQL)', () => {
  jest.setTimeout(180_000);

  let admin: postgres.Sql;
  let templateDatabase: string;
  let chain: MigrationChain;
  const ownedDatabases = new Set<string>();

  async function createDatabase(name: string, template = 'template0'): Promise<void> {
    await admin.unsafe(`CREATE DATABASE ${quotedIdentifier(name)} TEMPLATE ${quotedIdentifier(template)}`);
    ownedDatabases.add(name);
  }

  async function dropDatabase(name: string): Promise<void> {
    await admin`SELECT pg_terminate_backend(pid)
                  FROM pg_stat_activity
                 WHERE datname = ${name} AND pid <> pg_backend_pid()`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedIdentifier(name)}`);
    ownedDatabases.delete(name);
  }

  async function withPrABaseline(label: string, run: (client: postgres.Sql) => Promise<void>): Promise<void> {
    const name = ownedDatabaseName(label);
    await createDatabase(name, templateDatabase);
    const client = openClient(databaseUrl(name));
    try {
      await run(client);
    } finally {
      await client.end();
      await dropDatabase(name);
    }
  }

  async function withEmptyDatabase(label: string, run: (client: postgres.Sql) => Promise<void>): Promise<void> {
    const name = ownedDatabaseName(label);
    await createDatabase(name);
    const client = openClient(databaseUrl(name));
    try {
      await run(client);
    } finally {
      await client.end();
      await dropDatabase(name);
    }
  }

  beforeAll(async () => {
    chain = migrationChain();
    admin = openClient(databaseUrl('postgres'));
    templateDatabase = ownedDatabaseName('base');
    await createDatabase(templateDatabase);
    const client = openClient(databaseUrl(templateDatabase));
    try {
      await applyMigrations(client, chain.beforePrB);
    } catch (error) {
      await client.end();
      await dropDatabase(templateDatabase);
      throw error;
    }
    await client.end();
  });

  afterAll(async () => {
    if (!admin) return;
    for (const name of [...ownedDatabases].reverse()) await dropDatabase(name);
    await admin.end();
  });

  async function seedCatalog(client: postgres.Sql, skuCount: number): Promise<LegacyFixture> {
    const holderId = randomUUID();
    const warehouseId = randomUUID();
    const otherWarehouseId = randomUUID();
    const skuIds = Array.from({ length: skuCount }, () => randomUUID());

    await client`INSERT INTO holders (id, name) VALUES (${holderId}, ${`t1-holder-${holderId}`})`;
    await client`INSERT INTO warehouses (id, name) VALUES
      (${warehouseId}, ${`t1-source-${warehouseId}`}),
      (${otherWarehouseId}, ${`t1-destination-${otherWarehouseId}`})`;
    for (const [index, skuId] of skuIds.entries()) {
      await client`INSERT INTO skus (id, holder_id, name, code)
                   VALUES (${skuId}, ${holderId}, ${`t1-sku-${index}`}, ${`T1-${skuId}`})`;
    }
    return { holderId, warehouseId, otherWarehouseId, skuIds };
  }

  async function seedPurchaseOrder(
    client: postgres.Sql,
    fixture: LegacyFixture,
    skuId: string,
    options: {
      poStatus?: 'created' | 'confirmed' | 'received' | 'cancelled';
      lineStatus?: 'requested' | 'ordered' | 'unavailable';
      orderedQty?: number | null;
      quantity?: number;
    } = {},
  ): Promise<string> {
    const poId = randomUUID();
    const poStatus = options.poStatus ?? 'confirmed';
    const lineStatus = options.lineStatus ?? 'ordered';
    const orderedQty = options.orderedQty === undefined ? 10 : options.orderedQty;
    const quantity = options.quantity ?? orderedQty ?? 10;
    await client`INSERT INTO purchase_orders
      (id, type, status, source_warehouse_id, destination_warehouse_id, requires_transfer)
      VALUES (${poId}, 'domestic', ${poStatus}, ${fixture.warehouseId}, ${fixture.otherWarehouseId}, false)`;
    await client`INSERT INTO purchase_order_lines (po_id, sku_id, quantity, status, ordered_qty)
      VALUES (${poId}, ${skuId}, ${quantity}, ${lineStatus}, ${orderedQty})`;
    return poId;
  }

  async function seedPlanItem(
    client: postgres.Sql,
    fixture: LegacyFixture,
    poId: string,
    skuId: string,
    options: {
      planType?: 'source' | 'destination';
      expectedQty?: number;
      receivedQty?: number;
      status?: 'pending' | 'applied' | 'receiving' | 'confirmed' | 'short_closed';
      closedReason?: string | null;
      closedAt?: Date | null;
      closedBy?: string | null;
    } = {},
  ): Promise<string> {
    const planId = randomUUID();
    const itemId = randomUUID();
    await client`INSERT INTO inbound_plans
      (id, warehouse_id, plan_type, linked_purchase_order_id, destination_warehouse_id, requires_transfer)
      VALUES (${planId}, ${fixture.warehouseId}, ${options.planType ?? 'source'}, ${poId},
              ${fixture.otherWarehouseId}, false)`;
    await client`INSERT INTO inbound_plan_items
      (id, plan_id, sku_id, expected_qty, received_qty, status, closed_reason, closed_at, closed_by)
      VALUES (${itemId}, ${planId}, ${skuId}, ${options.expectedQty ?? 10}, ${options.receivedQty ?? 0},
              ${options.status ?? 'pending'}, ${options.closedReason ?? null}, ${options.closedAt ?? null},
              ${options.closedBy ?? null})`;
    return itemId;
  }

  async function seedReceiptLine(
    client: postgres.Sql,
    fixture: LegacyFixture,
    skuId: string,
    planItemId: string | null,
    quantity: number,
    canceledQty = 0,
  ): Promise<string> {
    const receiptId = randomUUID();
    const receiptLineId = randomUUID();
    await client`INSERT INTO inbound_receipts (id, method, warehouse_id, occurred_at, total_quantity)
      VALUES (${receiptId}, 'planned', ${fixture.warehouseId}, ${new Date('2026-09-01T00:00:00Z')}, ${quantity})`;
    await client`INSERT INTO inbound_receipt_lines
      (id, receipt_id, sku_id, quantity, canceled_qty, plan_item_id)
      VALUES (${receiptLineId}, ${receiptId}, ${skuId}, ${quantity}, ${canceledQty}, ${planItemId})`;
    return receiptLineId;
  }

  async function seedAcceptanceFixture(client: postgres.Sql): Promise<AcceptanceFixture> {
    const fixture = await seedCatalog(client, 5);
    const [partialSku, shortSku, fullSku, cancelledSku, requestedSku] = fixture.skuIds;
    const shortClosedBy = randomUUID();

    const partialPoId = await seedPurchaseOrder(client, fixture, partialSku, { orderedQty: 10 });
    const partialItem = await seedPlanItem(client, fixture, partialPoId, partialSku, {
      expectedQty: 10,
      receivedQty: 4,
    });
    const partialLineA = await seedReceiptLine(client, fixture, partialSku, partialItem, 3);
    const partialLineB = await seedReceiptLine(client, fixture, partialSku, partialItem, 3, 2);

    const shortClosedPoId = await seedPurchaseOrder(client, fixture, shortSku, { orderedQty: 8 });
    const shortItem = await seedPlanItem(client, fixture, shortClosedPoId, shortSku, {
      expectedQty: 8,
      receivedQty: 5,
      status: 'short_closed',
      closedReason: 'legacy shortage',
      closedAt: new Date('2026-09-02T03:04:05Z'),
      closedBy: shortClosedBy,
    });
    const shortLine = await seedReceiptLine(client, fixture, shortSku, shortItem, 6, 1);

    const fullPoId = await seedPurchaseOrder(client, fixture, fullSku, { orderedQty: 6 });
    const fullItem = await seedPlanItem(client, fixture, fullPoId, fullSku, {
      expectedQty: 6,
      receivedQty: 6,
      status: 'confirmed',
    });
    const fullLine = await seedReceiptLine(client, fixture, fullSku, fullItem, 6);

    const cancelledPoId = await seedPurchaseOrder(client, fixture, cancelledSku, {
      poStatus: 'cancelled',
      orderedQty: 4,
    });
    const cancelledItem = await seedPlanItem(client, fixture, cancelledPoId, cancelledSku, {
      expectedQty: 4,
      receivedQty: 1,
    });
    const cancelledLine = await seedReceiptLine(client, fixture, cancelledSku, cancelledItem, 1);

    const requestedPoId = await seedPurchaseOrder(client, fixture, requestedSku, {
      poStatus: 'confirmed',
      lineStatus: 'requested',
      orderedQty: null,
      quantity: 7,
    });
    const directReceiptLineId = await seedReceiptLine(client, fixture, partialSku, null, 2);

    return {
      ...fixture,
      partialPoId,
      shortClosedPoId,
      fullPoId,
      cancelledPoId,
      requestedPoId,
      shortClosedBy,
      linkedReceiptLineIds: [partialLineA, partialLineB, shortLine, fullLine, cancelledLine],
      directReceiptLineId,
    };
  }

  async function expectAtomicMigrationRejection(
    label: string,
    seed: (client: postgres.Sql) => Promise<void>,
    expectedMessage: RegExp,
  ): Promise<void> {
    await withPrABaseline(label, async (client) => {
      await seed(client);
      let caught: unknown;
      try {
        await applyMigrations(client, chain.throughPrB);
      } catch (error) {
        caught = error;
      }
      expect(causeChainMessage(caught)).toMatch(expectedMessage);
      const [state] = await client`
        SELECT to_regclass('public.purchase_order_receipt_lines')::text AS link_table,
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'purchase_order_lines'
                    AND column_name = 'received_qty'
               ) AS received_column`;
      expect(state).toEqual({ link_table: null, received_column: false });
    });
  }

  it('installs the complete migration history through PR-B on a fresh empty database', async () => {
    await withEmptyDatabase('fresh', async (client) => {
      await applyMigrations(client, chain.throughPrB);
      const [state] = await client`
        SELECT to_regclass('public.purchase_order_receipt_lines')::text AS link_table,
               to_regclass('public.stock_summary_view')::text AS stock_view`;
      expect(state).toEqual({
        link_table: 'purchase_order_receipt_lines',
        stock_view: 'stock_summary_view',
      });
    });
  });

  it('applies the actual two PR-B migrations to a nonempty legacy model and preserves receiving parity', async () => {
    await withPrABaseline('acceptance', async (client) => {
      const fixture = await seedAcceptanceFixture(client);

      await applyMigrations(client, chain.throughPrB);

      const lineRows = await client<
        Array<{
          po_id: string;
          received_qty: number;
          closed_reason: string | null;
          closed_at: string | null;
          closed_by: string | null;
        }>
      >`SELECT po_id, received_qty, closed_reason, closed_at, closed_by
             FROM purchase_order_lines
            ORDER BY po_id`;
      const lines = new Map(lineRows.map((row) => [row.po_id, row]));
      expect(lines.get(fixture.partialPoId)).toMatchObject({ received_qty: 4, closed_reason: null, closed_at: null });
      expect(lines.get(fixture.shortClosedPoId)).toMatchObject({
        received_qty: 5,
        closed_reason: 'legacy shortage',
        closed_by: fixture.shortClosedBy,
      });
      expect(new Date(lines.get(fixture.shortClosedPoId)?.closed_at as string).toISOString()).toBe(
        '2026-09-02T03:04:05.000Z',
      );
      expect(lines.get(fixture.fullPoId)?.received_qty).toBe(6);
      expect(lines.get(fixture.cancelledPoId)?.received_qty).toBe(1);
      expect(lines.get(fixture.requestedPoId)?.received_qty).toBe(0);

      const statuses = await client<Array<{ id: string; status: string }>>`
        SELECT id, status::text FROM purchase_orders ORDER BY id`;
      const statusById = new Map(statuses.map((row) => [row.id, row.status]));
      expect(statusById.get(fixture.partialPoId)).toBe('confirmed');
      expect(statusById.get(fixture.shortClosedPoId)).toBe('received');
      expect(statusById.get(fixture.fullPoId)).toBe('received');
      expect(statusById.get(fixture.cancelledPoId)).toBe('cancelled');
      expect(statusById.get(fixture.requestedPoId)).toBe('created');

      const links = await client<Array<{ receipt_line_id: string }>>`
        SELECT receipt_line_id FROM purchase_order_receipt_lines ORDER BY receipt_line_id`;
      expect(links.map((row) => row.receipt_line_id).sort()).toEqual([...fixture.linkedReceiptLineIds].sort());
      const sources = await client<Array<{ id: string; source: string }>>`
        SELECT id, source::text FROM inbound_receipt_lines ORDER BY id`;
      const sourceById = new Map(sources.map((row) => [row.id, row.source]));
      for (const id of fixture.linkedReceiptLineIds) expect(sourceById.get(id)).toBe('purchase_order');
      expect(sourceById.get(fixture.directReceiptLineId)).toBe('direct');

      const [viewRow] = await client<Array<{ inbound_pending_qty: number }>>`
        SELECT inbound_pending_qty
          FROM stock_summary_view
         WHERE sku_id = ${fixture.skuIds[0]} AND warehouse_id = ${fixture.warehouseId}`;
      expect(Number(viewRow.inbound_pending_qty)).toBe(6);

      const orphanItems = await client`
        SELECT ipi.id FROM inbound_plan_items ipi
        JOIN inbound_plans ip ON ip.id = ipi.plan_id
        LEFT JOIN purchase_order_lines pol
          ON pol.po_id = ip.linked_purchase_order_id AND pol.sku_id = ipi.sku_id
        WHERE pol.po_id IS NULL`;
      const missingLinks = await client`
        SELECT irl.id FROM inbound_receipt_lines irl
        LEFT JOIN purchase_order_receipt_lines porl ON porl.receipt_line_id = irl.id
        WHERE irl.plan_item_id IS NOT NULL AND porl.receipt_line_id IS NULL`;
      const staleCounters = await client`
        SELECT pol.po_id, pol.sku_id FROM purchase_order_lines pol
        LEFT JOIN purchase_order_receipt_lines porl
          ON porl.po_id = pol.po_id AND porl.sku_id = pol.sku_id
        LEFT JOIN inbound_receipt_lines irl ON irl.id = porl.receipt_line_id
        GROUP BY pol.po_id, pol.sku_id, pol.received_qty
        HAVING pol.received_qty <> COALESCE(SUM(irl.quantity - irl.canceled_qty), 0)`;
      expect(orphanItems).toHaveLength(0);
      expect(missingLinks).toHaveLength(0);
      expect(staleCounters).toHaveLength(0);
    });
  });

  it('rejects duplicate legacy items for one purchase-order SKU (P1) and rolls back both migrations', async () => {
    await expectAtomicMigrationRejection(
      'p1',
      async (client) => {
        const fixture = await seedCatalog(client, 1);
        const poId = await seedPurchaseOrder(client, fixture, fixture.skuIds[0], { orderedQty: 2 });
        await seedPlanItem(client, fixture, poId, fixture.skuIds[0], { expectedQty: 1 });
        await seedPlanItem(client, fixture, poId, fixture.skuIds[0], { expectedQty: 1 });
      },
      /backfill guard: 한 발주·SKU.*\(P1\)/,
    );
  });

  it('rejects a legacy destination plan (P2) and rolls back both migrations', async () => {
    await expectAtomicMigrationRejection(
      'p2',
      async (client) => {
        const fixture = await seedCatalog(client, 1);
        const poId = await seedPurchaseOrder(client, fixture, fixture.skuIds[0], { orderedQty: 1 });
        await seedPlanItem(client, fixture, poId, fixture.skuIds[0], { planType: 'destination', expectedQty: 1 });
      },
      /backfill guard: destination.*\(P2\)/,
    );
  });

  it('rejects status and ordered_qty disagreement (P3) and rolls back both migrations', async () => {
    await expectAtomicMigrationRejection(
      'p3',
      async (client) => {
        const fixture = await seedCatalog(client, 1);
        await seedPurchaseOrder(client, fixture, fixture.skuIds[0], {
          lineStatus: 'requested',
          orderedQty: 1,
        });
      },
      /ck_po_lines_ordered_qty|backfill guard: status.*\(P3\)/,
    );
  });

  it('rejects an orphan legacy plan item or receipt link and rolls back both migrations', async () => {
    await expectAtomicMigrationRejection(
      'orphan',
      async (client) => {
        const fixture = await seedCatalog(client, 2);
        const poId = await seedPurchaseOrder(client, fixture, fixture.skuIds[0], { orderedQty: 1 });
        const orphanItem = await seedPlanItem(client, fixture, poId, fixture.skuIds[1], {
          expectedQty: 1,
          receivedQty: 1,
        });
        await seedReceiptLine(client, fixture, fixture.skuIds[1], orphanItem, 1);
      },
      /fk_po_receipt_lines_line|foreign key|backfill parity guard: 옛 입고예정 품목/,
    );
  });

  it('rejects a stale legacy received cache that differs from linked net receipt quantities', async () => {
    await expectAtomicMigrationRejection(
      'stale',
      async (client) => {
        const fixture = await seedCatalog(client, 1);
        const poId = await seedPurchaseOrder(client, fixture, fixture.skuIds[0], { orderedQty: 10 });
        const itemId = await seedPlanItem(client, fixture, poId, fixture.skuIds[0], {
          expectedQty: 10,
          receivedQty: 5,
        });
        await seedReceiptLine(client, fixture, fixture.skuIds[0], itemId, 4);
      },
      /backfill parity guard: 발주 받은 누계와 링크된 회차 라인 합계/,
    );
  });
});

function firstBackfillGuardStatement(): string {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as MigrationJournal;
  const entry = journal.entries.find(({ tag }) => tag.endsWith('_backfill-purchase-order-receiving'));
  if (!entry) throw new Error('PR-B backfill migration file must exist');
  const [guard] = readFileSync(join(DRIZZLE_DIR, `${entry.tag}.sql`), 'utf8').split('--> statement-breakpoint');
  return guard;
}

describeIfDb('purchase-order receiving backfill precondition guard re-execution', () => {
  jest.setTimeout(60_000);
  let admin: postgres.Sql;
  let client: postgres.Sql;
  let databaseName: string;

  beforeAll(async () => {
    admin = openClient(databaseUrl('postgres'));
    databaseName = ownedDatabaseName('guard_reexecution');
    await admin.unsafe(`CREATE DATABASE ${quotedIdentifier(databaseName)} TEMPLATE template0`);
    client = openClient(databaseUrl(databaseName));
    await applyMigrations(client, migrationChain().beforePrB);
  });

  afterAll(async () => {
    if (client) await client.end();
    if (!admin) return;
    await admin`SELECT pg_terminate_backend(pid)
                  FROM pg_stat_activity
                 WHERE datname = ${databaseName} AND pid <> pg_backend_pid()`;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${quotedIdentifier(databaseName)}`);
    await admin.end();
  });

  it('raises P1 when one purchase-order SKU has two legacy plan items', async () => {
    await expect(
      client.begin(async (tx) => {
        const sql = taggable(tx);
        const holderId = randomUUID();
        const warehouseId = randomUUID();
        const skuId = randomUUID();
        const poId = randomUUID();
        const planId = randomUUID();
        await sql`INSERT INTO holders (id, name) VALUES (${holderId}, ${`guard-holder-${holderId}`})`;
        await sql`INSERT INTO warehouses (id, name) VALUES (${warehouseId}, ${`guard-wh-${warehouseId}`})`;
        await sql`INSERT INTO skus (id, holder_id, name, code)
                 VALUES (${skuId}, ${holderId}, 'guard-sku', ${`GUARD-${skuId}`})`;
        await sql`INSERT INTO purchase_orders
          (id, type, status, source_warehouse_id, destination_warehouse_id, requires_transfer)
          VALUES (${poId}, 'domestic', 'confirmed', ${warehouseId}, ${warehouseId}, false)`;
        await sql`INSERT INTO purchase_order_lines (po_id, sku_id, quantity, status, ordered_qty)
                 VALUES (${poId}, ${skuId}, 2, 'ordered', 2)`;
        await sql`INSERT INTO inbound_plans
          (id, warehouse_id, plan_type, linked_purchase_order_id, destination_warehouse_id, requires_transfer)
          VALUES (${planId}, ${warehouseId}, 'source', ${poId}, ${warehouseId}, false)`;
        await sql`INSERT INTO inbound_plan_items (plan_id, sku_id, expected_qty)
                 VALUES (${planId}, ${skuId}, 1), (${planId}, ${skuId}, 1)`;
        await tx.unsafe(firstBackfillGuardStatement());
      }),
    ).rejects.toThrow(/backfill guard: 한 발주·SKU.*\(P1\)/);
  });

  it('passes when no legacy row violates P1, P2, or P3', async () => {
    await client.begin(async (tx) => {
      await tx.unsafe(firstBackfillGuardStatement());
    });
  });
});
