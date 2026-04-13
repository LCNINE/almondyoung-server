import { execSync } from 'child_process';
import chalk from 'chalk';
import { checkbox, confirm } from '@inquirer/prompts';
import { SERVICE_REGISTRY } from '../lib/service-registry';
import { buildDatabaseUrl } from '../lib/db-connection';
import { Logger } from '../lib/logger';

const logger = new Logger('Schema Sync');

/**
 * auth 스키마(auth.scopes, auth.role_scope_mapping)는 drizzle-kit pgSchema 버그로 인해
 * 별도 raw SQL 마이그레이션으로 관리됨. user-service DB push 후 실행 필요.
 */
function runAuthSchemaMigration(databaseUrl: string): void {
  try {
    logger.info('Running auth schema migration...');
    execSync(
      `ts-node -r tsconfig-paths/register libs/authorization/scripts/migrate-auth-schema.ts "${databaseUrl}"`,
      { stdio: 'inherit' },
    );
  } catch {
    logger.error('Failed to run auth schema migration');
  }
}

export async function runSchemaSync(options: { yes: boolean }): Promise<string[]> {
  console.log(chalk.bold.cyan('\nPhase 2: Schema Sync'));
  console.log(chalk.cyan('─'.repeat(40)));

  const services = SERVICE_REGISTRY.filter((s) => s.drizzleConfig);

  if (options.yes) {
    // Non-interactive: push all
    const synced: string[] = [];
    for (const svc of services) {
      const url = buildDatabaseUrl(svc.database);
      console.log(`\n  ${chalk.bold(`── Pushing: ${svc.name} ──`)}`);
      try {
        execSync(`drizzle-kit push --config ${svc.drizzleConfig}`, {
          stdio: 'inherit',
          env: { ...process.env, DATABASE_URL: url },
        });
        runAuthSchemaMigration(url);
        synced.push(svc.name);
      } catch {
        logger.error(`Failed to push: ${svc.name}`);
      }
    }
    return synced;
  }

  // Interactive: let user pick which services to sync
  const selected = await checkbox({
    message: 'Select services to sync schema:',
    choices: services.map((svc) => ({
      name: svc.name,
      value: svc.name,
      checked: true,
    })),
  });

  if (selected.length === 0) {
    logger.warn('No services selected, skipping schema sync');
    return [];
  }

  const synced: string[] = [];
  for (const svcName of selected) {
    const svc = services.find((s) => s.name === svcName)!;
    const url = buildDatabaseUrl(svc.database);

    const shouldPush = await confirm({
      message: `Push schema for ${svc.name}?`,
      default: true,
    });

    if (!shouldPush) {
      logger.info(`Skipped: ${svc.name}`);
      continue;
    }

    console.log(`\n  ${chalk.bold(`── Pushing: ${svc.name} ──`)}`);
    try {
      execSync(`drizzle-kit push --config ${svc.drizzleConfig} --strict`, {
        stdio: 'inherit',
        env: { ...process.env, DATABASE_URL: url },
      });
      runAuthSchemaMigration(url);
      synced.push(svc.name);
    } catch {
      logger.error(`Failed to push: ${svc.name}`);
    }
  }

  return synced;
}
