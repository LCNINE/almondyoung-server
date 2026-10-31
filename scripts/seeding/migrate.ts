#!/usr/bin/env tsx

/**
 * db:migrate — 등록된 drizzle 서비스 전체에 대해 `drizzle-kit migrate` 실행.
 *
 * Usage:
 *   npm run db:migrate -- --stage dev --deployment lcnine-services --yes
 *   npm run db:migrate -- --stage dev --deployment lcnine-services --tenant <slug> --yes   # 그 테넌트 core DB 하나만
 *
 * core 는 테넌트 목록(SSM `/lcnine-auth/<stage>/tenant-list`)의 테넌트마다 DB 하나로 펼친다(`lib/tenant-registry.ts`).
 * 목록에 아직 없는 준비 중 테넌트는 `--tenant` 로만 닿는다.
 *
 * autodeploy workflow 의 핵심 step. forward-only, idempotent (drizzle migrator 자체가
 * `__drizzle_migrations` 로 적용 이력 관리).
 */

import chalk from 'chalk';
import { runSchemaSync } from './phases/02-schema-sync';
import { ensureInsideSstShell, parseCommonArgs } from './lib/sst-shell-relaunch';

async function main() {
  const parsed = parseCommonArgs(process.argv);
  await ensureInsideSstShell(parsed);

  console.log(chalk.bold.cyan('\n=== db:migrate ==='));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (parsed.deployment) console.log(chalk.gray(`  Deployment: ${parsed.deployment}`));
  if (parsed.tenant) console.log(chalk.gray(`  Tenant: ${parsed.tenant} (core DB 하나만)`));

  const synced = await runSchemaSync({ yes: parsed.yes, deployment: parsed.deployment, tenant: parsed.tenant });

  console.log(`\n  Schemas migrated: ${synced.length > 0 ? chalk.green(synced.join(', ')) : chalk.gray('none')}`);
}

main().catch((error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});
