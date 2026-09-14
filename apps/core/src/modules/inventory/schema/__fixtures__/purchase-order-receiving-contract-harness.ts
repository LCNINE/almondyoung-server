import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as postgres from 'postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles, type MigrationMeta } from 'drizzle-orm/migrator';

export const DATABASE_URL = process.env.DATABASE_URL;
export const describeIfDb = DATABASE_URL ? describe : describe.skip;
export const DRIZZLE_DIR = join(__dirname, '..', '..', '..', '..', '..', 'drizzle');

interface MigrationJournal {
  entries: Array<{ tag: string }>;
}

export interface ContractMigrationChain {
  throughPrB: MigrationMeta[];
  throughContract: MigrationMeta[];
  tags: string[];
}

export interface ContractFixture {
  holderId: string;
  warehouseId: string;
  otherWarehouseId: string;
  poId: string;
  poSkuId: string;
  directSkuId: string;
  planId: string;
  planItemId: string;
  purchaseReceiptId: string;
  purchaseReceiptLineId: string;
  directReceiptId: string;
  directReceiptLineId: string;
  workLogId: string;
}

export function migrationChain(): ContractMigrationChain {
  const journal = JSON.parse(readFileSync(join(DRIZZLE_DIR, 'meta', '_journal.json'), 'utf8')) as MigrationJournal;
  const backfillIndex = journal.entries.findIndex(({ tag }) => tag.endsWith('_backfill-purchase-order-receiving'));
  if (backfillIndex < 0) throw new Error('PR-B backfill migration file must exist');

  const migrations = readMigrationFiles({ migrationsFolder: DRIZZLE_DIR });
  return {
    throughPrB: migrations.slice(0, backfillIndex + 1),
    throughContract: migrations,
    tags: journal.entries.map(({ tag }) => tag),
  };
}

