#!/usr/bin/env tsx

/**
 * db:seed:ref — 운영에 필요한 reference seed (비-demo 그룹).
 *
 * Usage:
 *   npm run db:seed:ref -- --stage dev --deployment lcnine-services --yes
 *   npm run db:seed:ref -- --stage dev --deployment lcnine-services --tenant <slug> --yes   # 그 테넌트 core DB 하나만
 *
 * core 는 테넌트 목록(SSM `/lcnine-auth/<stage>/tenant-list`)의 테넌트마다 DB 하나로 펼친다(`lib/tenant-registry.ts`).
 * 목록에 아직 없는 준비 중 테넌트는 `--tenant` 로만 닿는다.
 *
 * autodeploy workflow 의 마지막 DB step. 멱등성 필수 — UPSERT / ON CONFLICT DO NOTHING.
 * group prefix 'demo-' 이 *아닌* 모든 그룹을 순회 실행한다 ('baseline' · 'baseline-tenant-1' — `lib/seed-groups.ts`).
 * core 는 테넌트 DB 마다: 테넌트 1(기존 core DB)엔 두 갈래, 그 밖의 테넌트 DB 엔 'baseline' 의 core 스텝만 들어간다.
 * backfill 그룹은 사람이 명시적으로 선택할 때만 실행한다.
 */

import chalk from 'chalk';
import { runSeeding, listGroupsForRegistry } from './phases/03-seed-orchestrator';
import { resolveRegistry } from './lib/tenant-registry';
import { ensureInsideSstShell, parseCommonArgs } from './lib/sst-shell-relaunch';
import { selectReferenceSeedGroups } from './lib/seed-groups';

async function main() {
  const parsed = parseCommonArgs(process.argv);
  await ensureInsideSstShell(parsed);

  console.log(chalk.bold.cyan('\n=== db:seed:ref ==='));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (parsed.deployment) console.log(chalk.gray(`  Deployment: ${parsed.deployment}`));
  if (parsed.tenant) console.log(chalk.gray(`  Tenant: ${parsed.tenant} (core DB 하나만)`));

  // 그룹은 테넌트 목록으로 펼친 레지스트리에서 모은다 — `--tenant` 로 새 테넌트 DB 를 지목하면 테넌트 1 전용 갈래가 없다.
  const allGroups = await listGroupsForRegistry(resolveRegistry(parsed));
  const refGroups = selectReferenceSeedGroups(allGroups);

  if (refGroups.length === 0) {
    console.log(chalk.gray('  No reference seed groups registered for this deployment.'));
    return;
  }

  console.log(chalk.gray(`  Reference groups: ${refGroups.join(', ')}`));

  for (const group of refGroups) {
    console.log(chalk.bold.cyan(`\n── group: ${group} ──`));
    const results = await runSeeding({ yes: true, deployment: parsed.deployment, tenant: parsed.tenant, group });
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
