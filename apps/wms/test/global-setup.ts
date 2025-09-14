import { config } from 'dotenv';
import { resolve } from 'path';
import * as postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql as dsql } from 'drizzle-orm';
import { wmsTables } from '../database/schemas/wms-schema';

module.exports = async () => {
  // Load test environment variables
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
    console.log('🧹 Cleaning up test database...');

    // Disable FK checks temporarily for faster cleanup
    await db.execute(dsql.raw('SET session_replication_role = replica'));

    // Define core tables that need cleanup (in safe order, though FK is disabled)
    const coreTables = [
      // Transaction and event tables
      'audit_logs', 'outbox_events', 'stock_events', 'stock_ledgers', 'order_events',

      // Business transaction tables
      'stock_reservations', 'fulfillment_order_lines', 'fulfillment_orders',
      'sales_order_lines', 'sales_orders', 'stock_summary',

      // Product and inventory tables
      'product_variant_sku_links', 'product_matchings', 'product_option_matchings',
      'sku_barcodes', 'sku_suppliers', 'sku_categories', 'skus',
      'inventory_master_sku_links', 'inventory_product_masters',

      // Location and movement tables
      'movement_work_logs', 'movement_job_lines', 'movement_jobs',
      'locations', 'location_racks', 'location_columns',

      // Inbound/Outbound tables
      'inbound_work_logs', 'inbound_receipt_lines', 'inbound_receipts',
      'inbound_plan_items', 'inbound_plans', 'inbound_lists',
      'outbound_task_lines', 'outbound_task_items', 'outbound_task_orders', 'outbound_tasks',

      // Order management
      'returns', 'shipment_tracking', 'shipments', 'merge_groups',

      // Purchase orders
      'purchase_order_lines', 'purchase_orders', 'purchase_order_cart',

      // Configuration tables (less critical) - HOLDERS LAST since SKUs depend on it
      'sales_variant_policies', 'delivery_profiles', 'holders'
    ];

    // Truncate tables safely
    for (const tableName of coreTables) {
      try {
        await db.execute(dsql.raw(`TRUNCATE TABLE "${tableName}" RESTART IDENTITY`));
      } catch (error: any) {
        // Log but don't fail - table might not exist in this version
        console.warn(`⚠️  Could not truncate ${tableName}: ${error.message}`);
      }
    }

    // Re-enable FK checks
    await db.execute(dsql.raw('SET session_replication_role = DEFAULT'));

    console.log('🌱 Setting up essential seed data...');

    // Insert essential seed data that tests depend on

    // 0. Default holder (required by SKU FK constraint)
    const defaultHolder = {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Default Holder',
      isOurAsset: true
    };

    try {
      await db.insert(wmsTables.holders).values(defaultHolder).onConflictDoNothing();
    } catch (error: any) {
      console.warn(`⚠️  Could not insert default holder: ${error.message}`);
    }

    // 1. Default warehouse (required by many FK constraints)
    const defaultWarehouse = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Test Warehouse',
      code: 'TEST_WH',
      address: 'Test Address',
      isActive: true
    };

    try {
      await db.insert(wmsTables.warehouses).values(defaultWarehouse).onConflictDoNothing();
    } catch (error: any) {
      console.warn(`⚠️  Could not insert default warehouse: ${error.message}`);
    }

    // 2. Default supplier (required by SKU FK)
    const defaultSupplier = {
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Test Supplier',
      contactInfo: { email: 'test@supplier.com' } as any
    };

    try {
      await db.insert(wmsTables.suppliers).values(defaultSupplier).onConflictDoNothing();
    } catch (error: any) {
      console.warn(`⚠️  Could not insert default supplier: ${error.message}`);
    }

    // 3. Default category (required by SKU FK)
    const defaultCategory = {
      id: '00000000-0000-0000-0000-000000000003',
      name: 'Test Category',
      path: '/test-category'
    };

    try {
      await db.insert(wmsTables.categories).values(defaultCategory).onConflictDoNothing();
    } catch (error: any) {
      console.warn(`⚠️  Could not insert default category: ${error.message}`);
    }

    console.log('✅ Test database setup completed');

  } catch (error: any) {
    console.error('❌ Test database setup failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
};