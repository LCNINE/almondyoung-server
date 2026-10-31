#!/usr/bin/env tsx

/**
 * db:bootstrap — 누락된 logical DB 를 admin connection 으로 CREATE DATABASE.
 *
 * Usage:
 *   npm run db:bootstrap -- --stage dev --deployment lcnine-services --yes
 *   npm run db:bootstrap -- --stage dev --deployment lcnine-services --tenant <slug> --yes   # 그 테넌트 core DB 하나만
 *
 * core 는 테넌트 목록(SSM `/lcnine-auth/<stage>/tenant-list`)의 테넌트마다 DB 하나로 펼친다(`lib/tenant-registry.ts`).
 * 목록에 아직 없는 준비 중 테넌트는 `--tenant` 로만 닿는다.
 *
 * autodeploy workflow 안에서 sst shell 진입 후 호출됨. local dev 에선 자기 자신을
 * sst shell 로 재실행 (ensureInsideSstShell).
 */

import chalk from 'chalk';
import { runDatabaseCreation } from './phases/01-database-creation';
import { ensureInsideSstShell, parseCommonArgs } from './lib/sst-shell-relaunch';

async function main() {
  const parsed = parseCommonArgs(process.argv);
  await ensureInsideSstShell(parsed);

  console.log(chalk.bold.cyan('\n=== db:bootstrap ==='));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (parsed.deployment) console.log(chalk.gray(`  Deployment: ${parsed.deployment}`));
  if (parsed.tenant) console.log(chalk.gray(`  Tenant: ${parsed.tenant} (core DB 하나만)`));

  const created = await runDatabaseCreation({ yes: parsed.yes, deployment: parsed.deployment, tenant: parsed.tenant });

  console.log(
    `\n  Databases created: ${created.length > 0 ? chalk.green(created.join(', ')) : chalk.gray('none (all existed)')}`,
  );
}

main().catch((error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});