export function databaseUrl(databaseName: string): string {
  const url = new URL(DATABASE_URL as string);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function ownedDatabaseName(label: string): string {
  return `pr_c_t1_${label}_${process.pid}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

function quotedIdentifier(value: string): string {
  if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`unsafe database identifier: ${value}`);
  return `"${value}"`;
}

export function openClient(url: string): postgres.Sql {
  return postgres(url, { max: 1, onnotice: () => undefined });
}

export async function applyMigrations(client: postgres.Sql, migrations: MigrationMeta[]): Promise<void> {
  const db = drizzle(client);
  const session = db._.session as unknown as Parameters<PgDialect['migrate']>[1];
  await new PgDialect().migrate(migrations, session, { migrationsFolder: DRIZZLE_DIR });
}

export function causeChainMessage(error: unknown): string {
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

export class ContractDatabaseHarness {
  readonly chain = migrationChain();
  private admin?: postgres.Sql;
  private templateDatabase?: string;
  private readonly ownedDatabases = new Set<string>();

  async setup(): Promise<void> {
    this.admin = openClient(databaseUrl('postgres'));
    this.templateDatabase = ownedDatabaseName('base');
    await this.createDatabase(this.templateDatabase);
    const client = openClient(databaseUrl(this.templateDatabase));
    try {
      await applyMigrations(client, this.chain.throughPrB);
    } finally {
      await client.end();
    }
  }

  async dispose(): Promise<void> {
    if (!this.admin) return;
    for (const name of [...this.ownedDatabases].reverse()) await this.dropDatabase(name);
    await this.admin.end();
  }

  async withPrBDatabase(
    label: string,
    run: (fixture: { client: postgres.Sql; databaseName: string; url: string }) => Promise<void>,
  ): Promise<void> {
    if (!this.templateDatabase) throw new Error('contract database harness is not initialized');
    const databaseName = ownedDatabaseName(label);
    await this.createDatabase(databaseName, this.templateDatabase);
    const url = databaseUrl(databaseName);
    const client = openClient(url);
    try {
      await run({ client, databaseName, url });
    } finally {
      await client.end();
      await this.dropDatabase(databaseName);
    }
  }

  async withEmptyDatabase(
    label: string,
    run: (fixture: { client: postgres.Sql; databaseName: string; url: string }) => Promise<void>,
  ): Promise<void> {
    const databaseName = ownedDatabaseName(label);
    await this.createDatabase(databaseName);
    const url = databaseUrl(databaseName);
    const client = openClient(url);
    try {
      await run({ client, databaseName, url });
    } finally {
      await client.end();
      await this.dropDatabase(databaseName);
    }
  }

  private async createDatabase(name: string, template = 'template0'): Promise<void> {
    if (!this.admin) throw new Error('contract database harness is not initialized');
    await this.admin.unsafe(`CREATE DATABASE ${quotedIdentifier(name)} TEMPLATE ${quotedIdentifier(template)}`);
    this.ownedDatabases.add(name);
  }

  private async dropDatabase(name: string): Promise<void> {
    if (!this.admin) return;
    await this.admin`SELECT pg_terminate_backend(pid)
                       FROM pg_stat_activity
                      WHERE datname = ${name} AND pid <> pg_backend_pid()`;
    await this.admin.unsafe(`DROP DATABASE IF EXISTS ${quotedIdentifier(name)}`);
    this.ownedDatabases.delete(name);
  }
}

export async function seedContractFixture(
  client: postgres.Sql,
  options: { receivedQty?: number; receiptQuantity?: number; canceledQty?: number; createLink?: boolean } = {},
): Promise<ContractFixture> {
  const holderId = randomUUID();
  const warehouseId = randomUUID();
  const otherWarehouseId = randomUUID();
  const poId = randomUUID();
  const poSkuId = randomUUID();
  const directSkuId = randomUUID();
  const planId = randomUUID();
  const planItemId = randomUUID();
  const purchaseReceiptId = randomUUID();
  const purchaseReceiptLineId = randomUUID();
  const directReceiptId = randomUUID();
  const directReceiptLineId = randomUUID();
  const workLogId = randomUUID();
  const receiptQuantity = options.receiptQuantity ?? 5;
  const canceledQty = options.canceledQty ?? 1;
  const receivedQty = options.receivedQty ?? receiptQuantity - canceledQty;

  await client`INSERT INTO holders (id, name) VALUES (${holderId}, ${`contract-holder-${holderId}`})`;
  await client`INSERT INTO warehouses (id, name) VALUES
    (${warehouseId}, ${`contract-source-${warehouseId}`}),
    (${otherWarehouseId}, ${`contract-destination-${otherWarehouseId}`})`;
  await client`INSERT INTO skus (id, holder_id, name, code) VALUES
    (${poSkuId}, ${holderId}, 'contract-po-sku', ${`CONTRACT-PO-${poSkuId}`}),
    (${directSkuId}, ${holderId}, 'contract-direct-sku', ${`CONTRACT-DIRECT-${directSkuId}`})`;
  await client`INSERT INTO purchase_orders
    (id, type, status, source_warehouse_id, destination_warehouse_id, requires_transfer)
    VALUES (${poId}, 'domestic', 'confirmed', ${warehouseId}, ${otherWarehouseId}, false)`;
  await client`INSERT INTO purchase_order_lines
    (po_id, sku_id, quantity, status, ordered_qty, received_qty)
    VALUES (${poId}, ${poSkuId}, 10, 'ordered', 10, ${receivedQty})`;
  await client`INSERT INTO inbound_plans
    (id, warehouse_id, plan_type, linked_purchase_order_id, destination_warehouse_id, requires_transfer)
    VALUES (${planId}, ${warehouseId}, 'source', ${poId}, ${otherWarehouseId}, false)`;
  await client`INSERT INTO inbound_plan_items
    (id, plan_id, sku_id, expected_qty, received_qty, status)
    VALUES (${planItemId}, ${planId}, ${poSkuId}, 10, ${receivedQty}, 'receiving')`;
  await client`INSERT INTO inbound_receipts
    (id, method, warehouse_id, occurred_at, total_quantity)
    VALUES
      (${purchaseReceiptId}, 'planned', ${warehouseId}, ${new Date('2026-09-10T01:02:03Z')}, ${receiptQuantity}),
      (${directReceiptId}, 'simple', ${warehouseId}, ${new Date('2026-09-10T04:05:06Z')}, 2)`;
  await client`INSERT INTO inbound_receipt_lines
    (id, receipt_id, sku_id, quantity, canceled_qty, source, plan_item_id, memo)
    VALUES
      (${purchaseReceiptLineId}, ${purchaseReceiptId}, ${poSkuId}, ${receiptQuantity}, ${canceledQty},
       'purchase_order', ${planItemId}, 'legacy purchase receipt'),
      (${directReceiptLineId}, ${directReceiptId}, ${directSkuId}, 2, 0, 'direct', null, 'direct receipt')`;
  if (options.createLink ?? true) {
    await client`INSERT INTO purchase_order_receipt_lines (po_id, sku_id, receipt_line_id)
      VALUES (${poId}, ${poSkuId}, ${purchaseReceiptLineId})`;
  }
  await client`INSERT INTO inbound_work_logs
    (id, type, receipt_id, line_id, plan_item_id, sku_id, warehouse_id, quantity, method, reason)
    VALUES (${workLogId}, 'INBOUND', ${purchaseReceiptId}, ${purchaseReceiptLineId}, ${planItemId}, ${poSkuId},
            ${warehouseId}, ${receiptQuantity}, 'planned', 'contract fixture')`;

  return {
    holderId,
    warehouseId,
    otherWarehouseId,
    poId,
    poSkuId,
    directSkuId,
    planId,
    planItemId,
    purchaseReceiptId,
    purchaseReceiptLineId,
    directReceiptId,
    directReceiptLineId,
    workLogId,
  };
}
