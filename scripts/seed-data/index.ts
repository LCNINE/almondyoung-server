#!/usr/bin/env ts-node

import * as dotenv from 'dotenv';
import * as path from 'path';
import chalk from 'chalk';
import { SeedResult, SeedReport, SeederFunction } from './shared/types';
import { Logger } from './shared/logger';
import { seedUserService } from './seeders/03-user-service.seeder';
import { seedMembership } from './seeders/04-membership.seeder';
import { buildOAuthClientSeeds } from './shared/oauth-client-seeds';
import { seedWallet } from './seeders/05-wallet.seeder';
import { seedFileService } from './seeders/06-file-service.seeder';
import { seedNotification } from './seeders/07-notification.seeder';

const logger = new Logger('Main');

// Load environment variables
dotenv.config({ path: path.join(__dirname, '.env') });

interface EnvConfig {
  USER_SERVICE_DATABASE_URL: string;
  MEMBERSHIP_DATABASE_URL: string;
  WALLET_DATABASE_URL: string;
  FILE_SERVICE_DATABASE_URL: string;
  NOTIFICATION_DATABASE_URL: string;
  FILE_TEMPLATE_DB_URL?: string;
  AWS_S3_PUBLIC_BUCKET?: string;
  AWS_S3_PRIVATE_BUCKET?: string;
  ADMIN_INITIAL_PASSWORD: string;
  NOTIFICATION_FCM_PRIVATE_KEY: string;
  NOTIFICATION_RESEND_API_KEY: string;
  NOTIFICATION_TWILIO_AUTH_TOKEN: string;
  NOTIFICATION_TWILIO_ACCOUNT_SID: string;
  NOTIFICATION_NHN_APP_KEY: string;
  NOTIFICATION_NHN_SECRET_KEY: string;
  NOTIFICATION_NHN_SENDER_KEY: string;
  SEED_CONTINUE_ON_ERROR: boolean;
  SEED_VERBOSE: boolean;
}



function loadEnvConfig(): EnvConfig {
  const config: EnvConfig = {
    USER_SERVICE_DATABASE_URL: process.env.USER_SERVICE_DATABASE_URL || '',
    MEMBERSHIP_DATABASE_URL: process.env.MEMBERSHIP_DATABASE_URL || '',
    WALLET_DATABASE_URL: process.env.WALLET_DATABASE_URL || '',
    FILE_SERVICE_DATABASE_URL: process.env.FILE_SERVICE_DATABASE_URL || '',
    NOTIFICATION_DATABASE_URL: process.env.NOTIFICATION_DATABASE_URL || '',
    FILE_TEMPLATE_DB_URL: process.env.FILE_TEMPLATE_DB_URL,
    AWS_S3_PUBLIC_BUCKET: process.env.AWS_S3_PUBLIC_BUCKET,
    AWS_S3_PRIVATE_BUCKET: process.env.AWS_S3_PRIVATE_BUCKET,
    ADMIN_INITIAL_PASSWORD:
      process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234!',
    NOTIFICATION_FCM_PRIVATE_KEY:
      process.env.NOTIFICATION_FCM_PRIVATE_KEY || '',
    NOTIFICATION_RESEND_API_KEY:
      process.env.NOTIFICATION_RESEND_API_KEY || process.env.RESEND_API_KEY || '',
    NOTIFICATION_TWILIO_AUTH_TOKEN:
      process.env.NOTIFICATION_TWILIO_AUTH_TOKEN || '',
    NOTIFICATION_TWILIO_ACCOUNT_SID:
      process.env.NOTIFICATION_TWILIO_ACCOUNT_SID || '',
    NOTIFICATION_NHN_APP_KEY: process.env.NOTIFICATION_NHN_APP_KEY || process.env.NHN_APP_KEY || '',
    NOTIFICATION_NHN_SECRET_KEY: process.env.NOTIFICATION_NHN_SECRET_KEY || '',
    NOTIFICATION_NHN_SENDER_KEY: process.env.NOTIFICATION_NHN_SENDER_KEY || process.env.NHN_SENDER_KEY || '',
    SEED_CONTINUE_ON_ERROR:
      process.env.SEED_CONTINUE_ON_ERROR === 'true' || true,
    SEED_VERBOSE: process.env.SEED_VERBOSE === 'true' || true,
  };

  // Validate required environment variables
  const requiredVars = [
    'USER_SERVICE_DATABASE_URL',
    'MEMBERSHIP_DATABASE_URL',
    'WALLET_DATABASE_URL',
    'FILE_SERVICE_DATABASE_URL',
    'NOTIFICATION_DATABASE_URL',
  ];

  const missing = requiredVars.filter((key) => !config[key as keyof EnvConfig]);

  if (missing.length > 0) {
    logger.error(
      `Missing required environment variables: ${missing.join(', ')}`,
    );
    process.exit(1);
  }

  return config;
}

