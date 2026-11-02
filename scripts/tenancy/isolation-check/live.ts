/**
 * 라이브(또는 dev stage)의 테넌트 격리 실측. 점검은 로컬 E2E 와 같다(`checks.ts`), 대상만 다르다.
 *
 *   npm run isolation:check -- --stage live           # 읽기 전용 — 매 배포 뒤 `deploy:preflight --mark-deployed` 다음
 *   npm run isolation:check -- --stage live --write   # 쓰기 포함 — 개통 때 한 번(테넌트 2 를 잠깐 «정지»한다)
 *
 * 필요한 것: AWS 로그인(aws login --profile login), 터널(npx sst tunnel --stage <stage> — DB 를 읽는 두 항목),
 * Secret `IsolationCheck`(live-config.ts). 비밀은 SST Secret 에서만 읽는다(`sst secret list`). 건너뜀은 실패다 —
 * 라이브에서 «못 쟀다»는 통과가 아니다. 화면 항목은 이 머신의 Chrome 을 헤드리스로 띄운다(없으면 실패 —
 * `ISOLATION_CHECK_CHROME` 으로 경로를 줄 수 있다).
 *
 * 쓰기 부분은 테넌트 2 점검 계정으로만 쓴다(테넌트 1 토큰은 읽기·대조만). 거기에 더 필요한 것:
 * - 운영자 로그인(화면에 안 보이게 받는다) — 정지 스위치, 그리고 상품 지우기의 임시 역할(`cleanup-grant.ts`). 그 회수는
 *   user-service 의 테넌트 지정 회수(`DELETE /admin/roles/:id/members/:userId?tenantId=`)를 쓴다 — lcnine-auth 배포 뒤에 돈다.
 * - 소비 앱 메트릭(건너뜀·DLQ)은 VPC 밖에선 `/metrics` 로 못 읽어, Alloy 가 원격 쓰기한 Grafana Cloud Prometheus 를
 *   조회한다(Secret `GrafanaCloudApiToken`). 거기 값은 스크레이프 주기 + 원격 쓰기만큼 늦다 — «0» 은 쓰기 뒤의
 *   수집에서 나온 값일 때만 믿는다(`judge.noNewDeadLetters`).
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
import { HttpOperatorApi } from '../create-tenant/operator-api.http';
import { operatorSession } from '../operator-session';
import { signInStaff, type StaffClient } from '../staff-token';
import { buildIsolationChecks } from './checks';
import { removeProductsWithTemporaryGrant } from './cleanup-grant';
import { findDigitalAssetFile, observeCronRuns } from './db-observation';
import { authParameter, needSecret as need, secretsOf } from '../sst-live';
import { probe } from './http';
import { infraSecretDefault, ISOLATION_CHECK_SECRET, parseIsolationCheckSecret, stageServiceUrl } from './live-config';
import { metricJobs } from './metric-jobs';
import { consumerMetricsFromVectors, prometheusQueryUrl } from './prometheus';
import { exitCodeOf, NO_ROWS_ONLY_EXIT, printLeftovers, runChecks } from './runner';
import { tenantDomainsOf } from './tenant-domains';
import {
  SHARED_SERVICE_PROBES,
  type ConsumerMetrics,
  type CronObservation,
  type IsolationTarget,
  type SharedServiceName,
} from './target';

const ROOT = resolve(__dirname, '../../..');
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';
const SERVICES_INFRA = 'deployments/lcnine/services/infra/services.ts';
/**
 * 일어난 일이 Grafana Cloud 에 보이기까지 — 가장 느린 스크레이프 주기(deployments/lcnine/services/observability/alloy/config.alloy, core 외 60s)에
 * 원격 쓰기 지연 여유 30초. 이 시간만큼 «오름»을 더 기다리고, DLQ «0» 은 그 뒤 수집이 들어올 때까지 판정하지 않는다.
 */
const METRICS_LAG_MS = 90_000;
/** 새로 만든 정리 역할이 core 권한 캐시(30초 주기)에 들어오기까지 */
const PERMISSION_CACHE_WAIT_MS = 45_000;

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

/**
 * 소비 앱 메트릭을 Grafana Cloud Prometheus 에서. 마지막 수집 시각은 `timestamp(up{…})` — 셀렉터에 바로 걸어야 샘플의
 * 시각이 나온다(식에 걸면 평가 시각, 즉 «지금»이 나와 늘 신선해 보인다). 내려간 대상(up 0)은 `and … == 1` 로 뺀다.
 */
