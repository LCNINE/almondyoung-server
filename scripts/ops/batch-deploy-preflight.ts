#!/usr/bin/env tsx
/**
 * 배치 배포 점검 — 여러 PR 을 모아 한 번에 `db:migrate` + `sst deploy` 할 때 그 배치를 «판정»한다. 고치지 않는다.
 *
 *   npm run deploy:preflight -- --stage live                  # 배포 전: 무엇이 실리는지, 어느 순서인지
 *   npm run deploy:preflight -- --stage live --mark-deployed  # 배포 뒤: 정말 떴는지 확인하고 배포 태그를 찍는다
 *
 * 필요한 것: 터널(`npx sst tunnel --stage <stage>`), `gh` 로그인, `--mark-deployed` 는 AWS 로그인(`aws login --profile login`).
 *
 * - 대기 마이그는 라이브 DB 의 적용 이력(`drizzle.__drizzle_migrations`)과 저장소 journal 을 직접 비교한다 — 기준 커밋이 없어도 된다.
 *   lcnine-services 와 lcnine-auth 를 둘 다 본다(user-service 는 auth 쪽이라 빠뜨리기 쉽다).
 * - 이벤트 계약·Medusa 마이그는 마지막 배포 태그(`deploy/<stage>/*`) 이후의 git 변경으로 본다.
 * - 종료 코드 1 은 하나뿐이다: 한 배포 안에서 expand 와 contract 마이그가 섞였을 때(어느 순서로도 한쪽이 깨진다).
 *   나머지는 목록과 권장 순서만 보여 주고 판단은 사람이 한다. `--mark-deployed` 는 확인이 하나라도 실패하면 태그를 찍지 않고 1.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { createServiceConnection } from '../seeding/lib/db-connection';
import { getServiceRegistry } from '../seeding/lib/service-registry';
import { deploymentToCwd } from '../seeding/lib/sst-shell-relaunch';
import {
  classifyMigration,
  DeploymentVerdict,
  deployTagName,
  EcsServiceSnapshot,
  judgeDeployment,
  MIGRATION_KINDS,
  migrationsOutDir,
  parseJournal,
  pendingEntries,
  PendingMigration,
  rolloutProblems,
  uncheckedDeployLines,
} from './batch-deploy-preflight.lib';

const ROOT = resolve(__dirname, '../..');
const DEPLOYMENTS = ['lcnine-services', 'lcnine-auth'] as const;
type Deployment = (typeof DEPLOYMENTS)[number];
const isDeployment = (value: string): value is Deployment => DEPLOYMENTS.some((d) => d === value);
const REGION = process.env.AWS_REGION ?? 'ap-northeast-2';

const ok = (msg: string) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const bad = (msg: string, fix: string) => console.log(`  \x1b[31m✗\x1b[0m ${msg}\n      → ${fix}`);
const info = (msg: string) => console.log(`  \x1b[33m·\x1b[0m ${msg}`);
const section = (title: string) => console.log(`\n\x1b[1m${title}\x1b[0m`);

interface Args {
  stage: string;
  markDeployed: boolean;
  issue: string;
  collect?: { deployment: Deployment; out: string };
}

function parseArgs(argv: string[]): Args {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const stage = value('--stage') ?? process.env.SST_STAGE;
  if (!stage) throw new Error('--stage <name> 이 필요하다 (예: --stage live)');
  const collectDeployment = value('--collect');
  const out = value('--out');
  if (collectDeployment !== undefined && !isDeployment(collectDeployment)) {
    throw new Error(`--collect 는 ${DEPLOYMENTS.join('·')} 중 하나다: ${collectDeployment}`);
  }
  return {
    stage,
    markDeployed: argv.includes('--mark-deployed'),
    issue: value('--issue') ?? '1016',
    collect: collectDeployment !== undefined && out ? { deployment: collectDeployment, out } : undefined,
  };
}

// ── 대기 마이그: sst shell 안에서 도는 수집부 ──────────────────────────────────────────

const pendingSchema = z.array(
  z.object({
    service: z.string(),
    tag: z.string(),
    kind: z.enum(MIGRATION_KINDS),
    contract: z.array(z.string()),
    expand: z.array(z.string()),
  }),
);

async function collectPending(deployment: Deployment): Promise<PendingMigration[]> {
  const pending: PendingMigration[] = [];
  for (const svc of getServiceRegistry(deployment)) {
    if (!svc.drizzleConfig) continue;
    const dir = join(ROOT, migrationsOutDir(readFileSync(join(ROOT, svc.drizzleConfig), 'utf8')));
    const entries = parseJournal(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'));
    const sql = createServiceConnection(svc.database, { max: 1, connect_timeout: 15, onnotice: () => undefined });
    try {
      const [{ last }] = await sql<{ last: string | null }[]>`
        select case when to_regclass('drizzle.__drizzle_migrations') is null then null
                    else (select max(created_at)::text from drizzle.__drizzle_migrations) end as last`;
      for (const entry of pendingEntries(entries, last === null ? null : Number(last))) {
        const cls = classifyMigration(readFileSync(join(dir, `${entry.tag}.sql`), 'utf8'));
        pending.push({ service: svc.name, tag: entry.tag, ...cls });
      }
    } finally {
      await sql.end();
    }
  }
  return pending;
}

/** 배포마다 그 배포의 sst shell 안에서 이 파일을 다시 띄워 수집한다 — DB 자격증명은 sst 리소스로만 온다 */
function pendingByDeployment(stage: string): Map<Deployment, PendingMigration[]> {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-preflight-'));
  const result = new Map<Deployment, PendingMigration[]>();
  for (const deployment of DEPLOYMENTS) {
    const out = join(dir, `${deployment}.json`);
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
        '--collect',
        deployment,
        '--out',
        out,
      ],
      { cwd: join(ROOT, deploymentToCwd(deployment)), stdio: ['ignore', 'inherit', 'inherit'] },
    );
    if (child.status !== 0) {
      throw new Error(
        `${deployment} 의 적용 이력을 읽지 못했다(exit ${child.status}). 터널(npx sst tunnel --stage ${stage})과 AWS 로그인을 확인한다`,
      );
    }
    result.set(deployment, pendingSchema.parse(JSON.parse(readFileSync(out, 'utf8'))));
  }
  return result;
}

