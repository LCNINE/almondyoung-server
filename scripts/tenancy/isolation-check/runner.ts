import type { Skipped, Verdict } from './judge';

/**
 * 격리 실측 한 항목. 판정만 한다 — 고치지 않는다(로컬 E2E preflight 와 같은 원칙: 판정자가 고치면 초록이
 * «원래 옳았다»의 증거가 아니게 된다). 그래서 ✗ 마다 무엇이 고치는지를 `fixedBy` 로 함께 적는다.
 */
export interface IsolationCheck<Ctx> {
  readonly section: string;
  readonly title: string;
  /** read = 매 배포 뒤 다시 도는 읽기 전용. write = 개통 때 한 번, «[개통 점검]» 이름으로 만들고 지운다. */
  readonly part: 'read' | 'write';
  /** 빨갛을 때 어느 티켓·명령이 고치는가 */
  readonly fixedBy: string;
  run(ctx: Ctx): Promise<Verdict | Skipped>;
}

export interface RunOptions {
  readonly write: boolean;
  /** 건너뜀을 실패로 센다 — 라이브에서 «못 쟀다»는 통과가 아니다. */
  readonly strict: boolean;
  readonly print?: (line: string) => void;
}

export interface RunResult {
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
}

const GREEN = '\x1b[32m✓\x1b[0m';
const RED = '\x1b[31m✗\x1b[0m';
const YELLOW = '\x1b[33m!\x1b[0m';

export async function runChecks<Ctx>(
  checks: readonly IsolationCheck<Ctx>[],
  ctx: Ctx,
  opts: RunOptions,
): Promise<RunResult> {
  const print = opts.print ?? ((line: string) => console.log(line));
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let section = '';
  for (const c of checks) {
    if (c.part === 'write' && !opts.write) continue;
    if (c.section !== section) {
      section = c.section;
      print(`── ${section}`);
    }
    let verdict: Verdict | Skipped;
    try {
      verdict = await c.run(ctx);
    } catch (e) {
      verdict = { ok: false, detail: `점검이 던졌다: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (verdict.ok === true) {
      passed++;
      print(`  ${GREEN} ${c.title}`);
    } else if (verdict.ok === 'skipped' && !opts.strict) {
      skipped++;
      print(`  ${YELLOW} ${c.title} — 못 쟀다: ${verdict.reason}`);
    } else {
      failed++;
      const detail = verdict.ok === 'skipped' ? `못 쟀다: ${verdict.reason}` : verdict.detail;
      print(`  ${RED} ${c.title} — ${detail}`);
      print(`      → ${c.fixedBy}`);
    }
  }
  return { passed, failed, skipped };
}