function grafanaConsumerMetrics(stage: string, services: Map<string, string>): () => Promise<ConsumerMetrics> {
  const infra = readFileSync(join(ROOT, SERVICES_INFRA), 'utf8');
  const secretOrDefault = (name: string) => {
    const v = services.get(name) ?? infraSecretDefault(infra, name);
    if (!v) throw new Error(`lcnine-services 에 Secret ${name} 가 없고 ${SERVICES_INFRA} 에 기본값도 없다`);
    return v;
  };
  const queryUrl = prometheusQueryUrl(secretOrDefault('GrafanaCloudPrometheusRemoteWriteUrl'));
  const auth = `Basic ${Buffer.from(
    `${secretOrDefault('GrafanaCloudPrometheusUsername')}:${need(services, 'GrafanaCloudApiToken', 'lcnine-services')}`,
  ).toString('base64')}`;
  const jobs = metricJobs();
  const env = `deployment_environment="${stage}"`;
  const query = async (promql: string): Promise<unknown> => {
    const res = await fetch(`${queryUrl}?query=${encodeURIComponent(promql)}`, {
      headers: { authorization: auth },
      signal: AbortSignal.timeout(15_000),
    });
    // 오류 본문도 Prometheus 봉투({status:"error"})라 그대로 넘긴다 — 판독이 던진다
    return res.json().catch(() => ({ status: 'error', error: `HTTP ${res.status}` }));
  };
  return async () => {
    const [lastScrape, skipped, deadLettered, deadLetteredAt] = await Promise.all([
      query(`min by (job) (timestamp(up{${env}}) and up{${env}} == 1)`),
      query(`sum by (job) (events_skipped_other_tenant_total{${env}})`),
      query(`sum by (job) (events_dlq_messages_total{${env}})`),
      query(`min by (job) (timestamp(events_dlq_messages_total{${env}}))`),
    ]);
    return consumerMetricsFromVectors(jobs, { lastScrape, skipped, deadLettered, deadLetteredAt });
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const stage = argValue(argv, '--stage');
  if (!stage) throw new Error('--stage 가 필요하다 (예: --stage live)');
  const collectOut = argValue(argv, '--collect-db');
  if (collectOut) {
    return collectDbObservation(argValue(argv, '--tenant-one') ?? '', argValue(argv, '--tenant-two') ?? '', collectOut);
  }
  const write = argv.includes('--write');
  if (write)
    console.log(
      '쓰기 포함 — 테넌트 2 를 잠깐 «정지»했다 되돌린다(그 사이 테넌트 2 세션이 끊긴다). 운영자로 로그인한다.',
    );
  // 프롬프트는 맨 앞에 — 긴 읽기(Secret·DB) 뒤에 물으면 사람이 자리를 비운 사이 멈춘다
  const operator = write ? await operatorSession(stage) : null;

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
  const core = stageServiceUrl(stage, 'core');
  const signInTenantTwo = () =>
    signInStaff(staff(check.tenantTwo.adminRedirectUri), check.tenantTwo.loginId, check.tenantTwo.password);

  const liveWrite = (op: { users: string; token: () => Promise<string> }): NonNullable<IsolationTarget['write']> => {
    const api = new HttpOperatorApi(op.users, op.token);
    return {
      consumerMetrics: grafanaConsumerMetrics(stage, services),
      metricsLagMs: METRICS_LAG_MS,
      setTenantStatus: (id, status) => api.setTenantStatus(id, status),
      removeProducts: (masterIds) =>
        removeProductsWithTemporaryGrant(
          {
            findRole: (name) => api.findRole(name),
            createRole: (input) => api.createRole(input),
            replaceRolePermissions: (roleId, permissions, version) =>
              api.replaceRolePermissions(roleId, permissions, version),
            grantUntil: (roleId, tenantId, userId, untilDate) =>
              api.grantRoleUntil(roleId, tenantId, userId, untilDate),
            revoke: (roleId, tenantId, userId) => api.removeRoleMember(roleId, tenantId, userId),
            signInTenantTwo,
            deleteProduct: (token, masterId) => probe('DELETE', `${core}/masters/${masterId}`, { bearer: token }),
            now: () => new Date(),
          },
          {
            tenantTwoId: check.tenantTwo.id,
            masterIds,
            permissionWaitMs: PERMISSION_CACHE_WAIT_MS,
          },
        ),
    };
  };

  const target: IsolationTarget = {
    label: stage,
    strict: true,
    tenantOneId: servedTenant,
    tenantTwoId: check.tenantTwo.id,
    urls: {
      core,
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
      tenantTwo: signInTenantTwo,
    },
    customerToken: () => signInStaff(storefront, check.customer.loginId, check.customer.password),
    storePublishableKey: need(services, 'MedusaPublishableKey', 'lcnine-services'),
    tenantOneDigitalFileId: () => Promise.resolve(db.tenantOneDigitalFileId),
    tenantTwoCronRuns: (): Promise<CronObservation> => Promise.resolve(db.cron),
    write: operator ? liveWrite(operator) : undefined,
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

  console.log(`테넌트 격리 실측 — ${stage}${write ? ' (쓰기 포함)' : ' (읽기 전용)'}`);
  const { checks, closeBrowser, restoreIfSuspended, leftovers } = buildIsolationChecks(target);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      // 정지 스위치 중간에 끊기면 테넌트 2 가 정지인 채로 남는다 — 되돌리고 끝낸다.
      void restoreIfSuspended()
        .finally(closeBrowser)
        .finally(() => {
          printLeftovers(leftovers());
          process.exit(130);
        });
    });
  }
  const result = await runChecks(checks, undefined, { write, strict: target.strict }).finally(async () => {
    try {
      await restoreIfSuspended();
    } finally {
      await closeBrowser();
    }
  });
  printLeftovers(leftovers());
  console.log('');
  if (result.failed === 0) console.log(`✅ 격리 실측 통과 (${result.passed})`);
  else
    console.log(
      `❌ ${result.failed}개 실패 (통과 ${result.passed}) — 각 ✗ 의 → 가 고칠 곳이다. 개통 중이면 테넌트를 «정지»로 돌린다`,
    );
  const code = exitCodeOf(result, { write });
  if (code === NO_ROWS_ONLY_EXIT)
    console.log('  남은 실패는 «테넌트 2 에 잴 행이 없다»뿐이다 — --write 가 행을 만들어 잰다(만들고 지운다).');
  process.exitCode = code;
}

main().catch((e: unknown) => {
  console.error(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`);
  process.exit(1);
});
