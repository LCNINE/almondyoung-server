#!/usr/bin/env tsx

/**
 * Unified Interactive Database Setup & Seeding System
 *
 * Usage:
 *   npx tsx scripts/seeding/index.ts --stage dev                      # interactive (root deployment)
 *   npx tsx scripts/seeding/index.ts --stage dev --yes                # non-interactive (CI)
 *   npx tsx scripts/seeding/index.ts --stage production               # production stage
 *
 * The script wraps itself in `sst shell --stage <stage>` automatically.
 * If already inside sst shell (SST_RESOURCE_App exists), it runs directly.
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import { confirm } from '@inquirer/prompts';
import { runDatabaseCreation } from './phases/01-database-creation';
import { runSchemaSync } from './phases/02-schema-sync';
import { runSeeding, listGroupsForDeployment } from './phases/03-seed-orchestrator';
import { SetupReport, SeedApplyResult } from './lib/types';

// ─── Argument parsing ───────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let stage: string | undefined;
  let deployment: string | undefined;
  let yes = false;
  let group: string | undefined;
  let listGroups = false;
  let allowDemoInProd = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) {
      stage = args[++i];
    } else if (args[i] === '--deployment' && args[i + 1]) {
      deployment = args[++i];
    } else if (args[i] === '--yes' || args[i] === '--non-interactive') {
      yes = true;
    } else if (args[i] === '--group' && args[i + 1] !== undefined) {
      group = args[++i];
    } else if (args[i] === '--list-groups') {
      listGroups = true;
    } else if (args[i] === '--allow-demo-in-prod') {
      allowDemoInProd = true;
    }
  }

  return { stage, deployment, yes, group, listGroups, allowDemoInProd };
}

// ─── SST shell re-exec ─────────────────────────────────────────
function isInsideSstShell(): boolean {
  // sst shell injects SST_RESOURCE_* env vars
  return Object.keys(process.env).some((k) => k.startsWith('SST_RESOURCE_'));
}

/**
 * deployment 키 → sst 실행 cwd.
 *  - `{company}-{env}` (env ∈ platform/auth/services) → `deployments/{company}/{env}`
 */
function deploymentToCwd(deployment: string): string {
  const KNOWN_ENVS = ['platform', 'auth', 'services'];
  const parts = deployment.split('-');
  if (parts.length !== 2 || !KNOWN_ENVS.includes(parts[1])) {
    throw new Error(
      `Invalid deployment "${deployment}". Expected "{company}-{env}" with env ∈ ${KNOWN_ENVS.join('/')} (e.g. lcnine-services).`,
    );
  }
  return `deployments/${parts[0]}/${parts[1]}`;
}

function reExecViaSstShell(stage: string, deployment?: string): never {
  // Determine cwd: for named deployments, run sst from deployments/<path>/
  const sstCwd = deployment ? deploymentToCwd(deployment) : undefined;

  const args = process.argv.slice(2).join(' ');
  const cwdLabel = sstCwd ? ` (cwd: ${sstCwd})` : '';
  const cmd = `sst shell --stage ${stage} -- npx tsx ${process.argv[1]} ${args}`;
  console.log(chalk.gray(`  $ ${cmd}${cwdLabel}\n`));

  const child = spawn('sst', ['shell', '--stage', stage, '--', 'npx', 'tsx', process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
    cwd: sstCwd,
  });

  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error(chalk.red(`Failed to spawn sst shell: ${err.message}`));
    process.exit(1);
  });

  // Keep the parent alive while child runs
  // The 'exit' handler above will terminate us
  return undefined as never;
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

  // If not inside sst shell, wrap ourselves
  if (!isInsideSstShell()) {
    if (!parsed.stage) {
      console.error(chalk.red('  --stage <name> is required. Example: --stage dev'));
      process.exit(1);
    }
    reExecViaSstShell(parsed.stage, parsed.deployment);
    return; // unreachable, but makes TS happy
  }

  // We're inside sst shell — run the actual setup
  const startTime = Date.now();
  const isNonInteractive = parsed.yes;
  const deployment = parsed.deployment;

  console.log(chalk.bold.cyan('\n=== Almondyoung Database Setup ==='));
  console.log(chalk.gray(`  ${new Date().toISOString()}`));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (deployment) {
    console.log(chalk.gray(`  Deployment: ${deployment}`));
  }
  if (isNonInteractive) {
    console.log(chalk.yellow('  Running in non-interactive mode (--yes)'));
  }

  const options = {
    yes: isNonInteractive,
    deployment,
    group: parsed.group,
    allowDemoInProd: parsed.allowDemoInProd,
  };
  let databasesCreated: string[] = [];
  let schemasSynced: string[] = [];
  let seedResults: SeedApplyResult[] = [];

  try {
    // Phase 1: Database Creation
    databasesCreated = await runDatabaseCreation(options);
  } catch (error: any) {
    console.log(chalk.red(`\n  Phase 1 failed: ${error.message}`));
    if (!isNonInteractive) {
      const shouldContinue = await confirm({
        message: 'Continue to Phase 2 (Schema Sync)?',
        default: false,
      });
      if (!shouldContinue) process.exit(1);
    } else {
      process.exit(1);
    }
  }

  try {
    // Phase 2: Schema Sync
    schemasSynced = await runSchemaSync(options);
  } catch (error: any) {
    console.log(chalk.red(`\n  Phase 2 failed: ${error.message}`));
    if (!isNonInteractive) {
      const shouldContinue = await confirm({
        message: 'Continue to Phase 3 (Seeding)?',
        default: false,
      });
      if (!shouldContinue) process.exit(1);
    } else {
      process.exit(1);
    }
  }

  try {
    // Phase 3: Seeding
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
