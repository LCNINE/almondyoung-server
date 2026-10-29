import { execSync } from 'child_process';
import * as path from 'path';
import chalk from 'chalk';
import { getServiceRegistry } from '../lib/service-registry';
import { buildDatabaseUrl } from '../lib/db-connection';
import { Logger } from '../lib/logger';

const logger = new Logger('Schema Sync');

const PROJECT_ROOT = path.resolve(__dirname, '../../..');

/**
 * 한 서비스라도 마이그가 실패하면 나머지를 다 돌린 뒤 이걸 던진다.
 * 삼키면 db:migrate 가 exit 0 으로 끝나 운영자가 마이그 빠진 채로 배포한다.
 */
export class SchemaSyncError extends Error {
  constructor(
    readonly failed: string[],
    readonly synced: string[],
  ) {
    super(`Failed to migrate: ${failed.join(', ')}`);
    this.name = 'SchemaSyncError';
  }
}

export async function runSchemaSync(options: { yes: boolean; deployment?: string }): Promise<string[]> {
  console.log(chalk.bold.cyan('\nPhase 2: Schema Sync'));
  console.log(chalk.cyan('─'.repeat(40)));

  const registry = getServiceRegistry(options.deployment);
  const services = registry.filter((s) => s.drizzleConfig);

  const synced: string[] = [];
  const failed: string[] = [];
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
      failed.push(svc.name);
    }
  }
  if (failed.length > 0) throw new SchemaSyncError(failed, synced);
  return synced;
}
