#!/usr/bin/env tsx

/**
 * db:setup — interactive dev 편의 wrapper.
 *
 * Usage:
 *   npm run db:setup -- --stage dev --deployment lcnine-services
 *
 * 정책:
 *  - dev 머신에서 사람이 인터랙티브로만 호출. `--yes` / `--non-interactive` 거부.
 *  - `SST_STAGE === 'live'` 면 거부 — 운영 stage 의 deploy 경로는 SST autodeploy workflow 가
 *    직접 db:bootstrap / db:migrate / db:seed:ref 4개 명령을 호출한다 (ADR-0005 §3).
 *
 * sst shell 밖에서 호출되면 ensureInsideSstShell 이 자기 자신을 sst shell 안에서 재실행.
 */

import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { runDatabaseCreation } from './phases/01-database-creation';
import { runSchemaSync } from './phases/02-schema-sync';
import { runSeeding } from './phases/03-seed-orchestrator';
import { listGroupsForDeployment } from './phases/03-seed-orchestrator';
import { ensureInsideSstShell } from './lib/sst-shell-relaunch';
import { SetupReport, SeedApplyResult } from './lib/types';

// ─── Argument parsing ───────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let stage: string | undefined;
  let deployment: string | undefined;
  let group: string | undefined;
  let listGroups = false;
  let rejectedNonInteractiveFlag: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) {
      stage = args[++i];
    } else if (args[i] === '--deployment' && args[i + 1]) {
      deployment = args[++i];
    } else if (args[i] === '--yes' || args[i] === '--non-interactive') {
      rejectedNonInteractiveFlag = args[i];
    } else if (args[i] === '--group' && args[i + 1] !== undefined) {
      group = args[++i];
    } else if (args[i] === '--list-groups') {
      listGroups = true;
    }
  }

  return { stage, deployment, group, listGroups, rejectedNonInteractiveFlag };
}

// ─── Report ─────────────────────────────────────────────────────
function printReport(report: SetupReport): void {
  console.log(chalk.bold.cyan('\n' + '='.repeat(50)));
  console.log(chalk.bold.cyan('  SETUP REPORT'));
  console.log(chalk.bold.cyan('='.repeat(50)));

  console.log(
    `  Databases created:  ${report.databasesCreated.length > 0 ? chalk.green(report.databasesCreated.join(', ')) : chalk.gray('none')}`,
  );
  console.log(
    `  Schemas synced:     ${report.schemasSynced.length > 0 ? chalk.green(report.schemasSynced.join(', ')) : chalk.gray('none')}`,
  );

  if (report.seedResults.length > 0) {
    console.log('  Seeds applied:');
    for (const r of report.seedResults) {
      const icon = r.success ? chalk.green('✓') : chalk.red('✗');
      const status = r.success ? chalk.green('OK') : chalk.red('FAILED');
      console.log(`    ${icon} ${r.service.padEnd(20)} ${status} (${r.duration}ms)`);
      if (r.error) console.log(chalk.red(`      ${r.error}`));
    }
  } else {
    console.log(`  Seeds applied:      ${chalk.gray('none')}`);
  }

  console.log(`  Total duration:     ${chalk.gray((report.totalDuration / 1000).toFixed(2) + 's')}`);
  console.log(chalk.bold.cyan('='.repeat(50) + '\n'));
}

// ─── Main ───────────────────────────────────────────────────────
async function main() {
  const parsed = parseArgs(process.argv);

  // --list-groups는 DB 접근 없이 step 메타만 모은다 (sst shell도 필요 없음)
  if (parsed.listGroups) {
    const groups = await listGroupsForDeployment(parsed.deployment);
    console.log('Available seed groups:');
    if (groups.length === 0) {
      console.log('  (없음)');
    } else {
      for (const g of groups) console.log(`  - ${g}`);
    }
    return;
  }

  // ── dev-only 가드 (ADR-0005 §3) ───────────────────────────────
  if (parsed.rejectedNonInteractiveFlag) {
    console.error(
      chalk.red(
        `  db:setup is an interactive dev wrapper and refuses ${parsed.rejectedNonInteractiveFlag}.\n` +
          `  For deploy / CI: call db:bootstrap / db:migrate / db:seed:ref directly (see ADR-0005 §3).`,
      ),
    );
    process.exit(2);
  }
  // SST_STAGE 는 sst shell 안에서만 보이므로, 가드는 재진입 이후 한 번 더 확인.
  // --stage 인자만으로도 사용자 의도를 막아낸다.
  if (parsed.stage === 'live') {
    console.error(
      chalk.red(
        `  db:setup refuses --stage live. Production schema lifecycle runs via SST autodeploy workflow.`,
      ),
    );
    process.exit(2);
  }

  await ensureInsideSstShell({ stage: parsed.stage, deployment: parsed.deployment });

  // sst shell 진입 이후 한 번 더 SST_STAGE 가드 (defense in depth)
  if (process.env.SST_STAGE === 'live') {
    console.error(
      chalk.red(`  db:setup refuses SST_STAGE=live. Use SST autodeploy workflow for production.`),
    );
    process.exit(2);
  }

  // We're inside sst shell — run the actual setup (interactive mode only)
  const startTime = Date.now();
  const deployment = parsed.deployment;

  console.log(chalk.bold.cyan('\n=== Almondyoung Database Setup ==='));
  console.log(chalk.gray(`  ${new Date().toISOString()}`));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (deployment) {
    console.log(chalk.gray(`  Deployment: ${deployment}`));
  }

  const options = {
    yes: false,
    deployment,
    group: parsed.group,
  };
  let databasesCreated: string[] = [];
  let schemasSynced: string[] = [];
  let seedResults: SeedApplyResult[] = [];

  try {
    databasesCreated = await runDatabaseCreation(options);
  } catch (error: any) {
    console.log(chalk.red(`\n  Phase 1 failed: ${error.message}`));
    const shouldContinue = await confirm({
      message: 'Continue to Phase 2 (Schema Sync)?',
      default: false,
    });
    if (!shouldContinue) process.exit(1);
  }

  try {
    schemasSynced = await runSchemaSync(options);
  } catch (error: any) {
    console.log(chalk.red(`\n  Phase 2 failed: ${error.message}`));
    const shouldContinue = await confirm({
      message: 'Continue to Phase 3 (Seeding)?',
      default: false,
    });
    if (!shouldContinue) process.exit(1);
  }

  try {
    seedResults = await runSeeding(options);
  } catch (error: any) {
    console.log(chalk.red(`\n  Phase 3 failed: ${error.message}`));
  }

  // Final report
  const report: SetupReport = {
    databasesCreated,
    schemasSynced,
    seedResults,
    totalDuration: Date.now() - startTime,
  };

  printReport(report);

  const hasFailed = seedResults.some((r) => !r.success);
  if (hasFailed) process.exit(1);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n\n  Interrupted. Exiting...\n'));
  process.exit(130);
});

main().catch((error) => {
  console.error(chalk.red('Unexpected error:'), error);
  process.exit(1);
});
