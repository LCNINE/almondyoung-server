import chalk from 'chalk';
import { checkbox, input, password } from '@inquirer/prompts';
import { buildDatabaseUrl } from '../lib/db-connection';
import { Logger } from '../lib/logger';
import { SeedCheckResult, SeedApplyResult, SeedCheckItem } from '../lib/types';
import { SeedStep } from '../steps/base-seed-step';
import { WmsSeedStep } from '../steps/wms.seed-step';
import { PimSeedStep } from '../steps/pim.seed-step';
import { UserServiceSeedStep } from '../steps/user-service.seed-step';
import { MembershipSeedStep } from '../steps/membership.seed-step';
import { FileServiceSeedStep } from '../steps/file-service.seed-step';
import { NotificationSeedStep } from '../steps/notification.seed-step';

const logger = new Logger('Seeding');

async function collectConfig(options: { yes: boolean }) {
  // Admin password
  let adminPassword: string;
  if (options.yes) {
    adminPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234!';
  } else {
    adminPassword = await password({
      message: 'Admin user password:',
      mask: '*',
      default: process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234!',
    });
  }

  // File service config
  const templateDbUrl = process.env.FILE_TEMPLATE_DB_URL || '';
  const s3PublicBucket = process.env.AWS_S3_PUBLIC_BUCKET || '';
  const s3PrivateBucket = process.env.AWS_S3_PRIVATE_BUCKET || '';

  // Notification config
  const fcmPrivateKey = process.env.NOTIFICATION_FCM_PRIVATE_KEY || '';
  const twilioAuthToken = process.env.NOTIFICATION_TWILIO_AUTH_TOKEN || '';
  const twilioAccountSid = process.env.NOTIFICATION_TWILIO_ACCOUNT_SID || '';
  const nhnSecretKey = process.env.NOTIFICATION_NHN_SECRET_KEY || '';

  return {
    adminPassword,
    fileService: {
      templateDbUrl: templateDbUrl || undefined,
      s3PublicBucket: s3PublicBucket || undefined,
      s3PrivateBucket: s3PrivateBucket || undefined,
    },
    notification: {
      fcmPrivateKey,
      twilioAuthToken,
      twilioAccountSid,
      nhnSecretKey,
    },
  };
}

function printCheckResult(result: SeedCheckResult): void {
  console.log(`  ${chalk.bold(result.service)}:`);
  for (const item of result.items) {
    const icon = item.missing === 0 ? chalk.green('✓') : chalk.red('✗');
    const count = `${item.existing}/${item.expected}`;
    const missingStr =
      item.missing > 0
        ? chalk.red(` (${item.missing} missing${item.missingDetails?.length ? ': ' + item.missingDetails.join(', ') : ''})`)
        : '';
    console.log(`    ${icon} ${item.entity.padEnd(28)} ${count.padEnd(8)}${missingStr}`);
  }
}

export async function runSeeding(options: { yes: boolean }): Promise<SeedApplyResult[]> {
  console.log(chalk.bold.cyan('\nPhase 3: Seed Data'));
  console.log(chalk.cyan('─'.repeat(40)));

  const config = await collectConfig(options);

  // Create all seed steps
  const steps: SeedStep[] = [
    new WmsSeedStep(buildDatabaseUrl('wms')),
    new PimSeedStep(buildDatabaseUrl('pim')),
    new UserServiceSeedStep(buildDatabaseUrl('user_service'), config.adminPassword),
    new MembershipSeedStep(buildDatabaseUrl('membership')),
    new FileServiceSeedStep(buildDatabaseUrl('file_service'), config.fileService),
    new NotificationSeedStep(buildDatabaseUrl('notification'), config.notification),
  ];

  try {
    // Phase 1: Check all
    console.log(chalk.gray('\n  Checking seed status...\n'));
    const checkResults: SeedCheckResult[] = [];

    for (const step of steps) {
      try {
        const result = await step.check();
        checkResults.push(result);
        printCheckResult(result);
      } catch (error: any) {
        logger.error(`Failed to check ${step.serviceName}`, error);
        checkResults.push({
          service: step.serviceName,
          items: [],
          isFullySeeded: false,
          summary: `Check failed: ${error.message}`,
        });
      }
    }

    // Check if everything is seeded
    const allSeeded = checkResults.every((r) => r.isFullySeeded);
    if (allSeeded) {
      console.log(chalk.green('\n  Everything is up to date!\n'));
      return [];
    }

    // Phase 2: Select and apply
    const stepsWithMissing = steps.filter((_, i) => !checkResults[i].isFullySeeded);
    const totalMissing = checkResults
      .filter((r) => !r.isFullySeeded)
      .reduce((sum, r) => sum + r.items.reduce((s, i) => s + i.missing, 0), 0);

    let selectedNames: string[];

    if (options.yes) {
      selectedNames = stepsWithMissing.map((s) => s.serviceName);
    } else {
      console.log('');
      selectedNames = await checkbox({
        message: `Select services to seed (${totalMissing} total missing records):`,
        choices: steps.map((step, i) => {
          const result = checkResults[i];
          const missingCount = result.items.reduce((s, item) => s + item.missing, 0);
          return {
            name: result.isFullySeeded
              ? `${step.serviceName} (up to date)`
              : `${step.serviceName} (${missingCount} missing)`,
            value: step.serviceName,
            checked: !result.isFullySeeded,
            disabled: result.isFullySeeded ? '(up to date)' : false,
          };
        }),
      });
    }

    if (selectedNames.length === 0) {
      logger.warn('No services selected, skipping seeding');
      return [];
    }

    // Apply
    console.log('');
    const results: SeedApplyResult[] = [];
    for (const step of steps) {
      if (!selectedNames.includes(step.serviceName)) continue;
      console.log(`  ${chalk.bold(`Seeding ${step.serviceName}...`)}`);
      const result = await step.apply();
      results.push(result);
      if (result.success) {
        logger.success(`${step.serviceName} done (${result.duration}ms)`);
      } else {
        logger.error(`${step.serviceName} failed: ${result.error}`);
      }
    }

    return results;
  } finally {
    // Cleanup all connections
    for (const step of steps) {
      try {
        await step.dispose();
      } catch {
        // ignore dispose errors
      }
    }
  }
}
