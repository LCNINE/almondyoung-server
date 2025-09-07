import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { sql as dsql } from 'drizzle-orm';
import { wmsTables } from '../database/schemas/wms-schema';

module.exports = async () => {
  // Load test envs
  config({ path: resolve(process.cwd(), '.env.test') });
  config({ path: resolve(process.cwd(), 'apps/wms/.env.test') });
  config();

  const dbUrl = (process.env.TEST_DB_URL || process.env.DATABASE_URL) as string;
  if (!dbUrl) {
    throw new Error('TEST_DB_URL or DATABASE_URL is required');
  }

  const client = postgres(dbUrl, { max: 1 });
  const db = drizzle(client, { schema: wmsTables });

  try {
    // Ensure uuid_v7() function exists (best-effort)
    try {
      const uuidSqlPath = resolve(process.cwd(), 'libs/db/src/snippets/uuidv7.sql');
      const uuidSql = readFileSync(uuidSqlPath, 'utf8');
      await db.execute(dsql.raw(uuidSql));
    } catch {
      // ignore
    }

    // Apply migrations
    await migrate(db as any, { migrationsFolder: resolve(process.cwd(), 'apps/wms/database/drizzle') });

    // Truncate all domain tables to start clean (FK-safe ordering)
    const tables = [
      'movement_work_logs', 'movement_job_lines', 'movement_jobs',
      'inbound_work_logs', 'inbound_receipt_lines', 'inbound_receipts',
      'inbound_plan_items', 'inbound_plans', 'inbound_lists',
      'stock_ledgers', 'stock_events', 'stock_journals', 'stock_summary', 'stock_reservations',
      'outbound_task_lines', 'outbound_task_items', 'outbound_task_orders', 'outbound_tasks',
      'order_events', 'order_items', 'orders',
      'product_option_matchings', 'product_variant_sku_links', 'product_matchings',
      'sku_barcodes', 'sku_suppliers', 'sku_categories', 'skus',
      'categories', 'suppliers',
      'returns', 'shipment_tracking', 'shipments',
      'locations', 'location_racks', 'location_columns', 'warehouses',
      'delivery_profiles', 'holders', 'settings', 'holidays', 'purchase_order_lines', 'purchase_orders', 'purchase_order_cart',
      'merge_groups'
    ];
    for (const t of tables) {
      try {
        await db.execute(dsql.raw(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`));
      } catch {
        // ignore if absent
      }
    }

    // Ensure default holder row exists (required by skus.holder_id FK default)
    const defaultHolderId = '00000000-0000-0000-0000-000000000000';
    try {
      const exists = await db.query.holders.findFirst({ where: (h, { eq }) => eq(h.id, defaultHolderId) });
      if (!exists) {
        await db.insert(wmsTables.holders).values({ id: defaultHolderId, name: 'Default Holder', isOurAsset: true });
      }
    } catch {
      // ignore
    }
  } finally {
    await (db.$client as any).end?.();
  }
};


