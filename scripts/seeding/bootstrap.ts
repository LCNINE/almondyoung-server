#!/usr/bin/env tsx

/**
 * db:bootstrap — 누락된 logical DB 를 admin connection 으로 CREATE DATABASE.
 *
 * Usage:
 *   npm run db:bootstrap -- --stage dev --deployment lcnine-services --yes
 *
 * autodeploy workflow 안에서 sst shell 진입 후 호출됨. local dev 에선 자기 자신을
 * sst shell 로 재실행 (ensureInsideSstShell).
 */

import chalk from 'chalk';
import { runDatabaseCreation } from './phases/01-database-creation';
import { ensureInsideSstShell, parseCommonArgs } from './lib/sst-shell-relaunch';

async function main() {
  const parsed = parseCommonArgs(process.argv);
  await ensureInsideSstShell({ stage: parsed.stage, deployment: parsed.deployment });

  console.log(chalk.bold.cyan('\n=== db:bootstrap ==='));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (parsed.deployment) console.log(chalk.gray(`  Deployment: ${parsed.deployment}`));

  const created = await runDatabaseCreation({ yes: parsed.yes, deployment: parsed.deployment });

  console.log(
    `\n  Databases created: ${created.length > 0 ? chalk.green(created.join(', ')) : chalk.gray('none (all existed)')}`,
  );
}

main().catch((error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});
