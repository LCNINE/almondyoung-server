import { execSync } from 'child_process';
import path from 'path';
import chalk from 'chalk';
import { checkbox, confirm } from '@inquirer/prompts';
import { getServiceRegistry } from '../lib/service-registry';
import { buildDatabaseUrl } from '../lib/db-connection';
import { Logger } from '../lib/logger';

const logger = new Logger('Schema Sync');

/** drizzle config 경로는 프로젝트 루트 기준이므로 항상 루트에서 실행 */
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

export async function runSchemaSync(options: { yes: boolean; deployment?: string }): Promise<string[]> {
  console.log(chalk.bold.cyan('\nPhase 2: Schema Sync'));
  console.log(chalk.cyan('─'.repeat(40)));

  const registry = getServiceRegistry(options.deployment);
  const services = registry.filter((s) => s.drizzleConfig);

  if (options.yes) {
    // Non-interactive: push all
    const synced: string[] = [];
    for (const svc of services) {
      const url = buildDatabaseUrl(svc.database);
      console.log(`\n  ${chalk.bold(`── Pushing: ${svc.name} ──`)}`);
      try {
        execSync(`drizzle-kit push --config ${svc.drizzleConfig}`, {
          stdio: 'inherit',
          cwd: PROJECT_ROOT,
          env: { ...process.env, DATABASE_URL: url },
        });
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
        cwd: PROJECT_ROOT,
        env: { ...process.env, DATABASE_URL: url },
      });
      synced.push(svc.name);
    } catch {
      logger.error(`Failed to push: ${svc.name}`);
    }
  }

  return synced;
}