async function runSeeder(
  serviceName: string,
  seederFn: () => Promise<void>,
  continueOnError: boolean,
): Promise<SeedResult> {
  const startTime = Date.now();

  try {
    logger.info(`\n${'='.repeat(60)}`);
    logger.info(`Starting ${serviceName} seeder`);
    logger.info('='.repeat(60));

    await seederFn();

    const duration = Date.now() - startTime;
    logger.success(`${serviceName} seeder completed in ${duration}ms\n`);

    return {
      service: serviceName,
      success: true,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`${serviceName} seeder failed after ${duration}ms`, error);

    if (!continueOnError) {
      logger.error('SEED_CONTINUE_ON_ERROR is false, stopping execution');
      process.exit(1);
    }

    logger.warn('Continuing to next seeder due to SEED_CONTINUE_ON_ERROR=true');

    return {
      service: serviceName,
      success: false,
      duration,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function printSeedReport(report: SeedReport): void {
  console.log('\n');
  console.log(chalk.bold.cyan('=' .repeat(60)));
  console.log(chalk.bold.cyan('                    SEED REPORT                           '));
  console.log(chalk.bold.cyan('='.repeat(60)));
  console.log();

  // Print individual results
  for (const result of report.results) {
    const icon = result.success ? chalk.green('✓') : chalk.red('✗');
    const status = result.success
      ? chalk.green('SUCCESS')
      : chalk.red('FAILED');
    const duration = `${result.duration}ms`;

    console.log(
      `${icon} ${chalk.bold(result.service.padEnd(25))} ${status.padEnd(20)} ${chalk.gray(duration)}`,
    );

    if (result.error) {
      console.log(chalk.red(`  Error: ${result.error}`));
    }
  }

  console.log();
  console.log(chalk.bold.cyan('-'.repeat(60)));

  // Print summary
  const successRate = (
    (report.successCount / report.results.length) *
    100
  ).toFixed(1);
  console.log(
    chalk.bold('Summary: ') +
      chalk.green(`${report.successCount} succeeded`) +
      ', ' +
      chalk.red(`${report.failureCount} failed`) +
      ` (${successRate}%)`,
  );
  console.log(
    chalk.bold('Total Duration: ') +
      chalk.gray(`${report.totalDuration}ms (${(report.totalDuration / 1000).toFixed(2)}s)`),
  );

  console.log(chalk.bold.cyan('='.repeat(60)));
  console.log();

  // Exit with error code if any seeder failed
  if (report.failureCount > 0) {
    process.exit(1);
  }
}

async function main() {
  const overallStartTime = Date.now();

  logger.info(chalk.bold.cyan('Almondyoung Server - Integrated Seed Script'));
  logger.info(chalk.gray(`Started at ${new Date().toISOString()}\n`));

  // Load configuration
  const config = loadEnvConfig();

  logger.info('Environment configuration loaded');
  logger.info(`Continue on error: ${config.SEED_CONTINUE_ON_ERROR}`);
  logger.info(`Verbose logging: ${config.SEED_VERBOSE}\n`);

  // Run all seeders
  const results: SeedResult[] = [];

  results.push(
    await runSeeder(
      'User Service',
      () =>
        seedUserService(
          config.USER_SERVICE_DATABASE_URL,
          config.ADMIN_INITIAL_PASSWORD,
          { oauthClients: buildOAuthClientSeeds() },
        ),
      config.SEED_CONTINUE_ON_ERROR,
    ),
  );

  results.push(
    await runSeeder(
      'Membership',
      () => seedMembership(config.MEMBERSHIP_DATABASE_URL),
      config.SEED_CONTINUE_ON_ERROR,
    ),
  );

  results.push(
    await runSeeder(
      'Wallet',
      () => seedWallet(config.WALLET_DATABASE_URL),
      config.SEED_CONTINUE_ON_ERROR,
    ),
  );

  results.push(
    await runSeeder(
      'File Service',
      () =>
        seedFileService(
          config.FILE_SERVICE_DATABASE_URL,
          config.FILE_TEMPLATE_DB_URL,
          {
            publicBucket: config.AWS_S3_PUBLIC_BUCKET,
            privateBucket: config.AWS_S3_PRIVATE_BUCKET,
          },
        ),
      config.SEED_CONTINUE_ON_ERROR,
    ),
  );

  results.push(
    await runSeeder(
      'Notification',
      () =>
        seedNotification(
          config.NOTIFICATION_DATABASE_URL,
          config.NOTIFICATION_FCM_PRIVATE_KEY,
          config.NOTIFICATION_RESEND_API_KEY,
          config.NOTIFICATION_TWILIO_AUTH_TOKEN,
          config.NOTIFICATION_TWILIO_ACCOUNT_SID,
          config.NOTIFICATION_NHN_APP_KEY,
          config.NOTIFICATION_NHN_SECRET_KEY,
          config.NOTIFICATION_NHN_SENDER_KEY,
        ),
      config.SEED_CONTINUE_ON_ERROR,
    ),
  );

  // Generate report
  const totalDuration = Date.now() - overallStartTime;
  const report: SeedReport = {
    totalDuration,
    results,
    successCount: results.filter((r) => r.success).length,
    failureCount: results.filter((r) => !r.success).length,
  };

  // Print report
  printSeedReport(report);
}

// Execute main function
main().catch((error) => {
  logger.error('Unexpected error in main execution', error);
  process.exit(1);
});
