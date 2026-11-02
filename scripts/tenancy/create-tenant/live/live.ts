/**
 * 라이브(또는 dev stage)에 테넌트 하나를 만든다 — 23 의 단계 러너 그대로, 라이브 어댑터만 다르다.
 *
 *   npm run tenant:create -- --stage live --plan <계획 파일>             # 멈춤 지점마다 할 일을 하고 다시 돌린다
 *   npm run tenant:create -- --stage live --plan <계획 파일> --suspend   # 격리 실측 실패 때 — 테넌트를 «정지»
 *
 * 필요한 것: AWS 로그인(aws login --profile login), 터널(npx sst tunnel --stage <stage>), 운영자 계정(운영자 성질 +
 * 테넌트 1 master — 직접 로그인한다. 비밀번호는 화면에 안 보이게 받는다).
 * 계획 파일(`live-plan.ts`)은 레포 밖이나 git 이 무시하는 곳에 둔다 — 테넌트 값은 그 파일에만 있다.
 *
 * 순서: 시작 조건(RDS medium·연결 여유·배포 ②·Route53 존) → 행 «준비» → core DB·마이그·시드 → 버킷 둘·권한 →
 * 인증서 → 리디렉트 → 역할 → 점검 계정 → 재마이그 → [멈춤] 칸 Secret → [멈춤] 목록 Secret → [멈춤] 표 커밋 + 배포 →
 * 만든 직후 확인(+ 칸 실측) → «활성» → 격리 실측 → 직원 명단(초기 비밀번호는 여기 한 번만 출력).
 * 목록 Secret 전 실패는 DB·행·버킷·권한을 되돌린다. 멈춤은 실패가 아니다 — 되돌리지 않고, 다시 돌리면 이어간다.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseTenantList } from '../../../../libs/tenancy/src/tenant-list';
import { tenantDomainSlotsFor } from '../../../../deployments/lcnine/tenant-domain-slots';
import { createServiceConnection } from '../../../seeding/lib/db-connection';
import { ensureInsideSstShell } from '../../../seeding/lib/sst-shell-relaunch';
import { stageServiceUrl } from '../../isolation-check/live-config';
import { authParameter, needSecret, secretsOf } from '../../sst-live';
import { operatorSession } from '../../operator-session';
import { HttpOperatorApi } from '../operator-api.http';
import { takeRunLock } from '../run-lock';
import { runCreation, TenantCreationFailed, TenantCreationPaused } from '../runner';
import { buildCreationSteps } from '../steps';
import { findHostedZone } from './acm-certificates';
import { awsCli } from './aws-cli';
import { suspendTodo } from './human-stops';
import { buildLivePorts } from './live-ports';
import {
  fillGenerated,
  isFilled,
  parseLivePlan,
  pickSlot,
  toTenantPlan,
  type FilledLivePlan,
  type LivePlan,
} from './live-plan';
import { CLAIMLESS_CORE_PATH, startConditionProblems, type StartObservation } from './start-conditions';

const ROOT = resolve(__dirname, '../../../..');
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** 계획 파일이 레포 안에서 git 이 추적하거나 무시하지 않는 곳이면 거절 — 테넌트 값이 커밋될 수 있다. */
function assertPrivatePlanPath(path: string): void {
  const rel = relative(ROOT, path);
  if (rel.startsWith('..')) return;
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: ROOT, stdio: 'ignore' });
  } catch {
    throw new Error(
      `계획 파일 ${rel} 이 git 이 무시하지 않는 곳에 있다 — 레포 밖이나 .scratch/ 아래로 옮긴다(공개 레포다)`,
    );
  }
}

