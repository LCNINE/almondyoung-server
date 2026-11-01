/**
 * 라이브(또는 dev stage)의 테넌트 격리 실측 — 읽기 전용 부분. 점검은 로컬 E2E 와 같다(`checks.ts`), 대상만 다르다.
 *
 *   npm run isolation:check -- --stage live
 *
 * 매 배포 뒤 `deploy:preflight --mark-deployed` 다음에 돈다. 필요한 것: AWS 로그인(aws login --profile login),
 * 터널(npx sst tunnel --stage <stage> — DB 를 읽는 두 항목), Secret `IsolationCheck`(live-config.ts).
 * 비밀은 SST Secret 에서만 읽는다(`sst secret list`). 건너뜀은 실패다 — 라이브에서 «못 쟀다»는 통과가 아니다.
 * 화면 항목은 이 머신의 Chrome 을 헤드리스로 띄운다(없으면 실패 — `ISOLATION_CHECK_CHROME` 으로 경로를 줄 수 있다).
 *
 * 쓰기 부분(--write)은 아직 라이브에서 못 돈다: 소비 앱 메트릭(건너뜀·DLQ)은 VPC 안에서만 읽힌다. 개통 전에
 * 그 관측 경로를 단다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { parseTenantList } from '../../../libs/tenancy/src/tenant-list';
import { createServiceConnection } from '../../seeding/lib/db-connection';
import { deploymentToCwd } from '../../seeding/lib/sst-shell-relaunch';
import { resolveRegistry } from '../../seeding/lib/tenant-registry';
import { signInStaff, type StaffClient } from '../staff-token';
import { buildIsolationChecks } from './checks';
import { findDigitalAssetFile, observeCronRuns } from './db-observation';
import { authParameter, needSecret as need, secretsOf } from '../sst-live';
import { ISOLATION_CHECK_SECRET, parseIsolationCheckSecret, stageServiceUrl } from './live-config';
import { runChecks } from './runner';
import { tenantDomainsOf } from './tenant-domains';
import { SHARED_SERVICE_PROBES, type CronObservation, type IsolationTarget, type SharedServiceName } from './target';

const ROOT = resolve(__dirname, '../../..');
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

/** 서비스 이름 → 공개 호스트의 앞부분(인프라 `createService` 의 hostname) */
const HOST_SLUG: Readonly<Record<SharedServiceName, string>> = {
  wallet: 'wallet',
  membership: 'membership',
  analytics: 'analytics',
  'ugc-service': 'ugc',
  notification: 'notification',
  search: 'search',
  'channel-adapter': 'channel-adapter',
};

const dbObservationSchema = z.object({
  tenantOneDigitalFileId: z.string().nullable(),
  cron: z.object({
    tenantOneRecent: z.number(),
    missingInTenantTwo: z.array(z.string()),
    windowMinutes: z.number(),
  }),
});
interface DbObservation {
  readonly tenantOneDigitalFileId: string | null;
  readonly cron: CronObservation;
}

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** sst shell 안에서 — 레지스트리로 DB 에 붙어 두 관측만 JSON 으로 남긴다(비밀은 싣지 않는다). */
async function collectDbObservation(tenantOneId: string, tenantTwoId: string, out: string): Promise<void> {
  const registry = resolveRegistry({ deployment: 'lcnine-services' });
  const coreTwo = registry.find((s) => s.name === 'core' && s.tenant?.tenantId === tenantTwoId);
  const files = registry.find((s) => s.name === 'file-service');
  if (!coreTwo) throw new Error(`테넌트 목록에 테넌트 ${tenantTwoId} 의 core DB 가 없다`);
  if (!files) throw new Error('레지스트리에 file-service 가 없다');

  const coreOne = registry.find((s) => s.name === 'core' && s.tenant?.tenantId === tenantOneId);
  if (!coreOne) throw new Error(`테넌트 목록에 테넌트 ${tenantOneId} 의 core DB 가 없다`);
  const connect = (database: string) =>
    createServiceConnection(database, { max: 1, connect_timeout: 15, onnotice: () => undefined });
  const one = connect(coreOne.database);
  const core = connect(coreTwo.database);
  const file = connect(files.database);
  try {
    const observation: DbObservation = {
      tenantOneDigitalFileId: await findDigitalAssetFile(file, tenantOneId),
      cron: await observeCronRuns(one, core),
    };
    writeFileSync(out, JSON.stringify(observation));
  } finally {
    await one.end();
    await core.end();
    await file.end();
  }
}

