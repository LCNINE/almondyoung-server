import chalk from 'chalk';
import { checkbox, input, password } from '@inquirer/prompts';
import { buildDatabaseUrl } from '../lib/db-connection';
import { getServiceRegistry } from '../lib/service-registry';
import { Logger } from '../lib/logger';
import { SeedCheckResult, SeedApplyResult, SeedCheckItem, ServiceConfig } from '../lib/types';
import { SeedStep } from '../steps/base-seed-step';
import { WmsSeedStep } from '../steps/wms.seed-step';
import { PimSeedStep } from '../steps/pim.seed-step';
import {
  UserServiceSeedStep,
  type OAuthClientSeed,
} from '../steps/user-service.seed-step';
import { MembershipSeedStep } from '../steps/membership.seed-step';
import { FileServiceSeedStep } from '../steps/file-service.seed-step';
import { NotificationSeedStep } from '../steps/notification.seed-step';

const logger = new Logger('Seeding');

async function collectConfig(options: { yes: boolean; deployment?: string }) {
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

  // OAuth RP 시드. RP 마다 *_BASE_URL 이 비어 있으면 해당 client 는 시드하지 않는다 (옵션).
  // secret 미지정 시 시더가 1회 생성·로그하고, 다음 실행에선 ON CONFLICT 가 secret_hash 를 안 건드려 안전.
  const oauthClients: OAuthClientSeed[] = [];
  const adminWebBase = process.env.ADMIN_WEB_BASE_URL;
  if (adminWebBase) {
    oauthClients.push({
      clientId: 'admin-web',
      clientType: 'confidential',
      redirectUris: [`${adminWebBase}/auth/callback`],
      postLogoutRedirectUris: [`${adminWebBase}/login`],
      allowedScopes: ['openid', 'profile', 'email', 'offline_access'],
      clientSecret: process.env.ADMIN_WEB_OIDC_CLIENT_SECRET,
    });
  }

  // storefront(=medusa-storefront RP). 콜백 경로: `${BASE}/${countryCode}/callback/oidc`
  // (web/almondyoung-storefront/src/lib/api/medusa/sso.ts 의 buildCallbackUrl 과 동치).
  // 운영 country 가 kr 단일이라 한 개만 등록. country 추가 시 redirectUris 배열에 추가하면 됨.
  const storefrontBase = process.env.STOREFRONT_BASE_URL;
  if (storefrontBase) {
    oauthClients.push({
      clientId: 'medusa-storefront',
      clientType: 'confidential',
      redirectUris: [`${storefrontBase}/kr/callback/oidc`],
      postLogoutRedirectUris: [`${storefrontBase}/kr`],
      allowedScopes: ['openid', 'profile', 'email'],
      clientSecret: process.env.STOREFRONT_OIDC_CLIENT_SECRET,
    });
  }

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
    oauthClients,
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

/**
 * Registry 기반으로 seed step 목록을 생성.
 * - 서비스가 registry에 있고 hasSeedStep=true인 경우만 생성
 * - almondyoung-server가 hasSeedStep=true인 경우 (df 배포) WMS/PIM 시딩을 해당 DB로 연결
 */
function buildSeedSteps(
  registry: ServiceConfig[],
  config: Awaited<ReturnType<typeof collectConfig>>,
): SeedStep[] {
  const steps: SeedStep[] = [];
  const registryMap = new Map(registry.map((s) => [s.name, s]));

  // almondyoung-server가 hasSeedStep=true면 WMS/PIM이 흡수된 것 (df 배포)
  const ayEntry = registryMap.get('almondyoung-server');
  if (ayEntry?.hasSeedStep) {
    const coreDbUrl = buildDatabaseUrl(ayEntry.database);
    steps.push(new WmsSeedStep(coreDbUrl));
    steps.push(new PimSeedStep(coreDbUrl));
  } else {
    // Root 배포: WMS/PIM이 별도 서비스
    const wmsEntry = registryMap.get('wms');
    if (wmsEntry?.hasSeedStep) {
      steps.push(new WmsSeedStep(buildDatabaseUrl(wmsEntry.database)));
    }
    const pimEntry = registryMap.get('pim');
    if (pimEntry?.hasSeedStep) {
      steps.push(new PimSeedStep(buildDatabaseUrl(pimEntry.database)));
    }
  }

  const userEntry = registryMap.get('user-service');
  if (userEntry?.hasSeedStep) {
    steps.push(
      new UserServiceSeedStep(buildDatabaseUrl(userEntry.database), {
        adminPassword: config.adminPassword,
        oauthClients: config.oauthClients,
      }),
    );
  }

  const membershipEntry = registryMap.get('membership');
  if (membershipEntry?.hasSeedStep) {
    steps.push(new MembershipSeedStep(buildDatabaseUrl(membershipEntry.database)));
  }

  const fileEntry = registryMap.get('file-service');
  if (fileEntry?.hasSeedStep) {
    steps.push(new FileServiceSeedStep(buildDatabaseUrl(fileEntry.database), config.fileService));
  }

  const notifEntry = registryMap.get('notification');
  if (notifEntry?.hasSeedStep) {
    steps.push(new NotificationSeedStep(buildDatabaseUrl(notifEntry.database), config.notification));
  }

  return steps;
}

export async function runSeeding(options: { yes: boolean; deployment?: string }): Promise<SeedApplyResult[]> {
  console.log(chalk.bold.cyan('\nPhase 3: Seed Data'));
  console.log(chalk.cyan('─'.repeat(40)));

  const config = await collectConfig(options);
  const registry = getServiceRegistry(options.deployment);

  // Create seed steps based on registry
  const steps = buildSeedSteps(registry, config);

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
