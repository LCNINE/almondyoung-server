export type Command =
  | { cmd: 'prepare'; stage: 'local' | 'live'; warehouseId: string; run: string; apply: boolean }
  | { cmd: 'dispatch'; stage: 'local' | 'live'; run: string; csv: string; apply: boolean };

const USAGE = [
  '사용법:',
  '  npx tsx scripts/ops/emergency-outbound/index.ts prepare  --stage <local|live> --warehouse <창고 id> [--run <실행 id>] [--apply]',
  '  npx tsx scripts/ops/emergency-outbound/index.ts dispatch --stage <local|live> --run <실행 id> [--csv <경로>] [--apply]',
].join('\n');

const VALUE_FLAGS = new Set(['--stage', '--warehouse', '--run', '--csv']);
const BOOL_FLAGS = new Set(['--apply']);

/** 실행 폴더 — 현재 디렉터리 기준 상대 경로. index 가 cwd 로 푼다. */
export function runDir(run: string): string {
  return `.scratch/emergency-outbound/${run}`;
}

function kstStamp(now: Date): string {
  const k = new Date(now.getTime() + 9 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${k.getUTCFullYear()}${p(k.getUTCMonth() + 1)}${p(k.getUTCDate())}-${p(k.getUTCHours())}${p(k.getUTCMinutes())}`;
}

export function parseArgs(argv: string[], now: Date): Command {
  const fail = (msg: string): never => {
    throw new Error(`${msg}\n${USAGE}`);
  };
  const [cmd, ...rest] = argv;
  if (cmd !== 'prepare' && cmd !== 'dispatch') return fail(`알 수 없는 명령: ${cmd ?? '(없음)'} — 사용법을 보라`);

  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (BOOL_FLAGS.has(a)) flags.add(a);
    else if (VALUE_FLAGS.has(a)) {
      const v = rest[i + 1];
      if (v === undefined || v.startsWith('--')) return fail(`${a} 에 값이 없다`);
      values.set(a, v);
      i++;
    } else return fail(`알 수 없는 인자: ${a}`);
  }

  const stage = values.get('--stage');
  if (stage !== 'local' && stage !== 'live') return fail('--stage local|live 가 필요하다 (기본값 없음)');
  const apply = flags.has('--apply');

  if (cmd === 'prepare') {
    const warehouseId = values.get('--warehouse');
    if (!warehouseId) return fail('--warehouse <창고 id> 가 필요하다');
    return { cmd, stage, warehouseId, run: values.get('--run') ?? kstStamp(now), apply };
  }
  const run = values.get('--run');
  if (!run) return fail('--run <실행 id> 가 필요하다');
  return { cmd, stage, run, csv: values.get('--csv') ?? `${runDir(run)}/shipments.csv`, apply };
}
