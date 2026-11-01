/**
 * 로컬 E2E 에 테넌트 하나를 만든다 — 만들기 스크립트의 로컬 리허설. 멱등하다: 몇 번을 돌려도 같은 상태로 수렴하고,
 * 중간에 죽이면 다시 돌려 이어간다. 목록에 넣기 전의 실패는 `DROP DATABASE` + 테넌트 행 삭제로 되돌린다.
 *
 * 직접 부르지 말고 `scripts/local/create-tenant-local.sh`(= bootstrap 의 4단계)로 부른다 — 테넌트 값과 .env 목록을
 * 정본 표(`scripts/local/e2e-env-map.sh`)에서 받아 넘긴다.
 *
 * 라이브의 사람 손 단계(Secret·DNS·배포)는 여기서 자동이다: 목록 = 앱 .env 들, 배포 = core 를 ② 로 잠깐 띄우기.
 * user-service 가 안 떠 있으면 잠깐 띄운다(운영자 API 를 불러야 한다).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runCreation, TenantCreationFailed } from '../../tenancy/create-tenant/runner';
import { buildCreationSteps, TenantPlan } from '../../tenancy/create-tenant/steps';
import { TENANT_STAFF_ROLE } from '../../tenancy/create-tenant/tenant-staff-role';
import { FIXED_UUIDS } from '../../seeding/constants/uuids';
import { HttpOperatorApi, localOperatorToken } from '../../tenancy/create-tenant/operator-api.http';
import {
  ensureNestApp,
  LocalCheckAccountSecret,
  LocalCoreDatabases,
  LocalCoreDeployment,
  LocalDiskBuckets,
  LocalEnvTenantList,
  readEnvFile,
  REPO,
  stopStartedApps,
  takeRunLock,
} from './local-ports';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} 가 없다 — scripts/local/create-tenant-local.sh 로 부를 것`);
  return v;
}

const log = (line: string) => console.log(`  ${line}`);

async function main(): Promise<void> {
  const LOCAL_PG = process.env.LOCAL_PG ?? 'postgresql://postgres:postgres@localhost:5432';
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(LOCAL_PG))
    throw new Error(`로컬 전용이다. LOCAL_PG 가 localhost 가 아니다`);

  const slug = required('E2E_TENANT2_SLUG');
  const domain = required('E2E_TENANT2_DOMAIN');
  const authDomain = required('E2E_TENANT2_AUTH_DOMAIN');
  const checkLoginId = required('E2E_TENANT2_CHECK_LOGIN_ID');
  const plan: TenantPlan = {
    entry: {
      id: required('E2E_TENANT2_ID'),
      slug,
      coreDb: required('E2E_TENANT2_CORE_DB'),
      publicBucket: required('E2E_TENANT2_PUBLIC_BUCKET'),
      privateBucket: required('E2E_TENANT2_PRIVATE_BUCKET'),
    },
    displayName: required('E2E_TENANT2_NAME'),
    domains: [
      { host: domain, app: 'admin-web' },
      { host: authDomain, app: 'auth-web' },
    ],
    staffClient: {
      clientId: 'admin-web',
      redirectUris: [`http://${domain}/auth/callback`],
      postLogoutRedirectUris: [`http://${domain}/login`],
    },
    role: { ...TENANT_STAFF_ROLE, permissions: [...TENANT_STAFF_ROLE.permissions] },
    checkAccount: {
      loginId: checkLoginId,
      username: '점검계정',
      nickname: '점검계정',
      email: `${checkLoginId}@example.com`,
    },
  };

  const userEnvFile = join(REPO, 'apps/user-service/.env');
  const coreEnvFile = join(REPO, 'apps/core/.env');
  const userEnv = readEnvFile(userEnvFile);
  const coreEnv = readEnvFile(coreEnvFile);
  const adminWebEnv = readEnvFile(join(REPO, 'apps/admin-web/.env.local'));
  const fileEnv = readEnvFile(join(REPO, 'apps/file-service/.env'));
  const tenantOneCoreDb = new URL(coreEnv.DATABASE_URL ?? '').pathname.replace(/^\//, '');
  if (!tenantOneCoreDb) throw new Error('apps/core/.env 의 DATABASE_URL 에서 테넌트 1 core DB 를 못 읽었다');

  mkdirSync(join(REPO, 'logs'), { recursive: true });
  const releaseLock = takeRunLock(join(REPO, 'logs', `.tenant-create-${slug}.lock`));
  // Ctrl+C·kill 로 끝나도 잠깐 띄운 앱을 내리고 잠금을 푼다(SIGKILL 은 못 받는다 — 다음 실행이 pid 파일로 고아를 내린다).
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void stopStartedApps().finally(() => {
        releaseLock();
        process.exit(130);
      });
    });
  }
  try {
    const userPort = Number(userEnv.PORT ?? 3000);
    await ensureNestApp({
      name: 'user-service',
      target: 'user-service',
      port: userPort,
      envFile: userEnvFile,
      ifRunning: 'reuse',
      log,
    });
    const baseUrl = `http://localhost:${userPort}`;
    const token = await localOperatorToken({
      baseUrl,
      internalSecret: userEnv.OAUTH_INTERNAL_SECRET ?? '',
      operatorUserId: FIXED_UUIDS.USER_ADMIN,
      clientId: adminWebEnv.OIDC_CLIENT_ID ?? 'admin-web',
      clientSecret: adminWebEnv.OIDC_CLIENT_SECRET ?? '',
      // seed-user-service-local.ts 가 admin-web 에 등록한 주소 — 이 host 가 테넌트 1 도메인이라 토큰 테넌트가 1 이 된다.
      redirectUri: 'http://localhost:8002/auth/callback',
    });

    const databases = new LocalCoreDatabases(LOCAL_PG);
    const steps = buildCreationSteps(plan, {
      operator: new HttpOperatorApi(baseUrl, () => Promise.resolve(token)),
      tenantOneCoreDb,
      databases,
      buckets: new LocalDiskBuckets(fileEnv.LOCAL_STORAGE_DIR ?? join(REPO, 'uploads')),
      list: new LocalEnvTenantList(
        required('E2E_TENANT_ENV_FILES')
          .split(' ')
          .map((f) => join(REPO, f)),
      ),
      deployment: new LocalCoreDeployment({ port: Number(coreEnv.PORT ?? 3100), envFile: coreEnvFile, databases, log }),
      checkSecret: new LocalCheckAccountSecret(join(REPO, '.local-e2e/tenants', `${slug}-check-account.json`)),
    });

    console.log(`테넌트 ${plan.entry.id}(${slug}) 만들기 — 로컬`);
    const report = await runCreation(steps, log);
    const ran = report.filter((r) => r.outcome === 'ran').length;
    console.log(ran === 0 ? '✅ 이미 다 돼 있다 — 바꾼 것 없음' : `✅ 끝 — ${ran}단계를 돌렸다`);
  } finally {
    await stopStartedApps();
    releaseLock();
  }
}

main().then(
  () => process.exit(0),
  (e: unknown) => {
    if (e instanceof TenantCreationFailed) {
      console.error(`❌ ${e.message}`);
      console.error(
        e.rolledBack ? '   목록에 넣기 전이라 되돌렸다.' : '   되돌리지 않았다 — 고친 뒤 다시 돌리면 이어간다.',
      );
      for (const u of e.undoErrors) console.error(`   🔴 되돌리기 실패: ${u}`);
    } else {
      console.error(e);
    }
    process.exit(1);
  },
);
