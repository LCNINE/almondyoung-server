#!/usr/bin/env tsx

/**
 * db:migrate — 등록된 drizzle 서비스 전체에 대해 `drizzle-kit migrate` 실행.
 *
 * Usage:
 *   npm run db:migrate -- --stage dev --deployment lcnine-services --yes
 *
 * autodeploy workflow 의 핵심 step. forward-only, idempotent (drizzle migrator 자체가
 * `__drizzle_migrations` 로 적용 이력 관리).
 */

import chalk from 'chalk';
import { runSchemaSync } from './phases/02-schema-sync';
import { ensureInsideSstShell, parseCommonArgs } from './lib/sst-shell-relaunch';

async function main() {
  const parsed = parseCommonArgs(process.argv);
  await ensureInsideSstShell({ stage: parsed.stage, deployment: parsed.deployment });

  console.log(chalk.bold.cyan('\n=== db:migrate ==='));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (parsed.deployment) console.log(chalk.gray(`  Deployment: ${parsed.deployment}`));

  const synced = await runSchemaSync({ yes: parsed.yes, deployment: parsed.deployment });

  console.log(
    `\n  Schemas migrated: ${synced.length > 0 ? chalk.green(synced.join(', ')) : chalk.gray('none')}`,
  );
}

main().catch((error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});
