import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseTenantList, type TenantEntry } from '../../../../libs/tenancy/src/tenant-list';
import {
  tenantDomainSlotsFor,
  tenantSlotSecretNames,
  type TenantSlotSite,
} from '../../../../deployments/lcnine/tenant-domain-slots';
import { buildDatabaseUrl, createServiceConnection } from '../../../seeding/lib/db-connection';
import { ISOLATION_CHECK_SECRET, stageServiceUrl } from '../../isolation-check/live-config';
import { authParameter, needSecret, secretsOf, setSecret } from '../../sst-live';
import { signInStaff } from '../../staff-token';
import { HttpTenantMasterApi } from '../operator-api.http';
import { PostgresCoreDatabases } from '../postgres-core-databases';
import { StepPaused } from '../runner';
import type {
  CheckAccountSecret,
  CreationPorts,
  Deployment,
  HumanStep,
  IsolationGate,
  OperatorApi,
  TenantListTarget,
} from '../steps';
import { foreignEntry, sameEntry } from '../tenant-list-env';
import { AcmCertificates } from './acm-certificates';
import type { Aws } from './aws-cli';
import { deployTodo, prepareSlotSecrets, prepareTenantListSecret, suspendTodo, type PreparedStop } from './human-stops';
import { IamBucketGrant } from './iam-bucket-grant';
import { isolationGatePasses } from './isolation-gate';
import type { FilledLivePlan } from './live-plan';
import { S3Buckets } from './s3-buckets';
import { buildIdOf, certSanOf, slotInvalidations, slotMeasurementProblems } from './slot-measurements';

/**
 * 라이브 어댑터 묶음 — `sst shell --stage <stage>`(lcnine-services, 터널) 안에서 만든다(core DB 가 `Resource.Db` 를 쓴다).
 * 사람 손 단계(칸 Secret·목록 Secret·배포)는 값을 계획 파일 옆 0600 파일에 쓰고 `StepPaused` 로 멈춘다.
 */
const ROOT = resolve(__dirname, '../../../..');
const S3_REGION = 'ap-northeast-2';

export interface LiveContext {
  stage: string;
  plan: FilledLivePlan;
  planPath: string;
  /** 사람 손 단계의 값 파일을 쓸 곳(계획 파일 옆) */
  stateDir: string;
  aws: Aws;
  operator: OperatorApi;
  tenantOneCoreDb: string;
  /** 시작 조건에서 찾은 도메인 → Route53 존 */
  zones: ReadonlyMap<string, string>;
  printInitialPassword: (loginId: string, password: string) => void;
}

export function buildLivePorts(ctx: LiveContext): CreationPorts {
  const { stage, plan, aws } = ctx;
  const zoneFor = async (host: string) => {
    const z = ctx.zones.get(host);
    if (!z) throw new Error(`${host} 의 Route53 존을 모른다`);
    return z;
  };
  const certificates = new AcmCertificates(aws, { zoneFor, pollMs: 15_000, maxPolls: 80 });
  const services = () => secretsOf(stage, 'lcnine-services');

  const checkSecret = new LiveCheckAccountSecret(ctx);
  const databases = new PostgresCoreDatabases({
    url: buildDatabaseUrl,
    connect: (db) => createServiceConnection(db, { max: 1, onnotice: () => undefined }),
  });

  return {
    operator: ctx.operator,
    tenantOneCoreDb: ctx.tenantOneCoreDb,
    databases,
    buckets: new S3Buckets(
      aws,
      S3_REGION,
      [plan.adminDomain, plan.authDomain].map((h) => `https://${h}`),
      async () => fileServiceS3Env(services()),
    ),
    bucketAccess: new IamBucketGrant(
      aws,
      async () => needSecret(services(), 'AwsS3AccessKeyId', 'lcnine-services'),
      `tenant-${plan.slug}-buckets`,
      [plan.publicBucket, plan.privateBucket],
    ),
    certificates,
    domainSlotSecrets: new LiveDomainSlotSecrets(ctx, certificates, zoneFor),
    list: new LiveTenantList(ctx),
    deployment: new LiveDeployment(ctx, databases),
    checkSecret,
    tenantMaster: new HttpTenantMasterApi(authParameter(stage, 'user-service-url'), checkMasterToken(ctx, checkSecret)),
    domainProbe: { problems: () => measureSlots(ctx) },
    isolation: new LiveIsolationGate(ctx),
    printInitialPassword: ctx.printInitialPassword,
  };
}

