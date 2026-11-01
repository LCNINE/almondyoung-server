import { execSync } from 'child_process';
import * as path from 'path';
import chalk from 'chalk';
import { resolveRegistry } from '../lib/tenant-registry';
import { serviceLabel } from '../lib/core-tenants';
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

/** core 는 테넌트 DB 마다 한 번씩 돈다(`resolveRegistry`). 테넌트 하나만 실패해도 던진다 — 「일부 테넌트만 새 버전」은 배포 조건 위반이다. */
export async function runSchemaSync(options: {
  yes: boolean;
  deployment?: string;
  tenant?: string;
}): Promise<string[]> {
  console.log(chalk.bold.cyan('\nPhase 2: Schema Sync'));
  console.log(chalk.cyan('─'.repeat(40)));

  const registry = resolveRegistry(options);
  const services = registry.filter((s) => s.drizzleConfig);

  const synced: string[] = [];
  const failed: string[] = [];
  for (const svc of services) {
    const url = buildDatabaseUrl(svc.database);
    const label = serviceLabel(svc);
    console.log(`\n  ${chalk.bold(`── Migrating: ${label} ──`)}`);
    try {
      execSync(`drizzle-kit migrate --config ${svc.drizzleConfig}`, {
        stdio: 'inherit',
        cwd: PROJECT_ROOT,
        env: { ...process.env, DATABASE_URL: url },
      });
      synced.push(label);
    } catch (e) {
      logger.error(`Failed to migrate: ${label}`);
      console.error(e);
      failed.push(label);
    }
  }
  if (failed.length > 0) throw new SchemaSyncError(failed, synced);
  return synced;
}
