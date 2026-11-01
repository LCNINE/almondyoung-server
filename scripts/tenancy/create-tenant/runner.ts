/**
 * 테넌트 하나를 만드는 멱등 단계 러너. 로컬 리허설(`scripts/local/create-tenant/`)과 라이브가 같은 러너를 쓴다.
 *
 * 규칙:
 * - 단계마다 «이미 됐나»를 먼저 보고, 됐으면 건너뛴다. 실패하면 처음부터 다시 돌리면 이어진다.
 * - 돌린 뒤에도 «됐다»가 아니면 실패다. 고장 난 «이미 됐나»는 다음 실행이 같은 일을 또 하게 만든다.
 * - 목록에 넣기(`commitPoint`) 전의 실패는 지나온 단계를 거꾸로 되돌린다 — 지난 실행이 한 단계까지.
 *   되돌리기는 «되돌릴 것이 없으면 아무것도 안 하는» 멱등이어야 한다.
 * - 목록에 넣은 뒤는 되돌리지 않는다. 그 테넌트는 이미 앱들이 섬기는 테넌트다(빼는 것은 퇴출이고 범위 밖).
 * - 단계가 «남의 상태»를 보고 거절했으면(`StepRefused`) 되돌리지 않는다. 같은 id 의 다른 테넌트가 있다는 뜻이라,
 *   되돌리기가 지우는 DB·행이 이 실행의 것이라는 보장이 없다.
 */
export interface CreationStep {
  readonly name: string;
  isDone(): Promise<boolean>;
  run(): Promise<void>;
  /** 목록 전 실패 때 되돌리기. 없으면 남겨 둔다(역할·계정처럼 전역인 것). */
  undo?(): Promise<void>;
  /** 목록에 넣기 — 이 단계가 «됐으면» 그 뒤의 실패는 되돌리지 않는다. */
  readonly commitPoint?: boolean;
}

export interface StepReport {
  name: string;
  outcome: 'skipped' | 'ran';
}

/** 이 실행이 만들지 않은 상태를 만났다 — 손대지 않고 멈춘다(되돌리기도 안 한다). */
export class StepRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepRefused';
  }
}

export class TenantCreationFailed extends Error {
  constructor(
    readonly failedStep: string,
    readonly cause: unknown,
    readonly rolledBack: boolean,
    readonly undoErrors: string[],
  ) {
    super(`«${failedStep}» 단계 실패: ${messageOf(cause)}`);
    this.name = 'TenantCreationFailed';
  }
}

export type Log = (line: string) => void;

export async function runCreation(steps: readonly CreationStep[], log: Log): Promise<StepReport[]> {
  const report: StepReport[] = [];
  for (const step of steps) {
    try {
      if (await step.isDone()) {
        log(`✓ ${step.name} — 이미 됐다`);
        report.push({ name: step.name, outcome: 'skipped' });
        continue;
      }
      log(`… ${step.name}`);
      await step.run();
      if (!(await step.isDone())) throw new Error('돌렸는데도 «됐다»가 아니다');
      log(`✓ ${step.name}`);
      report.push({ name: step.name, outcome: 'ran' });
    } catch (cause) {
      log(`✗ ${step.name} — ${messageOf(cause)}`);
      throw await failWith(steps, step.name, cause, log);
    }
  }
  return report;
}

async function failWith(steps: readonly CreationStep[], failed: string, cause: unknown, log: Log) {
  if (cause instanceof StepRefused) {
    log('이 실행이 만들지 않은 상태라 되돌리지 않는다 — 사람이 확인할 것');
    return new TenantCreationFailed(failed, cause, false, []);
  }
  const commit = steps.find((s) => s.commitPoint);
  if (commit && (await isDoneOrAssume(commit))) {
    log('목록에 이미 넣었다 — 되돌리지 않는다. 고친 뒤 다시 돌리면 실패한 단계부터 이어간다');
    return new TenantCreationFailed(failed, cause, false, []);
  }

  log('목록에 넣기 전이라 되돌린다');
  const end = commit ? steps.indexOf(commit) : steps.length - 1;
  const undoErrors: string[] = [];
  for (const step of steps.slice(0, end + 1).reverse()) {
    if (!step.undo) continue;
    try {
      await step.undo();
      log(`↺ ${step.name}`);
    } catch (e) {
      undoErrors.push(`${step.name}: ${messageOf(e)}`);
      log(`✗ ${step.name} 되돌리기 실패 — ${messageOf(e)}`);
    }
  }
  return new TenantCreationFailed(failed, cause, true, undoErrors);
}

/** 목록 단계의 «이미 됐나»조차 못 물으면 넣었다고 본다 — 앱이 섬기는 테넌트의 DB 를 지우는 쪽이 더 나쁘다. */
async function isDoneOrAssume(commit: CreationStep): Promise<boolean> {
  try {
    return await commit.isDone();
  } catch {
    return true;
  }
}

export function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