/** 버킷 쓰기·읽기 확인 — file-service 의 S3 키 «만»으로(운영자 세션·프로필을 빼야 IAM 권한까지 잰다) */
function fileServiceS3Env(services: Map<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('AWS_')) env[k] = v;
  env.AWS_ACCESS_KEY_ID = needSecret(services, 'AwsS3AccessKeyId', 'lcnine-services');
  env.AWS_SECRET_ACCESS_KEY = needSecret(services, 'AwsS3SecretAccessKey', 'lcnine-services');
  env.AWS_CONFIG_FILE = '/dev/null';
  env.AWS_SHARED_CREDENTIALS_FILE = '/dev/null';
  return env;
}

function writeStop(stop: PreparedStop): never {
  for (const f of stop.files) {
    writeFileSync(f.path, f.content, { mode: 0o600 });
    chmodSync(f.path, 0o600);
  }
  throw new StepPaused(stop.todo);
}

class LiveDomainSlotSecrets implements HumanStep {
  constructor(
    private readonly ctx: LiveContext,
    private readonly certs: AcmCertificates,
    private readonly zoneFor: (host: string) => Promise<string>,
  ) {}

  private async expected(site: TenantSlotSite, host: string) {
    return { domain: host, certArn: await this.certs.arnFor(host), zoneId: await this.zoneFor(host) };
  }

  async isDone() {
    const { stage, plan } = this.ctx;
    const pairs: [TenantSlotSite, string, Map<string, string>][] = [
      ['AdminWeb', plan.adminDomain, secretsOf(stage, 'lcnine-services')],
      ['AuthWeb', plan.authDomain, secretsOf(stage, 'lcnine-auth')],
    ];
    for (const [site, host, secrets] of pairs) {
      const want = await this.expected(site, host);
      const names = tenantSlotSecretNames(site, plan.slot);
      if (secrets.get(names.domain) !== want.domain) return false;
      if (secrets.get(names.certArn) !== want.certArn) return false;
      if (secrets.get(names.zoneId) !== want.zoneId) return false;
    }
    return true;
  }

  async pause(): Promise<never> {
    const { stage, plan, stateDir } = this.ctx;
    return writeStop(
      prepareSlotSecrets({
        stage,
        slot: plan.slot,
        admin: await this.expected('AdminWeb', plan.adminDomain),
        auth: await this.expected('AuthWeb', plan.authDomain),
        dir: stateDir,
      }),
    );
  }
}

class LiveTenantList implements TenantListTarget {
  constructor(private readonly ctx: LiveContext) {}

  private current(): string {
    return needSecret(secretsOf(this.ctx.stage, 'lcnine-auth'), 'TenantList', 'lcnine-auth');
  }

  async lists(entry: TenantEntry) {
    const existing = parseTenantList(this.current()).find(entry.id);
    if (existing && !sameEntry(existing, entry)) throw foreignEntry(entry.id);
    return !!existing;
  }

  async add(entry: TenantEntry) {
    writeStop(
      prepareTenantListSecret({ stage: this.ctx.stage, current: this.current(), entry, dir: this.ctx.stateDir }),
    );
  }

  /** 목록 Secret 은 사람이 넣는다 — 스크립트는 빼지 않는다. 되돌리기는 «아직 안 넣었을 때»만 도니 뺄 것도 없다. */
  async remove() {}
}

class LiveDeployment implements Deployment {
  constructor(
    private readonly ctx: LiveContext,
    private readonly databases: PostgresCoreDatabases,
  ) {}

  /** core 가 이 테넌트 DB 에서 크론을 돌고, 칸 번호가 표에 있고, 두 앱의 칸 배포가 실제로 있다 — 셋 다여야 «배포됐다» */
  async isServing(entry: TenantEntry) {
    const { stage, plan, aws } = this.ctx;
    if ((await this.databases.cronRuns(entry.coreDb)).rows === 0) return false;
    if (!tenantDomainSlotsFor(stage).includes(plan.slot)) return false;
    for (const site of ['AdminWeb', 'AuthWeb'] as const) {
      if ((await slotInvalidations(aws, site, plan.slot)) === null) return false;
    }
    return true;
  }

  describe() {
    return '배포 한 번 (사람 손 — 칸 표 커밋 → auth → services)';
  }

  async run(): Promise<void> {
    const { stage, plan, planPath } = this.ctx;
    throw new StepPaused(
      deployTodo({ stage, slot: plan.slot, tableHasSlot: tenantDomainSlotsFor(stage).includes(plan.slot), planPath }),
    );
  }
}

/** 점검 계정 비밀번호 — lcnine-services 의 `IsolationCheck` Secret 의 `tenantTwo` 칸에만. 다른 칸은 그대로 둔다 */
class LiveCheckAccountSecret implements CheckAccountSecret {
  constructor(private readonly ctx: LiveContext) {}

