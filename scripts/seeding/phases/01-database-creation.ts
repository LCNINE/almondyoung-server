import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { Sql } from 'postgres';
import { createAdminConnection } from '../lib/db-connection';
import { SERVICE_REGISTRY } from '../lib/service-registry';
import { DatabaseCheckResult } from '../lib/types';
import { Logger } from '../lib/logger';

const logger = new Logger('DB Creation');

export async function runDatabaseCreation(options: { yes: boolean }): Promise<string[]> {
  console.log(chalk.bold.cyan('\nPhase 1: Database Creation'));
  console.log(chalk.cyan('─'.repeat(40)));

  let adminSql: Sql | undefined;

  try {
    adminSql = createAdminConnection();

    const databases = [...new Set(SERVICE_REGISTRY.map((s) => s.database))];
    const results: DatabaseCheckResult[] = [];

    for (const dbName of databases) {
      const rows = await adminSql`SELECT 1 FROM pg_database WHERE datname = ${dbName}`;
      results.push({ name: dbName, exists: rows.length > 0 });
    }

    // Display status
    for (const r of results) {
      const icon = r.exists ? chalk.green('✓') : chalk.red('✗');
      const status = r.exists ? 'exists' : 'missing';
      console.log(`  ${icon} ${r.name.padEnd(20)} ${status}`);
    }

    const missing = results.filter((r) => !r.exists);
    if (missing.length === 0) {
      logger.success('All databases exist');
      return [];
    }

    // Confirm creation
    const shouldCreate =
      options.yes ||
      (await confirm({
        message: `Create ${missing.length} missing database(s)? (${missing.map((m) => m.name).join(', ')})`,
        default: true,
      }));

    if (!shouldCreate) {
      logger.warn('Skipped database creation');
      return [];
    }

    const created: string[] = [];
    for (const m of missing) {
      await adminSql.unsafe(`CREATE DATABASE "${m.name}"`);
      logger.success(`Created: ${m.name}`);
      created.push(m.name);
    }

    return created;
  } catch (error) {
    logger.error('Database creation phase failed', error);
    throw error;
  } finally {
    if (adminSql) await adminSql.end();
  }
}