// ── git · gh · aws ─────────────────────────────────────────────────────────────

function run(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function lastDeployTag(stage: string): string | null {
  run('git', ['fetch', 'origin', `refs/tags/deploy/${stage}/*:refs/tags/deploy/${stage}/*`, '--quiet']);
  return run('git', ['tag', '--list', `deploy/${stage}/*`, '--sort=-refname']).split('\n')[0] || null;
}

const describeServicesSchema = z.object({
  services: z.array(
    z.object({
      serviceName: z.string(),
      taskDefinition: z.string(),
      deployments: z.array(z.object({ rolloutState: z.string().optional() })),
    }),
  ),
});

function aws<T>(schema: z.ZodType<T>, args: string[]): T {
  return schema.parse(JSON.parse(run('aws', [...args, '--region', REGION, '--output', 'json'])));
}

function ecsSnapshot(stage: string): EcsServiceSnapshot[] {
  const { clusterArns } = aws(z.object({ clusterArns: z.array(z.string()) }), ['ecs', 'list-clusters']);
  const clusters = clusterArns
    .map((arn) => arn.split('/').pop() ?? arn)
    .filter((name) => DEPLOYMENTS.some((d) => name.startsWith(`${d}-${stage}-`)));
  const snapshots: EcsServiceSnapshot[] = [];
  for (const cluster of clusters) {
    const { serviceArns } = aws(z.object({ serviceArns: z.array(z.string()) }), [
      'ecs',
      'list-services',
      '--cluster',
      cluster,
    ]);
    for (let i = 0; i < serviceArns.length; i += 10) {
      const { services } = aws(describeServicesSchema, [
        'ecs',
        'describe-services',
        '--cluster',
        cluster,
        '--services',
        ...serviceArns.slice(i, i + 10),
      ]);
      for (const s of services) {
        const family = (s.taskDefinition.split('/').pop() ?? '').replace(/:\d+$/, '');
        const { taskDefinition } = aws(z.object({ taskDefinition: z.object({ taskDefinitionArn: z.string() }) }), [
          'ecs',
          'describe-task-definition',
          '--task-definition',
          family,
        ]);
        snapshots.push({
          cluster,
          service: s.serviceName,
          running: s.taskDefinition,
          latest: taskDefinition.taskDefinitionArn,
          rolloutStates: s.deployments.map((d) => d.rolloutState ?? 'UNKNOWN'),
        });
      }
    }
  }
  return snapshots;
}

// ── 보고 ────────────────────────────────────────────────────────────────────────

const ORDER: Record<DeploymentVerdict['kind'], string> = {
  none: '대기 마이그 없음 — sst deploy 만',
  expand: 'migrate → deploy',
  contract: 'deploy → migrate (contract — 옛 코드가 그 칸·표를 안 쓰게 된 배포가 이미 끝났어야 한다)',
  mixed: '한 순서로 돌릴 수 없다',
};

function reportMigrations(pending: Map<Deployment, PendingMigration[]>): boolean {
  let blocked = false;
  for (const [deployment, migrations] of pending) {
    section(`대기 마이그 — ${deployment}`);
    for (const m of migrations) {
      const labels = [...m.expand.map((l) => `+${l}`), ...m.contract.map((l) => `−${l}`)].join(' ');
      info(`${m.service}/${m.tag}  [${m.kind}] ${labels}`);
    }
    const verdict = judgeDeployment(migrations);
    if (verdict.kind === 'mixed') {
      blocked = true;
      bad(verdict.reason, 'contract 마이그를 다음 배치로 미룬다(그 PR 을 develop 에서 빼거나 배포 뒤에 머지)');
    } else {
      ok(ORDER[verdict.kind]);
    }
  }
  return blocked;
}

function reportSinceTag(stage: string): void {
  const tag = lastDeployTag(stage);
  section('마지막 배포 이후 변경');
  if (!tag) {
    bad(
      `배포 태그(deploy/${stage}/*)가 없다`,
      `배포가 끝난 뒤 --mark-deployed 로 찍는다. 그 전엔 이벤트 계약·Medusa 마이그를 못 본다`,
    );
    return;
  }
  info(`기준 ${tag} → HEAD (${run('git', ['rev-list', '--count', `${tag}..HEAD`])}커밋)`);
  const contracts = run('git', ['diff', '--name-only', tag, 'HEAD', '--', 'packages/event-contracts'])
    .split('\n')
    .filter((p) => p && !p.includes('__tests__'));
  if (contracts.length) {
    bad(
      `이벤트 계약이 바뀌었다: ${contracts.join(', ')}`,
      '값을 «더했으면» 소비자가 먼저 떠야 한다 — 한 배치에 함께 실리면 소비자 쪽을 이전 배치로 보낸다',
    );
  } else {
    ok('이벤트 계약 변경 없음');
  }
  const medusa = run('git', ['diff', '--name-only', '--diff-filter=A', tag, 'HEAD', '--', 'apps/medusa/src'])
    .split('\n')
    .filter((p) => /\/migrations\/Migration[^/]*\.ts$/.test(p));
  if (medusa.length) {
    info(`Medusa 마이그(컨테이너 부팅 때 새 코드와 함께 적용된다 — contract 면 따로 판단): ${medusa.join(', ')}`);
  } else {
    ok('Medusa 마이그 없음');
  }
}

function reportIssue(issue: string): void {
  section(`#${issue} 남은 운영 작업 — 체크 안 된 «배포» 줄`);
  const lines = uncheckedDeployLines(run('gh', ['issue', 'view', issue, '--json', 'body', '-q', '.body']));
  if (!lines.length) ok('없음');
  for (const line of lines) info(line);
}

function markDeployed(stage: string, pending: Map<Deployment, PendingMigration[]>): boolean {
  section('배포 확인');
  let fine = true;
  for (const [deployment, migrations] of pending) {
    if (migrations.length) {
      fine = false;
      bad(
        `${deployment}: 대기 마이그 ${migrations.length}건`,
        `npm run db:migrate -- --stage ${stage} --deployment ${deployment} --yes`,
      );
    }
  }
  const problems = rolloutProblems(ecsSnapshot(stage));
  for (const p of problems) bad(p, 'ECS 이벤트·태스크 로그를 보고 다시 배포한다');
  if (!problems.length) ok('ECS 서비스 전부 최신 리비전으로 COMPLETED');
  if (!fine || problems.length) return false;

  const dirty = run('git', ['status', '--porcelain']);
  if (dirty) info(`작업 트리에 커밋 안 된 변경이 있다 — 배포에 실렸을 수 있다:\n${dirty}`);
  const tag = deployTagName(stage, new Date());
  run('git', ['tag', tag, 'HEAD']);
  run('git', ['push', 'origin', tag]);
  ok(`${tag} → ${run('git', ['log', '-1', '--format=%h %s'])}`);
  return true;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.collect) {
    writeFileSync(args.collect.out, JSON.stringify(await collectPending(args.collect.deployment)));
    return;
  }
  const pending = pendingByDeployment(args.stage);
  if (args.markDeployed) {
    process.exitCode = markDeployed(args.stage, pending) ? 0 : 1;
    return;
  }
  const blocked = reportMigrations(pending);
  reportSinceTag(args.stage);
  reportIssue(args.issue);
  process.exitCode = blocked ? 1 : 0;
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`\x1b[31m${error instanceof Error ? error.message : String(error)}\x1b[0m`);
    process.exit(1);
  });
}