/** 칸 번호를 정하고 버킷 이름을 처음 한 번 짓는다 — 바뀌었으면 계획 파일에 적는다 */
function fillPlan(stage: string, planPath: string, plan: LivePlan): FilledLivePlan {
  if (isFilled(plan)) return plan;
  const slotDomains = new Map<number, string>();
  for (const [name, value] of secretsOf(stage, 'lcnine-services')) {
    const m = /^AdminWebTenantSlot(\d+)Domain$/.exec(name);
    if (m) slotDomains.set(Number(m[1]), value);
  }
  const slot = pickSlot({ table: tenantDomainSlotsFor(stage), slotDomains, host: plan.adminDomain });
  const { plan: filled, changed } = fillGenerated(plan, { randomTail: () => randomBytes(4).toString('hex'), slot });
  if (changed) writeFileSync(planPath, `${JSON.stringify(filled, null, 2)}\n`);
  if (!isFilled(filled)) throw new Error('계획에 버킷 이름·칸 번호를 채우지 못했다');
  return filled;
}

async function observeStart(stage: string, plan: LivePlan, aws: ReturnType<typeof awsCli>) {
  const dbResource = JSON.parse(process.env.SST_RESOURCE_Db ?? '{}') as { host?: string };
  const instances = (await aws(['rds', 'describe-db-instances'])) as {
    DBInstances: { DBInstanceClass: string; Endpoint?: { Address?: string } }[];
  };
  const rdsInstanceClass =
    instances.DBInstances.find((i) => i.Endpoint?.Address === dbResource.host)?.DBInstanceClass ?? null;

  const sql = createServiceConnection('postgres', { max: 1, connect_timeout: 15, onnotice: () => undefined });
  let connections: StartObservation['connections'];
  try {
    const [r] = await sql`
      SELECT current_setting('max_connections')::int AS max,
             current_setting('superuser_reserved_connections')::int
               + coalesce(nullif(current_setting('rds.rds_superuser_reserved_connections', true), '')::int, 0) AS reserved,
             (SELECT count(*)::int FROM pg_stat_activity WHERE backend_type = 'client backend') AS in_use`;
    connections = { max: Number(r.max), reserved: Number(r.reserved), inUse: Number(r.in_use) };
  } finally {
    await sql.end({ timeout: 5 });
  }

  const res = await fetch(`${stageServiceUrl(stage, 'core')}${CLAIMLESS_CORE_PATH}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // 본문이 JSON 이 아니면 글자 그대로
  }

  const hostedZones = await Promise.all(
    [plan.adminDomain, plan.authDomain].map(async (host) => ({ host, zoneId: await findHostedZone(aws, host) })),
  );
  return {
    observation: { rdsInstanceClass, connections, claimlessCoreProbe: { status: res.status, body }, hostedZones },
    zones: new Map(hostedZones.flatMap((z) => (z.zoneId ? [[z.host, z.zoneId] as const] : []))),
  };
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const stage = argValue(argv, '--stage');
  const planArg = argValue(argv, '--plan');
  if (!stage || !planArg)
    throw new Error('--stage 와 --plan 이 필요하다 (예: --stage live --plan ~/tenants/acme.json)');
  const planPath = resolve(planArg);
  if (!existsSync(planPath)) throw new Error(`계획 파일이 없다: ${planPath}`);
  assertPrivatePlanPath(planPath);

  // sst shell 은 deployments/lcnine/services 에서 이 스크립트를 다시 띄운다 — 상대 경로를 그대로 넘기면 거기서 못 찾는다.
  process.argv[process.argv.indexOf('--plan') + 1] = planPath;
  await ensureInsideSstShell({ stage, deployment: 'lcnine-services' });

  const aws = awsCli(REGION);
  const releaseLock = takeRunLock(join(dirname(planPath), `.${basename(planPath)}.lock`));
  try {
    const plan = parseLivePlan(JSON.parse(readFileSync(planPath, 'utf8')));
    const session = await operatorSession(stage);
    const operator = new HttpOperatorApi(session.users, session.token);

    if (argv.includes('--suspend')) {
      await operator.setTenantStatus(plan.id, 'suspended');
      console.log(
        `⏹ 테넌트 ${plan.id} 를 «정지»로 바꿨다 — core 는 15초(+≤5초) 안에 남은 토큰을 거절한다(16 정지 런북)`,
      );
      console.log(
        '   되돌리기: 원인을 고친 뒤 운영자 API 로 {"status":"active"} — 이 스크립트는 다시 돌려도 활성으로 안 돌린다',
      );
      return 0;
    }

    const filled = fillPlan(stage, planPath, plan);
    const tenantPlan = toTenantPlan(filled);

    console.log(`테넌트 ${filled.id}(${filled.slug}) 만들기 — ${stage}`);
    const tenantList = parseTenantList(needSecret(secretsOf(stage, 'lcnine-auth'), 'TenantList', 'lcnine-auth'));
    const tenantOneId = authParameter(stage, 'served-tenant-id');
    const tenantOne = tenantList.find(tenantOneId);
    if (!tenantOne) throw new Error(`TenantList 에 테넌트 1(${tenantOneId}) 이 없다`);

    const start = await observeStart(stage, filled, aws);
    const problems = startConditionProblems(start.observation);
    // 시작 조건은 «시작»을 막는다. 목록에 넣은 뒤엔 그 테넌트의 풀이 이미 연결을 쓰고 있어 여유가 줄어 보인다 —
    // 그때 막으면 활성·직원 단계를 끝낼 길이 없어진다. 그래서 목록 뒤엔 경고만.
    if (problems.length > 0 && !tenantList.find(filled.id)) {
      console.error('❌ 시작 조건이 안 된다 — 아무것도 만들지 않았다:');
      for (const p of problems) console.error(`   - ${p}`);
      return 1;
    }
    for (const p of problems) console.warn(`  ⚠ 목록에 이미 있어 이어간다(시작 조건 경고): ${p}`);

    const ports = buildLivePorts({
      stage,
      plan: filled,
      planPath,
      stateDir: dirname(planPath),
      aws,
      operator,
      tenantOneCoreDb: tenantOne.coreDb,
      zones: start.zones,
      // 직원 초기 비밀번호 — 여기 한 번만. 로그(파일)로 보내지 않는다: 이 줄은 stdout 이고 단계 로그와 같은 화면이다.
      printInitialPassword: (loginId, password) =>
        console.log(`  🔑 ${loginId} 초기 비밀번호: ${password}  (지금 전달하고 화면을 지운다)`),
    });
    const report = await runCreation(buildCreationSteps(tenantPlan, ports), (line) => console.log(`  ${line}`));
    const ran = report.filter((r) => r.outcome === 'ran').length;
    console.log(ran === 0 ? '✅ 이미 다 돼 있다 — 바꾼 것 없음' : `✅ 끝 — ${ran}단계를 돌렸다`);
    // 명단이 비면 직원 단계가 없어 격리 실측도 그 안에서 안 돈다 — «활성» 뒤 실측은 명단과 무관하게 돈다.
    if (filled.staff.length === 0 && ports.isolation && !(await ports.isolation.passes())) {
      console.error(`❌ 격리 실측 실패 — 테넌트를 «정지»로: ${ports.isolation.suspendCommand}`);
      return 1;
    }
    console.log(
      '남은 사람 확인(브라우저): 테넌트 auth 도메인 /signin·/change-password 의 서버 액션 CSRF 양성·음성(18 Answer),',
    );
    console.log(
      `   네트워크 탭 호스트 = 테넌트 도메인 + 테넌트 버킷뿐. 문제가 보이면: ${suspendTodo({ stage, planPath })}`,
    );
    return 0;
  } catch (e) {
    if (e instanceof TenantCreationPaused) {
      console.log('');
      console.log(`⏸ «${e.pausedStep}» — 사람 손 단계에서 멈췄다(되돌리지 않았다). 할 일:`);
      for (const line of e.todo) console.log(`   ${line}`);
      return 2;
    }
    if (e instanceof TenantCreationFailed) {
      console.error(`❌ ${e.message}`);
      console.error(
        e.rolledBack ? '   목록에 넣기 전이라 되돌렸다.' : '   되돌리지 않았다 — 고친 뒤 다시 돌리면 이어간다.',
      );
      for (const u of e.undoErrors) console.error(`   🔴 되돌리기 실패: ${u}`);
      return 1;
    }
    throw e;
  } finally {
    releaseLock();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`\x1b[31m${e instanceof Error ? e.message : String(e)}\x1b[0m`);
    process.exit(1);
  },
);
