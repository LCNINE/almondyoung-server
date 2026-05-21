import chalk from 'chalk';
import { select, password } from '@inquirer/prompts';
import { buildDatabaseUrl } from '../lib/db-connection';
import { getServiceRegistry } from '../lib/service-registry';
import { Logger } from '../lib/logger';
import { SeedCheckResult, SeedApplyResult, ServiceConfig, PhaseOptions } from '../lib/types';
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
import { DemoUserSeedStep } from '../steps/demo-user.seed-step';
import { DabeauOAuthClientSeedStep } from '../steps/dabeau-oauth-client.seed-step';

const NONE_GROUP = 'none';
const DEMO_GROUP_PREFIX = 'demo-';

function collectGroups(steps: SeedStep[]): string[] {
  const set = new Set<string>();
  for (const step of steps) {
    for (const g of step.groups) set.add(g);
  }
  return Array.from(set).sort();
}

function isDemoGroup(group: string): boolean {
  return group.startsWith(DEMO_GROUP_PREFIX);
}

function isProdStage(): boolean {
  const stage = process.env.SST_STAGE ?? '';
  return /^(prod|production|live)$/i.test(stage);
}

async function resolveGroup(
  options: PhaseOptions,
  availableGroups: string[],
): Promise<string | null> {
  if (options.group !== undefined) {
    const raw = (options.group ?? '').trim().toLowerCase();
    if (raw === '' || raw === NONE_GROUP) return null;
    if (!availableGroups.includes(options.group!)) {
      throw new Error(
        `알 수 없는 그룹 "${options.group}". 사용 가능: ${availableGroups.join(', ') || '(없음)'}`,
      );
    }
    return options.group!;
  }

  if (options.yes) {
    logger.warn('--yes 모드에서 --group이 지정되지 않아 시드 단계를 건너뜁니다.');
    return null;
  }

  const filtered =
    isProdStage() && !options.allowDemoInProd
      ? availableGroups.filter((g) => !isDemoGroup(g))
      : availableGroups;

  const choices = [
    { name: '(시드 단계 건너뛰기)', value: NONE_GROUP },
    ...filtered.map((g) => ({ name: g, value: g })),
  ];

  const picked = await select({
    message: 'Select seed group:',
    choices,
  });

  return picked === NONE_GROUP ? null : picked;
}

const logger = new Logger('Seeding');

