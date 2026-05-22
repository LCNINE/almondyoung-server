import { execSync } from 'child_process';
import path from 'path';
import chalk from 'chalk';
import { getServiceRegistry } from '../lib/service-registry';
import { buildDatabaseUrl } from '../lib/db-connection';
import { Logger } from '../lib/logger';

const logger = new Logger('Schema Sync');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export async function runSchemaSync(options: { yes: boolean; deployment?: string }): Promise<string[]> {
  console.log(chalk.bold.cyan('\nPhase 2: Schema Sync'));
  console.log(chalk.cyan('─'.repeat(40)));

  const registry = getServiceRegistry(options.deployment);
  const services = registry.filter((s) => s.drizzleConfig);

  const synced: string[] = [];
  for (const svc of services) {
    const url = buildDatabaseUrl(svc.database);
    console.log(`\n  ${chalk.bold(`── Migrating: ${svc.name} ──`)}`);
    try {
      execSync(`drizzle-kit migrate --config ${svc.drizzleConfig}`, {
        stdio: 'inherit',
        cwd: PROJECT_ROOT,
        env: { ...process.env, DATABASE_URL: url },
      });
      synced.push(svc.name);
    } catch (e) {
      logger.error(`Failed to migrate: ${svc.name}`);
      console.error(e);
    }
  }
  return synced;
}
