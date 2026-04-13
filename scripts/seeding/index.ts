#!/usr/bin/env tsx

/**
 * Unified Interactive Database Setup & Seeding System
 *
 * Usage:
 *   npx tsx scripts/seeding/index.ts --stage dev           # interactive
 *   npx tsx scripts/seeding/index.ts --stage dev --yes     # non-interactive (CI)
 *   npx tsx scripts/seeding/index.ts --stage production    # production stage
 *
 * The script wraps itself in `sst shell --stage <stage>` automatically.
 * If already inside sst shell (SST_RESOURCE_App exists), it runs directly.
 */

import { execSync, spawn } from 'child_process';
import chalk from 'chalk';
import { confirm, select } from '@inquirer/prompts';
import { runDatabaseCreation } from './phases/01-database-creation';
import { runSchemaSync } from './phases/02-schema-sync';
import { runSeeding } from './phases/03-seed-orchestrator';
import { SetupReport, SeedApplyResult } from './lib/types';

// ─── Argument parsing ───────────────────────────────────────────
function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let stage: string | undefined;
  let yes = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) {
      stage = args[++i];
    } else if (args[i] === '--yes' || args[i] === '--non-interactive') {
      yes = true;
    }
  }

  return { stage, yes };
}

// ─── SST shell re-exec ─────────────────────────────────────────
function isInsideSstShell(): boolean {
  // sst shell injects SST_RESOURCE_* env vars
  return Object.keys(process.env).some((k) => k.startsWith('SST_RESOURCE_'));
}

function reExecViaSstShell(stage: string): never {
  // Re-run this same script inside sst shell, forwarding all args
  const args = process.argv.slice(2).join(' ');
  const cmd = `sst shell --stage ${stage} -- npx tsx ${process.argv[1]} ${args}`;
  console.log(chalk.gray(`  $ ${cmd}\n`));

  const child = spawn('sst', ['shell', '--stage', stage, '--', 'npx', 'tsx', process.argv[1], ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
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

  // If not inside sst shell, wrap ourselves
  if (!isInsideSstShell()) {
    if (!parsed.stage) {
      // Interactive stage selection
      const stages = await detectStages();
      if (stages.length === 0) {
        console.error(chalk.red('  --stage <name> is required. Example: --stage dev'));
        process.exit(1);
      }
      parsed.stage = await select({
        message: 'Select SST stage:',
        choices: stages.map((s) => ({ name: s, value: s })),
      });
      // Re-exec with the selected stage appended
      process.argv.push('--stage', parsed.stage);
    }
    reExecViaSstShell(parsed.stage);
    return; // unreachable, but makes TS happy
  }

  // We're inside sst shell — run the actual setup
  const startTime = Date.now();
  const isNonInteractive = parsed.yes;

  console.log(chalk.bold.cyan('\n=== Almondyoung Database Setup ==='));
  console.log(chalk.gray(`  ${new Date().toISOString()}`));
  console.log(chalk.gray(`  Stage: ${parsed.stage ?? process.env.SST_STAGE ?? '(unknown)'}`));
  if (isNonInteractive) {
    console.log(chalk.yellow('  Running in non-interactive mode (--yes)'));
  }

  const options = { yes: isNonInteractive };
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

/** Try to detect available SST stages from .sst state */
async function detectStages(): Promise<string[]> {
  try {
    const output = execSync('aws s3 ls s3://$(aws ssm get-parameter --name /sst/bootstrap --query Parameter.Value --output text | jq -r .state)/almondyoung-server/ 2>/dev/null || true', {
      encoding: 'utf-8',
      timeout: 10000,
    });
    // Parse S3 prefixes like "PRE dev/" "PRE production/"
    const stages = output
      .split('\n')
      .filter((line) => line.includes('PRE '))
      .map((line) => line.replace(/.*PRE\s+/, '').replace(/\/$/, '').trim())
      .filter(Boolean);
    return stages;
  } catch {
    return [];
  }
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
