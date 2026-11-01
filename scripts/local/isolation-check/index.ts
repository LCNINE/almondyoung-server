/**
 * 로컬 E2E 의 격리 실측 대상. 점검 자체는 `scripts/tenancy/isolation-check/checks.ts` 이고 라이브와 같다 — 여기는 «어디를
 * 부르고 비밀번호를 어디서 읽나»만 정한다. `scripts/local/isolation-check-local.sh` 로 부른다(정본 표에서 값을 받는다).
 *
 * 로컬 값의 출처: 앱 .env 들, 테넌트 2 점검 계정 파일(`.local-e2e/tenants/<slug>-check-account.json`, 만들기 스크립트가 쓴다),
 * 로컬 운영자는 시드 admin(운영자 + 테넌트 1 master — 테넌트 1 점검 계정과 고객 로그인을 겸한다).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';
import { resolveMetricsPort } from '../../../libs/shared/src/observability/metrics-server';
import { buildIsolationChecks } from '../../tenancy/isolation-check/checks';
import {
  DIGITAL_ASSET_CONTEXT,
  findDigitalAssetFile,
  observeCronRuns,
} from '../../tenancy/isolation-check/db-observation';
import { expectOk } from '../../tenancy/isolation-check/http';
import { sumSamples } from '../../tenancy/isolation-check/prometheus';
import { runChecks } from '../../tenancy/isolation-check/runner';
import {
  SHARED_SERVICE_PROBES,
  type ConsumerMetrics,
  type IsolationTarget,
  type SharedServiceName,
} from '../../tenancy/isolation-check/target';
import { signInStaff, type StaffClient } from '../../tenancy/staff-token';
import { FIXED_UUIDS } from '../../seeding/constants/uuids';
import { HttpOperatorApi, localOperatorToken } from '../create-tenant/operator-api.http';
import { readEnvFile, REPO } from '../create-tenant/local-ports';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 가 없다 — scripts/local/isolation-check-local.sh 로 부를 것`);
  return v;
}

interface AppRow {
  readonly name: string;
  readonly envFile: string;
  readonly port: number;
  readonly kind: string;
  readonly env: Record<string, string>;
}

/** 정본 표(`e2e-env-map.sh` 의 E2E_ENV_ROWS)에서 .env 가 배치된 앱만 — 없는 앱은 로컬에 «안 띄우기로 한» 앱이다. */
function deployedApps(): AppRow[] {
  return required('E2E_ENV_ROWS_FLAT')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, dest, , port, , kind] = line.split('|');
      return { name, envFile: join(REPO, dest), port: Number(port), kind, env: readEnvFile(join(REPO, dest)) };
    })
    .filter((app) => Object.keys(app.env).length > 0);
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const pg = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(pg)) throw new Error('로컬 전용이다. LOCAL_PG 가 localhost 가 아니다');

  const apps = deployedApps();
  const app = (name: string) => apps.find((a) => a.name === name);
  const url = (name: string) => {
    const a = app(name);
    return a ? `http://localhost:${a.port}` : null;
  };
  const mustUrl = (name: string) => {
    const u = url(name);
    if (!u)
      throw new Error(`${name} 의 .env 가 없다 — 실측에 필요한 앱이다 → npm run bootstrap:e2e:local -- --install-env`);
    return u;
  };
  const userEnv = app('user-service')?.env ?? {};
  const adminWebEnv = app('admin-web')?.env ?? {};
  const storefrontEnv = app('storefront')?.env ?? {};
  const fileServiceDb = app('file-service')?.env.DATABASE_URL ?? '';

  const tenantOneId = required('E2E_SERVED_TENANT_ID');
  const tenantTwoId = required('E2E_TENANT2_ID');
  const slug = required('E2E_TENANT2_SLUG');
  const tenantTwoDb = required('E2E_TENANT2_CORE_DB');
  const adminPassword = process.env.LOCAL_ADMIN_PASSWORD ?? 'Rehearsal1234!';
  const checkAccount = JSON.parse(
    readFileSync(join(REPO, '.local-e2e/tenants', `${slug}-check-account.json`), 'utf8'),
  ) as {
    loginId: string;
    password: string;
  };

  const userService = mustUrl('user-service');
  const staffClient = (redirectUri: string): StaffClient => ({
    baseUrl: userService,
    internalSecret: userEnv.OAUTH_INTERNAL_SECRET ?? '',
    clientId: adminWebEnv.OIDC_CLIENT_ID ?? 'admin-web',
    clientSecret: adminWebEnv.OIDC_CLIENT_SECRET ?? '',
    redirectUri,
  });
  // seed-user-service-local.ts 가 등록한 주소들 — host 가 토큰 테넌트를 정한다.
  const tenantOneClient = staffClient('http://localhost:8002/auth/callback');
  const tenantTwoClient = staffClient(`http://${required('E2E_TENANT2_DOMAIN')}/auth/callback`);
  const storefrontClient: StaffClient = {
    baseUrl: userService,
    internalSecret: userEnv.OAUTH_INTERNAL_SECRET ?? '',
    clientId: storefrontEnv.OIDC_CLIENT_ID ?? 'medusa-storefront',
    clientSecret: storefrontEnv.OIDC_CLIENT_SECRET ?? '',
    redirectUri: 'http://localhost:8000/kr/callback/oidc',
  };

  const consumerApps = required('E2E_SERVED_TENANT_APPS')
    .split(' ')
    .filter((name) => name !== 'user-service');
  const metricsUrl = (a: AppRow) => {
    const port = resolveMetricsPort({ PORT: String(a.port), ...a.env });
    return port ? `http://localhost:${port}/metrics` : null;
  };
  const consumerMetrics = async (): Promise<ConsumerMetrics> => {
    const skippedOtherTenant: Record<string, number> = {};
    const deadLettered: Record<string, number> = {};
    const unreachable: string[] = [];
    for (const a of apps.filter((x) => x.kind === 'nest')) {
      const target = metricsUrl(a);
      const text = target
        ? await fetch(target, { signal: AbortSignal.timeout(5_000) })
            .then((r) => (r.ok ? r.text() : null))
            .catch(() => null)
        : null;
      if (text === null) {
        // file-service 는 Kafka 소비 앱이 아니라 메트릭 서버를 안 띄운다 — 소비 앱만 «못 읽음»으로 센다.
        if (consumerApps.includes(a.name)) unreachable.push(a.name);
        continue;
      }
      if (consumerApps.includes(a.name))
        skippedOtherTenant[a.name] = sumSamples(text, 'events_skipped_other_tenant_total');
      deadLettered[a.name] = sumSamples(text, 'events_dlq_messages_total');
    }
    return { skippedOtherTenant, deadLettered, unreachable };
  };

  const operatorToken = () =>
    localOperatorToken({
      baseUrl: userService,
      internalSecret: tenantOneClient.internalSecret,
      operatorUserId: FIXED_UUIDS.USER_ADMIN,
      clientId: tenantOneClient.clientId,
      clientSecret: tenantOneClient.clientSecret,
      redirectUri: tenantOneClient.redirectUri,
    });

  const sql = postgres(`${pg}/${tenantTwoDb}`, { max: 1, onnotice: () => undefined });
  const tenantOneSql = postgres(app('core')?.env.DATABASE_URL ?? '', { max: 1, onnotice: () => undefined });
  const fileSql = fileServiceDb ? postgres(fileServiceDb, { max: 1, onnotice: () => undefined }) : null;
  const digitalFileId = () => (fileSql ? findDigitalAssetFile(fileSql, tenantOneId) : Promise.resolve(null));

  const target: IsolationTarget = {
    label: '로컬',
    strict: false,
    tenantOneId,
    tenantTwoId,
    urls: {
      core: mustUrl('core'),
      fileService: mustUrl('file-service'),
      medusa: mustUrl('medusa'),
      adminWeb: mustUrl('admin-web'),
    },
    sharedServices: (Object.keys(SHARED_SERVICE_PROBES) as SharedServiceName[]).map((name) => ({
      name,
      url: url(name),
    })),
    signIn: {
      tenantOne: () => signInStaff(tenantOneClient, 'admin', adminPassword),
      tenantTwo: () => signInStaff(tenantTwoClient, checkAccount.loginId, checkAccount.password),
    },
    customerToken: () => signInStaff(storefrontClient, 'admin', adminPassword),
    storePublishableKey: storefrontEnv.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ?? '',
    tenantOneDigitalFileId: digitalFileId,
    tenantTwoCronRuns: () => observeCronRuns(tenantOneSql, sql),
    write: {
      consumerMetrics,
      setTenantStatus: async (id, status) =>
        new HttpOperatorApi(userService, await operatorToken()).setTenantStatus(id, status),
      // 테넌트 2 역할엔 catalog.product.delete 가 없다. 로컬 픽스처라 API 의 지우기와 같은 soft delete 를 직접 건다.
      removeProducts: async (ids) => {
        await sql`UPDATE product_masters SET deleted_at = now() WHERE id IN ${sql(ids)} AND deleted_at IS NULL`;
      },
    },
  };

  const { checks, restoreIfSuspended } = buildIsolationChecks(target);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      // 정지 스위치 중간에 끊기면 테넌트 2 가 정지인 채로 남는다 — 되돌리고 끝낸다.
      void restoreIfSuspended().finally(() => process.exit(130));
    });
  }

  try {
    console.log(`테넌트 격리 실측 — ${target.label}${write ? ' (쓰기 포함)' : ' (읽기 전용)'}`);
    if (write && !(await digitalFileId())) {
      // 로컬 전용 준비: 읽기 점검의 «테넌트 1 디지털 상품 파일» 항목이 열어 볼 파일. 라이브엔 이미 있다.
      await uploadTenantOneDigitalFile(target.urls.fileService, await target.signIn.tenantOne());
      console.log('  · 준비(로컬 전용): 테넌트 1 디지털 상품 파일을 하나 올렸다');
    }
    const result = await runChecks(checks, undefined, { write, strict: target.strict });
    console.log('');
    const tail = result.skipped ? ` · 못 잰 것 ${result.skipped}` : '';
    if (result.failed === 0) console.log(`✅ 격리 실측 통과 (${result.passed}${tail})`);
    else console.log(`❌ ${result.failed}개 실패 (통과 ${result.passed}${tail}) — 각 ✗ 의 → 가 고칠 곳이다`);
    process.exitCode = result.failed === 0 ? 0 : 1;
  } finally {
    await restoreIfSuspended();
    await sql.end();
    await tenantOneSql.end();
    await fileSql?.end();
  }
}

async function uploadTenantOneDigitalFile(fileService: string, token: string): Promise<void> {
  const form = new FormData();
  form.append('contextId', DIGITAL_ASSET_CONTEXT);
  form.append(
    'file',
    new Blob([Buffer.from('isolation check fixture\n')], { type: 'application/zip' }),
    'isolation-check.zip',
  );
  await expectOk('POST', `${fileService}/files/upload`, { bearer: token, form });
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