function observeDb(stage: string, tenantOneId: string, tenantTwoId: string): DbObservation {
  const dir = mkdtempSync(join(tmpdir(), 'isolation-check-'));
  const out = join(dir, 'db.json');
  try {
    const child = spawnSync(
      'npx',
      [
        'sst',
        'shell',
        '--stage',
        stage,
        '--',
        'npx',
        'tsx',
        __filename,
        '--stage',
        stage,
        '--collect-db',
        out,
        '--tenant-one',
        tenantOneId,
        '--tenant-two',
        tenantTwoId,
      ],
      { cwd: join(ROOT, deploymentToCwd('lcnine-services')), stdio: ['ignore', 'inherit', 'inherit'] },
    );
    if (child.status !== 0 || !existsSync(out)) {
      throw new Error(
        `DB 관측 실패(exit ${child.status}) — 터널(npx sst tunnel --stage ${stage})과 AWS 로그인을 확인한다`,
      );
    }
    return dbObservationSchema.parse(JSON.parse(readFileSync(out, 'utf8')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stage = argValue(argv, '--stage');
  if (!stage) throw new Error('--stage 가 필요하다 (예: --stage live)');
  const collectOut = argValue(argv, '--collect-db');
  if (collectOut) {
    return collectDbObservation(argValue(argv, '--tenant-one') ?? '', argValue(argv, '--tenant-two') ?? '', collectOut);
  }
  if (argv.includes('--write')) {
    throw new Error(
      '라이브 쓰기 부분은 아직 없다 — 소비 앱 메트릭(건너뜀·DLQ)을 운영자 머신에서 읽을 길을 먼저 단다(개통 전)',
    );
  }

  const services = secretsOf(stage, 'lcnine-services');
  const auth = secretsOf(stage, 'lcnine-auth');
  const check = parseIsolationCheckSecret(need(services, ISOLATION_CHECK_SECRET, 'lcnine-services'));
  const servedTenant = authParameter(stage, 'served-tenant-id');

  const users = authParameter(stage, 'user-service-url');
  const internalSecret = need(auth, 'OauthInternalSecret', 'lcnine-auth');
  const adminWeb = stageServiceUrl(stage, 'admin');
  const staff = (redirectUri: string): StaffClient => ({
    baseUrl: users,
    internalSecret,
    clientId: 'admin-web',
    clientSecret: need(services, 'AdminWebOidcClientSecret', 'lcnine-services'),
    redirectUri,
  });
  const storefront: StaffClient = {
    baseUrl: users,
    internalSecret,
    clientId: 'medusa-storefront',
    clientSecret: need(services, 'MedusaOidcClientSecret', 'lcnine-services'),
    redirectUri: check.customer.redirectUri,
  };
  const db = observeDb(stage, servedTenant, check.tenantTwo.id);
  const tenantTwoEntry = parseTenantList(need(auth, 'TenantList', 'lcnine-auth')).find(check.tenantTwo.id);
  if (!tenantTwoEntry) throw new Error(`lcnine-auth 의 TenantList 에 테넌트 ${check.tenantTwo.id} 가 없다`);
  const tenantTwoAdmin = new URL(check.tenantTwo.adminRedirectUri);
  let tenantTwoHosts: Promise<string[]> | null = null;

  const target: IsolationTarget = {
    label: stage,
    strict: true,
    tenantOneId: servedTenant,
    tenantTwoId: check.tenantTwo.id,
    urls: {
      core: stageServiceUrl(stage, 'core'),
      fileService: stageServiceUrl(stage, 'file'),
      medusa: stageServiceUrl(stage, 'medusa'),
      adminWeb,
    },
    sharedServices: (Object.keys(SHARED_SERVICE_PROBES) as SharedServiceName[]).map((name) => ({
      name,
      url: stageServiceUrl(stage, HOST_SLUG[name]),
    })),
    signIn: {
      tenantOne: () =>
        signInStaff(staff(`${adminWeb}/auth/callback`), check.tenantOne.loginId, check.tenantOne.password),
      tenantTwo: () =>
        signInStaff(staff(check.tenantTwo.adminRedirectUri), check.tenantTwo.loginId, check.tenantTwo.password),
    },
    customerToken: () => signInStaff(storefront, check.customer.loginId, check.customer.password),
    storePublishableKey: need(services, 'MedusaPublishableKey', 'lcnine-services'),
    tenantOneDigitalFileId: () => Promise.resolve(db.tenantOneDigitalFileId),
    tenantTwoCronRuns: (): Promise<CronObservation> => Promise.resolve(db.cron),
    screens: {
      tenantTwoAdmin: tenantTwoAdmin.origin,
      accounts: { tenantOne: check.tenantOne, tenantTwo: check.tenantTwo },
      tenantTwoHosts: () =>
        (tenantTwoHosts ??= tenantDomainsOf(users, internalSecret, tenantTwoAdmin.host, check.tenantTwo.id)),
      // file-service S3 공급자의 주소 꼴(s3-storage.provider.ts) — 공개 URL·서명 URL 모두 버킷 호스트다.
      tenantTwoBucketPrefixes: [tenantTwoEntry.publicBucket, tenantTwoEntry.privateBucket].map(
        (bucket) => `https://${bucket}.s3.${REGION}.amazonaws.com/`,
      ),
      forbiddenWords: () => Promise.resolve(check.forbiddenWords),
    },
  };

  console.log(`테넌트 격리 실측 — ${stage} (읽기 전용)`);
  const { checks, closeBrowser } = buildIsolationChecks(target);
  const result = await runChecks(checks, undefined, { write: false, strict: target.strict }).finally(closeBrowser);
  console.log('');
  if (result.failed === 0) console.log(`✅ 격리 실측 통과 (${result.passed})`);
  else
    console.log(
      `❌ ${result.failed}개 실패 (통과 ${result.passed}) — 각 ✗ 의 → 가 고칠 곳이다. 개통 중이면 테넌트를 «정지»로 돌린다`,
    );
  process.exitCode = result.failed === 0 ? 0 : 1;
}

main().catch((e: unknown) => {
  console.error(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`);
  process.exit(1);
});
