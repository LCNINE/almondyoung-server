#!/usr/bin/env tsx

/**
 * db:seed:demo — 데모/개발용 sample seed (demo- prefix 그룹만).
 *
 * Usage:
 *   npm run db:seed:demo -- --stage dev --deployment lcnine-services --yes
 *
 * live stage 에선 어떤 인자 조합으로도 실행 거부. autodeploy workflow 는 이 명령을
 * 호출하지 않는다 — 호출 자체가 정책 위반.
 */

import chalk from 'chalk';
import { runSeeding, listGroupsForDeployment } from './phases/03-seed-orchestrator';
import { ensureInsideSstShell, parseCommonArgs } from './lib/sst-shell-relaunch';

const DEMO_GROUP_PREFIX = 'demo-';

async function main() {
  const parsed = parseCommonArgs(process.argv);

  // live 거부는 sst shell 진입 *전* 에 수행 — autodeploy 가 실수로 live stage 로
  // 호출하면 sst shell 한 번 띄우기 전에 즉시 차단되어야 한다.
  if (parsed.stage === 'live') {
    console.error(chalk.red('  db:seed:demo refuses --stage live.'));
    process.exit(2);
  }

  await ensureInsideSstShell({ stage: parsed.stage, deployment: parsed.deployment });

  // sst shell 내부에서도 한 번 더 (defense in depth — caller 가 --stage 인자 없이 SST_STAGE 만으로 부르는 경로)
  if (process.env.SST_STAGE === 'live') {
    console.error(chalk.red('  db:seed:demo refuses SST_STAGE=live.'));
    process.exit(2);
  }

  console.log(chalk.bold.cyan('\n=== db:seed:demo ==='));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (parsed.deployment) console.log(chalk.gray(`  Deployment: ${parsed.deployment}`));

  const allGroups = await listGroupsForDeployment(parsed.deployment);
  const demoGroups = allGroups.filter((g) => g.startsWith(DEMO_GROUP_PREFIX));

  if (demoGroups.length === 0) {
    console.log(chalk.gray('  No demo seed groups registered for this deployment.'));
    return;
  }

  console.log(chalk.gray(`  Demo groups: ${demoGroups.join(', ')}`));

  for (const group of demoGroups) {
    console.log(chalk.bold.cyan(`\n── group: ${group} ──`));
    const results = await runSeeding({
      yes: true,
      deployment: parsed.deployment,
      group,
      allowDemoInProd: false,
    });
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
