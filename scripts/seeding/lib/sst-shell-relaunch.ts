/**
 * sst shell 재진입 헬퍼.
 *
 * 4개 entry script (bootstrap / migrate / seed-ref / seed-demo) 와 dev wrapper (index.ts)
 * 가 동일한 패턴으로 sst shell 안에서만 실제 작업을 수행하도록 보장한다.
 *
 * - sst shell 밖에서 실행되면: `sst shell --stage <stage> -- npx tsx <self> <args>` 로 자신을 재실행
 * - 안에서 실행되면: noop, caller 는 본 작업 계속
 */

import { spawn } from 'child_process';
import chalk from 'chalk';

export function isInsideSstShell(): boolean {
  // sst shell injects SST_RESOURCE_* env vars
  return Object.keys(process.env).some((k) => k.startsWith('SST_RESOURCE_'));
}

/**
 * deployment 키 → sst 실행 cwd.
 *  - `{company}-{env}` (env ∈ platform/auth/services) → `deployments/{company}/{env}`
 */
export function deploymentToCwd(deployment: string): string {
  const KNOWN_ENVS = ['platform', 'auth', 'services'];
  const parts = deployment.split('-');
  if (parts.length !== 2 || !KNOWN_ENVS.includes(parts[1])) {
    throw new Error(
      `Invalid deployment "${deployment}". Expected "{company}-{env}" with env ∈ ${KNOWN_ENVS.join('/')} (e.g. lcnine-services).`,
    );
  }
  return `deployments/${parts[0]}/${parts[1]}`;
}

/**
 * sst shell 밖이면 자신을 sst shell 안에서 재실행, 안이면 즉시 반환.
 *
 * 재실행 분기에선 자식 종료 시 부모도 같은 exit code 로 종료한다.
 * 그동안 부모가 caller 의 후속 로직을 *돌리지 않도록* pending Promise 를 반환 — caller 는
 * `await ensureInsideSstShell(opts)` 한 줄로 sst shell 안에서만 그 뒤 코드가 실행됨을 보장한다.
 */
export function ensureInsideSstShell(opts: { stage?: string; deployment?: string }): Promise<void> {
  if (isInsideSstShell()) return Promise.resolve();

  if (!opts.stage) {
    console.error(chalk.red('  --stage <name> is required. Example: --stage dev'));
    process.exit(1);
  }

  const sstCwd = opts.deployment ? deploymentToCwd(opts.deployment) : undefined;
  const args = process.argv.slice(2).join(' ');
  const cwdLabel = sstCwd ? ` (cwd: ${sstCwd})` : '';
  const cmd = `sst shell --stage ${opts.stage} -- npx tsx ${process.argv[1]} ${args}`;
  console.log(chalk.gray(`  $ ${cmd}${cwdLabel}\n`));

  const child = spawn(
    'sst',
    ['shell', '--stage', opts.stage, '--', 'npx', 'tsx', process.argv[1], ...process.argv.slice(2)],
    {
      stdio: 'inherit',
      env: process.env,
      cwd: sstCwd,
    },
  );

  child.on('exit', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error(chalk.red(`Failed to spawn sst shell: ${err.message}`));
    process.exit(1);
  });

  // caller 의 후속 라인이 child 와 동시에 부모에서도 실행되지 않도록 영원히 pending.
  // child 가 종료되면 위 exit 핸들러가 부모 프로세스 자체를 끝낸다.
  return new Promise<void>(() => {});
}

/** 공통 인자 파서. 각 entry 가 자기 추가 인자를 그 위에 얹는다. */
export interface CommonArgs {
  stage?: string;
  deployment?: string;
  yes: boolean;
  group?: string;
}

export function parseCommonArgs(argv: string[]): CommonArgs {
  const args = argv.slice(2);
  const out: CommonArgs = { yes: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && args[i + 1]) out.stage = args[++i];
    else if (args[i] === '--deployment' && args[i + 1]) out.deployment = args[++i];
    else if (args[i] === '--yes' || args[i] === '--non-interactive') out.yes = true;
    else if (args[i] === '--group' && args[i + 1] !== undefined) out.group = args[++i];
  }
  return out;
}