async function collectConfig(options: { yes: boolean; deployment?: string }) {
  // Admin password
  let adminPassword: string;
  const adminPasswordFallback = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@1234!';
  if (options.yes) {
    adminPassword = adminPasswordFallback;
  } else {
    const entered = await password({
      message: `Admin user password (enter로 기본값 ${adminPasswordFallback} 사용):`,
      mask: '*',
    });
    adminPassword = entered.trim() === '' ? adminPasswordFallback : entered;
  }

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

  // Demo user 비밀번호 (clip의 DEMO_PASSWORD_DEFAULT와 동일 기본값)
  const demoPassword = process.env.DEMO_PASSWORD || 'demo!1234';

  return {
    adminPassword,
    demoPassword,
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
 * - core 서비스가 catalog+inventory 통합 스키마를 가지므로 WMS/PIM 시딩은 core DB로 연결
 */
function buildSeedSteps(
  registry: ServiceConfig[],
  config: Awaited<ReturnType<typeof collectConfig>>,
  /**
   * URL 빌더 override. listGroupsForDeployment처럼 메타데이터만 필요한 경우
   * placeholder URL을 주입해 DB 연결 없이 인스턴스를 만든다 (postgres-js는 lazy).
   */
  urlFor: (database: string) => string = buildDatabaseUrl,
): SeedStep[] {
  const steps: SeedStep[] = [];
  const registryMap = new Map(registry.map((s) => [s.name, s]));

  const coreEntry = registryMap.get('core');
  if (coreEntry?.hasSeedStep) {
    const coreDbUrl = urlFor(coreEntry.database);
    steps.push(new WmsSeedStep(coreDbUrl));
    steps.push(new PimSeedStep(coreDbUrl));
  }

  const userEntry = registryMap.get('user-service');
  if (userEntry?.hasSeedStep) {
    steps.push(
      new UserServiceSeedStep(urlFor(userEntry.database), {
        adminPassword: config.adminPassword,
        oauthClients: config.oauthClients,
      }),
    );
  }

  const membershipEntry = registryMap.get('membership');
  if (membershipEntry?.hasSeedStep) {
    steps.push(new MembershipSeedStep(urlFor(membershipEntry.database)));
  }

  const fileEntry = registryMap.get('file-service');
  if (fileEntry?.hasSeedStep) {
    steps.push(new FileServiceSeedStep(urlFor(fileEntry.database)));
  }

  const notifEntry = registryMap.get('notification');
  if (notifEntry?.hasSeedStep) {
    steps.push(new NotificationSeedStep(urlFor(notifEntry.database), config.notification));
  }

  // Demo user + dabeau OAuth client는 user-service DB에 함께 들어간다.
  // user-service가 registry에 있는 배포에서만 등록.
  if (userEntry) {
    const userDbUrl = urlFor(userEntry.database);
    steps.push(new DemoUserSeedStep(userDbUrl, { demoPassword: config.demoPassword }));
    steps.push(new DabeauOAuthClientSeedStep(userDbUrl));
  }

  return steps;
}

export async function runSeeding(options: PhaseOptions): Promise<SeedApplyResult[]> {
  console.log(chalk.bold.cyan('\nPhase 3: Seed Data'));
  console.log(chalk.cyan('─'.repeat(40)));

  const config = await collectConfig({ yes: options.yes, deployment: options.deployment });
  const registry = getServiceRegistry(options.deployment);

  // Create seed steps based on registry
  const steps = buildSeedSteps(registry, config);

  if (steps.length === 0) {
    logger.warn('등록된 시드 step이 없습니다 (deployment 확인 필요).');
    return [];
  }

  const availableGroups = collectGroups(steps);

  // 운영 보호: 명시적 --group demo-*가 들어왔을 때 차단
  if (
    options.group &&
    isDemoGroup(options.group) &&
    isProdStage() &&
    !options.allowDemoInProd
  ) {
    logger.error(
      `운영 stage에서는 demo-* 그룹을 실행할 수 없습니다. 정말 필요하면 --allow-demo-in-prod 플래그를 추가하세요.`,
    );
    // dispose
    for (const step of steps) {
      try { await step.dispose(); } catch { /* ignore */ }
    }
    return [];
  }

  let selectedGroup: string | null;
  try {
    selectedGroup = await resolveGroup(options, availableGroups);
  } catch (error: any) {
    logger.error(error.message);
    for (const step of steps) {
      try { await step.dispose(); } catch { /* ignore */ }
    }
    return [];
  }

  if (selectedGroup === null) {
    logger.info('시드 단계를 건너뜁니다.');
    for (const step of steps) {
      try { await step.dispose(); } catch { /* ignore */ }
    }
    return [];
  }

  console.log(chalk.gray(`\n  Selected group: ${chalk.bold(selectedGroup)}`));

  // 그룹 필터 (serviceName 기준 dedupe)
  const filteredSteps: SeedStep[] = [];
  const seenServices = new Set<string>();
  for (const step of steps) {
    if (!step.groups.includes(selectedGroup)) continue;
    if (seenServices.has(step.serviceName)) continue;
    seenServices.add(step.serviceName);
    filteredSteps.push(step);
  }

  if (filteredSteps.length === 0) {
    logger.warn(`그룹 "${selectedGroup}"에 속한 step이 없습니다.`);
    for (const step of steps) {
      try { await step.dispose(); } catch { /* ignore */ }
    }
    return [];
  }

  try {
    // check
    console.log(chalk.gray('\n  Checking seed status...\n'));
    const checkResults: SeedCheckResult[] = [];

    for (const step of filteredSteps) {
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

    const allSeeded = checkResults.every((r) => r.isFullySeeded);
    if (allSeeded) {
      console.log(chalk.green('\n  Everything is up to date!\n'));
      return [];
    }

    // apply — group 선택 자체가 승인이므로 추가 confirm 없음
    console.log('');
    const results: SeedApplyResult[] = [];
    for (let i = 0; i < filteredSteps.length; i++) {
      const step = filteredSteps[i];
      if (checkResults[i].isFullySeeded) continue;
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
    for (const step of steps) {
      try { await step.dispose(); } catch { /* ignore */ }
    }
  }
}

/** index.ts가 --list-groups에서 사용 (sst shell/DB 접속 없이 메타만 조회) */
export async function listGroupsForDeployment(deployment?: string): Promise<string[]> {
  const PLACEHOLDER_URL = 'postgres://placeholder:placeholder@localhost:5432/placeholder';
  const placeholder: Awaited<ReturnType<typeof collectConfig>> = {
    adminPassword: 'placeholder',
    demoPassword: 'placeholder',
    notification: { fcmPrivateKey: '', twilioAuthToken: '', twilioAccountSid: '', nhnSecretKey: '' },
    oauthClients: [],
  };
  const registry = getServiceRegistry(deployment);
  const steps = buildSeedSteps(registry, placeholder, () => PLACEHOLDER_URL);
  try {
    return collectGroups(steps);
  } finally {
    for (const step of steps) {
      try { await step.dispose(); } catch { /* ignore */ }
    }
  }
}
