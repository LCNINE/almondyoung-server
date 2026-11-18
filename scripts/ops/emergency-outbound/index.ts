/**
 * 비상 출고 (#1249) — 창고 앱 출고 경로가 막힌 날 core HTTP API 로 상자를 내보낸다.
 * 절차는 README.md. 기본은 dry-run, 쓰기는 --apply.
 *
 *   npx tsx scripts/ops/emergency-outbound/index.ts prepare  --stage live --warehouse <id> [--run <id>] [--apply]
 *   npx tsx scripts/ops/emergency-outbound/index.ts dispatch --stage live --run <id> [--csv <path>] [--apply]
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command, parseArgs, runDir } from './args';
import { CoreApi, httpCoreApi } from './core-api';
import { finishedState, runDispatch } from './dispatch';
import { preflightProblems, WAREHOUSE_READ_PERMISSION } from './preflight';
import { runPrepare } from './prepare';
import { readRun, RunState, writeRun } from './run-state';
import { myPermissions, openSession } from './session';

const log = (line: string) => console.log(line);

async function main(): Promise<number> {
  const cmd = parseArgs(process.argv.slice(2), new Date());
  const dir = resolve(process.cwd(), runDir(cmd.run));
  if (cmd.cmd === 'prepare') return prepareMain(cmd, dir);

  const state = readRun(dir);
  if (!state) {
    log(
      `${dir}/run.json 이 없다 — --run ${cmd.run} 의 prepare 를 이 PC 에서 돌린 적이 없다. 실행 id 와 폴더를 확인하라`,
    );
    return 1;
  }
  return dispatchMain(cmd, state, dir);
}

/** 세션을 열고 사전 점검(권한·낱개 피킹)을 한다. 실패면 null — 아무것도 바꾸지 않았다. */
async function openChecked(cmd: Command, warehouseId: string): Promise<CoreApi | null> {
  log(`${cmd.apply ? '[APPLY]' : '[dry-run]'} ${cmd.cmd} · stage ${cmd.stage} · 실행 ${cmd.run}`);
  const session = await openSession(cmd.stage);
  const api = httpCoreApi(session.coreUrl, session.token);

  const permissions = await myPermissions(session);
  // 창고 조회 권한이 없으면 조회가 403 으로 죽어 다른 문제를 못 보여 준다 — 권한 문제로 먼저 보고한다.
  const warehouse = permissions.includes(WAREHOUSE_READ_PERMISSION) ? await api.warehouse(warehouseId) : null;
  const problems = preflightProblems({
    permissions,
    supportedPickingStrategies: warehouse?.supportedPickingStrategies ?? null,
  });
  if (problems.length > 0) {
    log('사전 점검 실패 — 아무것도 바꾸지 않았다');
    for (const p of problems) log(`  - ${p}`);
    return null;
  }
  log(`창고 ${warehouse?.name ?? warehouseId} — 사전 점검 통과`);
  return api;
}

async function prepareMain(cmd: Extract<Command, { cmd: 'prepare' }>, dir: string): Promise<number> {
  const api = await openChecked(cmd, cmd.warehouseId);
  if (!api) return 1;
  const r = await runPrepare(api, { warehouseId: cmd.warehouseId, run: cmd.run, dir, apply: cmd.apply, log });
  log(`요약: 대상 ${r.targets.length} · 뺀 상자 ${r.skipped.length}`);
  if (!cmd.apply) log('dry-run 이다 — 아무것도 바꾸지 않았다. 확인했으면 --apply 로 다시 돌린다');
  if (r.problems.length > 0) {
    log('사람이 봐야 할 문제:');
    for (const p of r.problems) log(`  - ${p}`);
    return 2;
  }
  return 0;
}

async function dispatchMain(
  cmd: Extract<Command, { cmd: 'dispatch' }>,
  state: RunState,
  dir: string,
): Promise<number> {
  const api = await openChecked(cmd, state.warehouseId);
  if (!api) return 1;
  const csvText = readFileSync(resolve(process.cwd(), cmd.csv), 'utf8');
  const r = await runDispatch(api, { csvText, state, apply: cmd.apply, log });
  const count = (o: string) => r.rows.filter((x) => x.outcome === o).length;
  log(
    `요약: 발송 ${count('dispatched')} · 발송 예정 ${count('would-dispatch')} · 이미 발송 ${count('already')} · ` +
      `거절 ${count('rejected')} · 불일치 ${count('mismatch')} · 목록에서 빠진 상자 ${r.missing.length}`,
  );
  if (!cmd.apply) log('dry-run 이다 — 아무것도 바꾸지 않았다. 확인했으면 --apply 로 다시 돌린다');
  const finished = finishedState(state, r, cmd.apply, new Date());
  if (finished) {
    writeRun(dir, finished);
    log(`실행 ${state.run} 을 끝냈다 — 목록에서 빠진 상자는 정식 경로나 새 --run 으로 간다`);
  } else if (state.finishedAt) {
    log(`실행 ${state.run} 은 이미 끝났다(${state.finishedAt})`);
  }
  return count('rejected') + count('mismatch') > 0 ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e: unknown) => {
    console.error(`실패: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  });