  private read(): Record<string, unknown> {
    const raw = secretsOf(this.ctx.stage, 'lcnine-services').get(ISOLATION_CHECK_SECRET);
    if (!raw) return {};
    try {
      const json: unknown = JSON.parse(raw);
      return typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
    } catch {
      throw new Error(`${ISOLATION_CHECK_SECRET} 가 JSON 이 아니다 — 덮지 않는다. 사람이 고친 뒤 다시 돌린다`);
    }
  }

  async has() {
    return (await this.password()) !== null;
  }

  /** 이 계획의 점검 계정 비밀번호 — 다른 테넌트·다른 아이디의 칸이면 null */
  async password(): Promise<string | null> {
    const two = this.read().tenantTwo as { id?: unknown; loginId?: unknown; password?: unknown } | undefined;
    const mine = two?.id === this.ctx.plan.id && two.loginId === this.ctx.plan.checkAccount.loginId;
    return mine && typeof two.password === 'string' && two.password ? two.password : null;
  }

  async save(loginId: string, password: string) {
    const next = {
      ...this.read(),
      tenantTwo: {
        id: this.ctx.plan.id,
        loginId,
        password,
        adminRedirectUri: `https://${this.ctx.plan.adminDomain}/auth/callback`,
      },
    };
    setSecret(this.ctx.stage, 'lcnine-services', ISOLATION_CHECK_SECRET, JSON.stringify(next));
  }
}

const TOKEN_REUSE_MS = 10 * 60_000;

/**
 * 점검 계정(그 테넌트의 첫 master)의 직원 토큰 — 그 테넌트 admin-web 주소로 받아 토큰 테넌트가 그 테넌트다. 직원 명단은 이 토큰으로
 * 만든다(운영자 토큰이 아니다, ADR-0056). 수명 15분이라 10분마다 다시 받는다.
 */
function checkMasterToken(ctx: LiveContext, secret: LiveCheckAccountSecret): () => Promise<string> {
  let cached: { token: string; at: number } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < TOKEN_REUSE_MS) return cached.token;
    const password = await secret.password();
    if (!password) throw new Error('점검 계정 비밀번호가 Secret 에 없다 — 첫 master 단계가 먼저다');
    const token = await signInStaff(
      {
        baseUrl: authParameter(ctx.stage, 'user-service-url'),
        internalSecret: needSecret(secretsOf(ctx.stage, 'lcnine-auth'), 'OauthInternalSecret', 'lcnine-auth'),
        clientId: 'admin-web',
        clientSecret: needSecret(
          secretsOf(ctx.stage, 'lcnine-services'),
          'AdminWebOidcClientSecret',
          'lcnine-services',
        ),
        redirectUri: `https://${ctx.plan.adminDomain}/auth/callback`,
      },
      ctx.plan.checkAccount.loginId,
      password,
      ctx.plan.id,
    );
    cached = { token, at: Date.now() };
    return token;
  };
}

class LiveIsolationGate implements IsolationGate {
  readonly suspendCommand: string;

  constructor(private readonly ctx: LiveContext) {
    this.suspendCommand = suspendTodo({ stage: ctx.stage, planPath: ctx.planPath });
  }

  async passes() {
    // 실측은 자기 `sst shell` 을 따로 띄운다 — 이 셸의 리소스 env 를 넘기지 않는다.
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('SST_')) env[k] = v;
    return isolationGatePasses((write) => {
      const args = ['tsx', 'scripts/tenancy/isolation-check/live.ts', '--stage', this.ctx.stage];
      const r = spawnSync('npx', write ? [...args, '--write'] : args, { cwd: ROOT, env, stdio: 'inherit' });
      return r.status ?? 1;
    });
  }
}

async function measureSlots(ctx: LiveContext): Promise<string[]> {
  const { stage, plan, aws } = ctx;
  const sites: [TenantSlotSite, string, string][] = [
    ['AdminWeb', plan.adminDomain, stageServiceUrl(stage, 'admin')],
    ['AuthWeb', plan.authDomain, stageServiceUrl(stage, 'auth')],
  ];
  const observations = await Promise.all(
    sites.map(async ([site, host, base]) => ({
      site,
      host,
      certSan: await certSanOf(host),
      buildId: await buildIdOf(`https://${host}`),
      baseBuildId: await buildIdOf(base),
      invalidations: await slotInvalidations(aws, site, plan.slot),
    })),
  );
  return slotMeasurementProblems(observations);
}
