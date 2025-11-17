import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import * as postgres from 'postgres';
import { pimSchema } from '../../src/schema';
import type { PimSchema } from '../../src/schema';

export class PimTestDatabase {
  private static container: StartedPostgreSqlContainer | undefined;
  private static connection: postgres.Sql<{}> | undefined;
  private static db: ReturnType<typeof drizzle<PimSchema>> | undefined;
  private static isInitialized = false;

  static async setup(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // console.log('🐳 Starting PostgreSQL test container...');

    this.container = await new PostgreSqlContainer('postgres:15-alpine')
      .withDatabase('pim_test')
      .withUsername('test_user')
      .withPassword('test_password')
      .withExposedPorts(5432)
      .start();

    // console.log(`✅ PostgreSQL container started on port ${this.container.getMappedPort(5432)}`);

    // Create connection
    const connectionString = this.container.getConnectionUri();
    this.connection = postgres(connectionString, { max: 1 });
    this.db = drizzle(this.connection, { schema: pimSchema });

    // Enable required extensions and create simple uuid_v7 function
    // console.log('🔧 Setting up PostgreSQL extensions and functions...');
    await this.connection`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`;

    // Create a simplified uuid_v7 function for testing (using gen_random_uuid for compatibility)
    await this.connection`
      CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
      BEGIN
        RETURN gen_random_uuid();
      END;
      $$ LANGUAGE plpgsql VOLATILE;
    `;

    // Create PIM tables using drizzle-kit push
    // console.log('📋 Creating PIM tables from schema...');
    try {
      const { execSync } = require('child_process');
      const env = {
        ...process.env,
        DATABASE_URL: connectionString
      };

      execSync('npx drizzle-kit push --config apps/pim/drizzle.test-config.ts', {
        env,
        stdio: 'inherit'
      });

      // console.log('✅ PIM schema tables created successfully');

      this.isInitialized = true;

      // Create basic infrastructure data if needed
      // console.log('🏗️ Creating basic infrastructure data...');
      await this.createBasicInfrastructure();
    } catch (error) {
      console.error('❌ Failed to create PIM schema tables:', error.message);
      throw new Error(
        `Failed to create PIM schema tables in test database. ` +
        `This indicates a problem with the PIM schema or database setup. ` +
        `Error: ${error.message}`
      );
    }
  }

  static async teardown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    // console.log('🧹 Cleaning up test database...');

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
        // console.log('✅ PostgreSQL container stopped');
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
      throw new Error('PimTestDatabase not initialized. Call setup() first.');
    }
    return this.db;
  }

  static getConnectionString(): string {
    if (!this.container) {
      throw new Error('PimTestDatabase not initialized. Call setup() first.');
    }
    return this.container.getConnectionUri();
  }

  static async clearAllTables(): Promise<void> {
    const db = this.getDb();

    // console.log('🧽 Clearing all tables...');

    // Disable foreign key checks temporarily
    await db.execute(sql`SET session_replication_role = 'replica'`);

    // Clear PIM tables (clear in dependency order to avoid FK violations)
    const orderedTables = [
      'variantPrices',
      'optionValuePrices',
      'variantOptionValues',
      'productVariants',
      'productOptionValues',
      'productOptionGroups',
      'productMasterCategories',
      'productImages',
      'uploads',
      'productAuditLog',
      'productApprovalHistory',
      'productMasters',
      'productCategories',
      'channelProducts',
      'salesChannels',
    ];

    for (const tableName of orderedTables) {
      if (pimSchema[tableName]) {
        try {
          await db.delete(pimSchema[tableName]);
        } catch (error) {
          // Only warn for non-critical tables that might not exist
          console.warn(`Warning: Could not clear table ${tableName}:`, error.message);
        }
      }
    }

    // Re-enable foreign key checks
    await db.execute(sql`SET session_replication_role = 'origin'`);

    // console.log('✅ All tables cleared');
  }

  static async resetSequences(): Promise<void> {
    const db = this.getDb();

    // Reset any auto-increment sequences if needed
    // PostgreSQL uses UUIDs mostly, so this might not be necessary
    // console.log('🔄 Resetting sequences (if any)...');
  }

  static async getTableCounts(): Promise<Record<string, number>> {
    const db = this.getDb();
    const counts: Record<string, number> = {};

    const mainTables = ['productMasters', 'productCategories', 'productVariants', 'salesChannels'];

    for (const tableName of mainTables) {
      if (pimSchema[tableName]) {
        try {
          const result = await db.select({ count: sql`count(*)` }).from(pimSchema[tableName]);
          counts[tableName] = Number(result[0]?.count || 0);
        } catch (error) {
          counts[tableName] = -1; // Error indicator
        }
      }
    }

    return counts;
  }

  private static async createBasicInfrastructure(): Promise<void> {
    // No basic infrastructure needed for PIM
    // (unlike WMS which needs default holders/suppliers)
    // console.log('✅ Basic infrastructure data created (none required for PIM)');
  }
}

