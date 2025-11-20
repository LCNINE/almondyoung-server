import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import * as postgres from 'postgres';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
import * as path from 'path';
import * as fs from 'fs';

// 파일 상단에 헬퍼 함수 추가
const shouldLog = () => process.env.TEST_VERBOSE === 'true' || process.env.TEST_DEBUG === 'true';
const testLog = (message: string) => {
  if (shouldLog()) {
    console.log(message);
  }
};

export class WmsTestDatabase {
  private static container: StartedPostgreSqlContainer | undefined;
  private static connection: postgres.Sql<{}> | undefined;
  private static db: ReturnType<typeof drizzle<typeof wmsSchema>> | undefined;
  private static isInitialized = false;

  static async setup(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    testLog('🐳 Starting PostgreSQL test container...');

    this.container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('wms_test')
      .withUsername('test_user')
      .withPassword('test_password')
      .withExposedPorts(5432)
      .start();

    testLog(`✅ PostgreSQL container started on port ${this.container.getMappedPort(5432)}`);

    // Create connection
    const connectionString = this.container.getConnectionUri();
    this.connection = postgres(connectionString, { 
      max: 1,
      onnotice: () => {} // NOTICE 메시지 무시
    });
    this.db = drizzle(this.connection, { schema: wmsSchema });

    // Enable required extensions and create simple uuid_v7 function
    testLog('🔧 Setting up PostgreSQL extensions and functions...');
    await this.connection`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;

    // Create a simplified uuid_v7 function for testing (using gen_random_uuid for compatibility)
    await this.connection`
      CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
      BEGIN
        RETURN gen_random_uuid();
      END;
      $$ LANGUAGE plpgsql VOLATILE;
    `;

    // Create WMS tables using migrations
    testLog('📋 Creating WMS tables from schema...');
    try {
      const migrationsPath = path.resolve(__dirname, '../../database/drizzle');
      await migrate(this.db, {
        migrationsFolder: migrationsPath,
      });

      testLog('✅ WMS schema tables created successfully');

      this.isInitialized = true;

      // Create basic infrastructure data
      testLog('🏗️ Creating basic infrastructure data...');
      await this.createBasicInfrastructure();
    } catch (error) {
      console.error('❌ Failed to create WMS schema tables:', error.message);
      throw new Error(
        `Failed to create WMS schema tables in test database. ` +
        `This indicates a problem with the WMS schema or database setup. ` +
        `Error: ${error.message}`
      );
    }
  }

  static async teardown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    testLog('🧹 Cleaning up test database...');

    try {
      if (this.connection) {
        // Close all active connections
        await this.connection.end({ timeout: 5 });
      }
    } catch (error) {
      console.warn('Warning: Connection cleanup failed:', error.message);
    }

    try {
      if (this.container) {
        await this.container.stop();
        testLog('✅ PostgreSQL container stopped');
      }
    } catch (error) {
      console.warn('Warning: Container stop failed:', error.message);
    }

    this.isInitialized = false;
    this.connection = undefined;
    this.db = undefined;
    this.container = undefined;
  }

  static getDb() {
    if (!this.isInitialized || !this.db) {
      throw new Error('WmsTestDatabase not initialized. Call setup() first.');
    }
    return this.db;
  }

  static getConnectionString(): string {
    if (!this.container) {
      throw new Error('WmsTestDatabase not initialized. Call setup() first.');
    }
    return this.container.getConnectionUri();
  }

  static async clearAllTables(): Promise<void> {
    const db = this.getDb();

    testLog('🧽 Clearing all tables...');

    // Disable foreign key checks temporarily
    await db.execute(sql`SET session_replication_role = 'replica'`);

    // Clear WMS tables (clear in dependency order to avoid FK violations)
    const orderedTables = [
      'fulfillmentOrderItems',
      'stockReservations',
      'fulfillmentOrders',
      'salesOrderLines',
      'salesOrders',
      'productSkuMappingSnapshots',
      'outboundBatches',
      'stockEvents',
      'stockSummary',
      'skus',
      'warehouses',
      'suppliers'
    ];

    for (const tableName of orderedTables) {
      if (wmsTables[tableName]) {
        try {
          await db.delete(wmsTables[tableName]);
        } catch (error) {
          // Only warn for non-critical tables that might not exist
          console.warn(`Warning: Could not clear table ${tableName}:`, error.message);
        }
      }
    }

    // Re-enable foreign key checks
    await db.execute(sql`SET session_replication_role = 'origin'`);

    testLog('✅ All tables cleared');
  }

  static async resetSequences(): Promise<void> {
    const db = this.getDb();

    // Reset any auto-increment sequences if needed
    // PostgreSQL uses UUIDs mostly, so this might not be necessary
    testLog('🔄 Resetting sequences (if any)...');
  }

  static async getTableCounts(): Promise<Record<string, number>> {
    const db = this.getDb();
    const counts: Record<string, number> = {};

    const mainTables = ['warehouses', 'skus'];

    for (const tableName of mainTables) {
      if (wmsTables[tableName]) {
        try {
          const result = await db.select({ count: sql`count(*)` }).from(wmsTables[tableName]);
          counts[tableName] = Number(result[0]?.count || 0);
        } catch (error) {
          counts[tableName] = -1; // Error indicator
        }
      }
    }

    return counts;
  }

  private static async createBasicInfrastructure(): Promise<void> {
    const db = this.getDb();

    // Create default holder
    await db.insert(wmsTables.holders).values({
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Default Holder',
      isOurAsset: true
    }).onConflictDoNothing();

    // Create default supplier
    await db.insert(wmsTables.suppliers).values({
      name: 'Default Supplier',
      contactInfo: { email: 'test@example.com', phone: '010-1234-5678' }
    }).onConflictDoNothing();

    testLog('✅ Basic infrastructure data created');
  }
}

