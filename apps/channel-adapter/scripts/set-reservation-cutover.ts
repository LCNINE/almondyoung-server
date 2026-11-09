// apps/channel-adapter/scripts/set-reservation-cutover.ts
/**
 * Medusa 예약 투영의 전환 시각 T 를 정한다 (#1247). T 가 비어 있으면 투영은 아무 것도 쓰지 않는다.
 *
 * 기본은 dry-run(현재 값과 바꿀 값만 찍는다). `--apply` 를 붙여야 쓴다.
 *
 * Usage:
 *   dotenv -e apps/channel-adapter/.env -- npx tsx apps/channel-adapter/scripts/set-reservation-cutover.ts --at 2026-11-10T00:00:00+09:00
 *   ... --clear            T 를 비운다(투영 정지)
 *   ... --apply [--by <이름>]   실제로 쓴다. updated_by 기본은 OS 사용자
 */
import * as os from 'os';
import postgres = require('postgres');
import { drizzle } from 'drizzle-orm/postgres-js';
import { channelAdapterSchema } from '../src/schema';
import { ReservationCutoverRepository } from '../src/services/reservation-projection/reservation-cutover.repository';

interface Args {
  at: Date | null;
  apply: boolean;
  by: string;
}

function valueOf(args: string[], flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
}

export function parseArgs(args: string[]): Args {
  const clear = args.includes('--clear');
  const atRaw = valueOf(args, '--at');
  if (clear === (atRaw !== undefined)) throw new Error('--at <ISO> 또는 --clear 중 정확히 하나를 준다.');
  let at: Date | null = null;
  if (atRaw !== undefined) {
    // 오프셋 없는 시각은 UTC 로 읽혀 9시간 어긋난 전환이 된다 — 반드시 Z 또는 ±hh:mm 을 요구한다.
    if (!/(Z|[+-]\d{2}(:?\d{2})?)$/i.test(atRaw) || !atRaw.includes('T')) {
      throw new Error(`--at 은 시간대(Z 또는 +09:00 같은 오프셋)가 있는 ISO 시각이어야 한다: ${atRaw}`);
    }
    at = new Date(atRaw);
    if (Number.isNaN(at.getTime())) throw new Error(`--at 을 시각으로 읽을 수 없다: ${atRaw}`);
  }
  return { at, apply: args.includes('--apply'), by: valueOf(args, '--by') ?? os.userInfo().username };
}

async function main() {
  const { at, apply, by } = parseArgs(process.argv.slice(2));
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL 이 필요하다.');
  const client = postgres(process.env.DATABASE_URL, { max: 1 });
  try {
    const db = drizzle(client, { schema: channelAdapterSchema });
    const repo = new ReservationCutoverRepository({ db });
    const current = await repo.get();
    const show = (d: Date | null) => (d ? d.toISOString() : '(비어 있음)');
    console.log(`현재 T: ${show(current)}`);
    console.log(`바꿀 T: ${show(at)}  (by ${by})`);
    if (!apply) {
      console.log('dry-run — 쓰지 않았다. 쓰려면 --apply');
      return;
    }
    await repo.set(at, by);
    console.log(`적용했다. T = ${show(await repo.get())}`);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
