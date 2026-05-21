#!/usr/bin/env tsx

/**
 * db:seed:ref — 운영에 필요한 reference seed (비-demo 그룹).
 *
 * Usage:
 *   npm run db:seed:ref -- --stage dev --deployment lcnine-services --yes
 *
 * autodeploy workflow 의 마지막 DB step. 멱등성 필수 — UPSERT / ON CONFLICT DO NOTHING.
 * group prefix 'demo-' 이 *아닌* 모든 그룹을 순회 실행한다 (현재 사실상 'baseline').
 */

import chalk from 'chalk';
import { runSeeding, listGroupsForDeployment } from './phases/03-seed-orchestrator';
import { ensureInsideSstShell, parseCommonArgs } from './lib/sst-shell-relaunch';

const DEMO_GROUP_PREFIX = 'demo-';

async function main() {
  const parsed = parseCommonArgs(process.argv);
  await ensureInsideSstShell({ stage: parsed.stage, deployment: parsed.deployment });

  console.log(chalk.bold.cyan('\n=== db:seed:ref ==='));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (parsed.deployment) console.log(chalk.gray(`  Deployment: ${parsed.deployment}`));

  const allGroups = await listGroupsForDeployment(parsed.deployment);
  const refGroups = allGroups.filter((g) => !g.startsWith(DEMO_GROUP_PREFIX));

  if (refGroups.length === 0) {
    console.log(chalk.gray('  No reference seed groups registered for this deployment.'));
    return;
  }

  console.log(chalk.gray(`  Reference groups: ${refGroups.join(', ')}`));

  for (const group of refGroups) {
    console.log(chalk.bold.cyan(`\n── group: ${group} ──`));
    const results = await runSeeding({ yes: true, deployment: parsed.deployment, group });
    const failed = results.filter((r) => !r.success);
    if (failed.length > 0) {
      console.error(chalk.red(`  Failed in group ${group}: ${failed.map((r) => r.service).join(', ')}`));
      process.exit(1);
    }
  }
}

main().catch((error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});
