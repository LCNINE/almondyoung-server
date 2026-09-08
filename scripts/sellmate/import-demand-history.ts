/**
 * 셀메이트 주문/판매 export → core `sku_demand_daily` (source='sellmate') 시드 (#743 A, 스펙 §4.2)
 *
 * 실행 (live 터널 필요, 런북 docs/runbooks/selmate-stock-pipeline.md 「사전 준비」):
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/        # 파싱 · 매칭 · 리포트만
 *   bash scripts/sellmate/run.sh live import-demand-history apps/core/tmp/ [--core-since 2026-07-01]
 *
 * 규칙:
 *  - 품목 식별은 옵션정보일련번호 = skus.code (import-products.ts 규약). 미매칭은 중단하지 않고
 *    apps/core/tmp/demand-unmatched-<ts>.csv 로 남긴다 — 조용히 사라지지 않게.
 *  - D0(replenishment_settings.demand_core_since) 이전 날짜만 시드한다. D0 는 --core-since > 기존 설정 >
 *    core sales_orders 최소 주문일 순서로 정하고, 기존 설정이 있으면 덮어쓰지 않는다(경고만).
 *  - (sku_id, demand_date) upsert — 같은 파일을 다시 돌려도 결과가 같다. 단, 그 행이 이미 source='core' 면
 *    덮어쓰지 않고 건너뛴다(ON CONFLICT ... WHERE sku_demand_daily.source <> 'core') — --core-since 를 실제
 *    최초 in-house 주문일보다 늦게 준 채로 재실행해도 이미 쌓인 core 실적을 지우지 않는다.
 *  - 열 이름 별칭은 DEMAND_COLUMN_CANDIDATES, env COL_ITEM_CODE / COL_ORDER_DATE / COL_QTY / COL_AMOUNT 로 덮어쓴다.
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres, { Sql } from 'postgres';
import { readRows, detectColumns, chunk } from './parse';

export const DEMAND_COLUMN_CANDIDATES = {
  itemCode: ['옵션정보일련번호', '옵션코드', '품목코드', '판매처옵션코드'],
  orderDate: ['주문일', '주문일자', '주문일시', '결제일', '결제일시', '판매일', '주문날짜'],
  qty: ['수량', '주문수량', '판매수량', '상품수량'],
  amount: ['금액', '결제금액', '판매금액', '상품금액', '합계금액', '주문금액'],
} as const;

type DemandField = keyof typeof DEMAND_COLUMN_CANDIDATES;

const OVERRIDES: Partial<Record<DemandField, string | undefined>> = {
  itemCode: process.env.COL_ITEM_CODE,
  orderDate: process.env.COL_ORDER_DATE,
  qty: process.env.COL_QTY,
  amount: process.env.COL_AMOUNT,
};

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const REPORT_DIR = path.join('apps', 'core', 'tmp');

export interface DemandRow {
  itemCode: string;
  date: string;
  qty: number;
  amount: number | null;
}

/** '2026-07-01' · '2026.7.1' · '2026/07/01 16:21' · '2026-07-01 오후 4:21:00' → 'YYYY-MM-DD'. 달력 유효성까지 본다. */
export function parseDate(raw: string): string | null {
  const m = (raw ?? '').match(/(\d{4})[.\-/]\s*(\d{1,2})[.\-/]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // Date.UTC 로 왕복해 2026-13-01 · 2026-02-30 을 거른다. 문자열만 만들므로 런타임 TZ 무관.
  return new Date(Date.UTC(y, mo - 1, d)).toISOString().slice(0, 10) === iso ? iso : null;
}

/** '1,234' · '12,000원' → 숫자. 빈값 · 숫자 없음 → null. */
export function parseNumber(raw: string): number | null {
  const digits = (raw ?? '').replace(/[^\d.-]/g, '');
  if (digits === '' || digits === '-' || digits === '.') return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

export function parseDemandRows(
  rows: string[][],
  file: string,
  quiet = false,
): { rows: DemandRow[]; skipped: Map<string, number> } {
  if (rows.length === 0) throw new Error(`${path.basename(file)}: 빈 파일`);
  const header = rows[0];
  const cols = detectColumns(header, DEMAND_COLUMN_CANDIDATES, OVERRIDES);
  if (!quiet) {
    console.log(`\n📄 ${path.basename(file)} — 감지된 열 매핑:`);
    for (const field of Object.keys(DEMAND_COLUMN_CANDIDATES) as DemandField[]) {
      const idx = cols[field];
      console.log(`   ${field.padEnd(10)} → [${idx}] "${idx >= 0 ? header[idx] : '(없음)'}"`);
    }
  }
  const missing = (['itemCode', 'orderDate', 'qty'] as DemandField[]).filter((f) => cols[f] < 0);
  if (missing.length) {
    throw new Error(
      `${path.basename(file)}: 필수 열을 못 찾았습니다 — ${missing
        .map((f) => DEMAND_COLUMN_CANDIDATES[f][0])
        .join(', ')}. COL_ITEM_CODE / COL_ORDER_DATE / COL_QTY 로 헤더를 지정하세요.`,
    );
  }

  const parsed: DemandRow[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  for (const r of rows.slice(1)) {
    const itemCode = (r[cols.itemCode] ?? '').trim();
    if (!itemCode) {
      skip('코드 없음');
      continue;
    }
    const date = parseDate(r[cols.orderDate] ?? '');
    if (!date) {
      skip('주문일 없음');
      continue;
    }
    const qty = parseNumber(r[cols.qty] ?? '');
    if (qty === null || qty <= 0) {
      skip('수량 0 이하');
      continue;
    }
    const amount = cols.amount >= 0 ? parseNumber(r[cols.amount] ?? '') : null;
    parsed.push({ itemCode, date, qty: Math.round(qty), amount: amount === null ? null : Math.round(amount) });
  }
  return { rows: parsed, skipped };
}

/** code → date → 합. 금액은 하나라도 있으면 있는 것의 합, 전부 null 이면 null. */
export function aggregateDaily(rows: DemandRow[]): Map<string, Map<string, { qty: number; amount: number | null }>> {
  const result = new Map<string, Map<string, { qty: number; amount: number | null }>>();
  for (const r of rows) {
    const byDate = result.get(r.itemCode) ?? new Map<string, { qty: number; amount: number | null }>();
    const cell = byDate.get(r.date) ?? { qty: 0, amount: null };
    cell.qty += r.qty;
    if (r.amount !== null) cell.amount = (cell.amount ?? 0) + r.amount;
    byDate.set(r.date, cell);
    result.set(r.itemCode, byDate);
  }
  return result;
}

export function resolveCoreSince(
  arg: string | null,
  existing: string | null,
  minCoreOrderDate: string | null,
): { value: string | null; warning: string | null } {
  if (existing !== null) {
    const warning =
      arg !== null && arg !== existing
        ? `--core-since ${arg} 는 기존 D0 ${existing} 와 다릅니다 — 덮어쓰지 않고 기존 값을 씁니다.`
        : null;
    return { value: existing, warning };
  }
  if (arg !== null) return { value: arg, warning: null };
  if (minCoreOrderDate !== null) return { value: minCoreOrderDate, warning: null };
  return { value: null, warning: 'core 주문이 없어 D0 를 정할 수 없습니다 — 시계열은 전부 적재하고 D0 는 비워 둡니다.' };
}

export function splitByCoreSince<T extends { date: string }>(rows: T[], coreSince: string | null): { before: T[]; onOrAfter: T[] } {
  if (coreSince === null) return { before: rows, onOrAfter: [] };
  return { before: rows.filter((r) => r.date < coreSince), onOrAfter: rows.filter((r) => r.date >= coreSince) };
}

export function unmatchedCsv(items: Array<{ itemCode: string; qty: number; days: number }>): string {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [
    '\ufeff옵션정보일련번호,수량합,발생일수',
    ...items.map((i) => [i.itemCode, i.qty, i.days].map(esc).join(',')),
  ].join('\n');
}

function parseArgs(argv: string[]): { target: string | null; coreSince: string | null } {
  const target = argv.find((a) => !a.startsWith('--')) ?? null;
  const idx = argv.indexOf('--core-since');
  const coreSince = idx >= 0 ? (argv[idx + 1] ?? null) : null;
  if (coreSince !== null && !/^\d{4}-\d{2}-\d{2}$/.test(coreSince)) {
    throw new Error(`--core-since 는 YYYY-MM-DD 여야 합니다: ${coreSince}`);
  }
  return { target, coreSince };
}

async function main() {
  const { target, coreSince: coreSinceArg } = parseArgs(process.argv.slice(2));
  if (!target) {
    console.error('사용법: npx tsx scripts/sellmate/import-demand-history.ts <파일 또는 폴더경로> [--core-since YYYY-MM-DD]');
    process.exit(1);
  }
  const stat = fs.statSync(target);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(target)
        .filter((f) => ['.csv', '.xlsx', '.xls'].includes(path.extname(f).toLowerCase()))
        .sort((a, b) => a.localeCompare(b))
        .map((f) => path.join(target, f))
    : [target];
  if (files.length === 0) {
    console.error(`처리할 xls/csv/xlsx 파일이 없습니다: ${target}`);
    process.exit(1);
  }

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB).');
    process.exit(1);
  }

  console.log(`📂 처리 대상 ${files.length}개:\n   ${files.map((f) => path.basename(f)).join('\n   ')}`);
  const all: DemandRow[] = [];
  const skippedTotal = new Map<string, number>();
  for (const file of files) {
    const { rows, skipped } = parseDemandRows(await readRows(file), file);
    console.log(`   → ${rows.length}행 파싱`);
    all.push(...rows);
    for (const [k, v] of skipped) skippedTotal.set(k, (skippedTotal.get(k) ?? 0) + v);
  }
  for (const [reason, count] of skippedTotal) console.log(`   ⛔ 제외 ${count}행 — ${reason}`);

  const sql = postgres(DATABASE_URL, { max: 4 });
  try {
    // 'default' 는 apps/core/.../replenishment-settings.reader.ts 의 SETTINGS_KEY 리터럴과 같은 값이어야 한다.
    // 이 스크립트는 apps/core 를 import 할 수 없어 리터럴을 그대로 둔다.
    const [settings] = await sql<{ d0: string | null }[]>`
      SELECT demand_core_since::text AS d0 FROM replenishment_settings WHERE key = 'default'
    `;
    if (!settings) throw new Error('replenishment_settings 가 비어 있습니다 — db:seed:ref 를 먼저 돌리세요.');
    const [minRow] = await sql<{ d: string | null }[]>`
      SELECT MIN((order_date AT TIME ZONE 'Asia/Seoul')::date)::text AS d FROM sales_orders
    `;
    const { value: coreSince, warning } = resolveCoreSince(coreSinceArg, settings.d0, minRow?.d ?? null);
    if (warning) console.warn(`⚠️  ${warning}`);
    console.log(`📅 D0(demand_core_since) = ${coreSince ?? '(없음)'} — 이 날 이전 행만 시드`);

    const { before, onOrAfter } = splitByCoreSince(all, coreSince);
    if (onOrAfter.length) console.log(`   ⛔ D0 이후 ${onOrAfter.length}행 제외 (core 가 그 구간을 소유)`);
    const agg = aggregateDaily(before);
    const codes = [...agg.keys()];

    const skuByCode = new Map<string, string>();
    for (const part of chunk(codes, 1000)) {
      const found = await sql<{ id: string; code: string }[]>`SELECT id, code FROM skus WHERE code IN ${sql(part)}`;
      for (const r of found) skuByCode.set(r.code, r.id);
    }
    const unmatched = codes.filter((c) => !skuByCode.has(c));
    if (unmatched.length) {
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
      const report = path.join(REPORT_DIR, `demand-unmatched-${ts}.csv`);
      fs.writeFileSync(
        report,
        unmatchedCsv(
          unmatched.map((code) => {
            const byDate = agg.get(code)!;
            return { itemCode: code, qty: [...byDate.values()].reduce((s, c) => s + c.qty, 0), days: byDate.size };
          }),
        ),
      );
      console.log(`⚠️  core 에 없는 품목 ${unmatched.length}개 → ${report} (계속 진행)`);
    }

    const values: Array<{ sku_id: string; demand_date: string; qty: number; amount: number | null; source: 'sellmate'; updated_at: Date }> = [];
    const now = new Date();
    for (const [code, byDate] of agg) {
      const skuId = skuByCode.get(code);
      if (!skuId) continue;
      for (const [date, cell] of byDate) {
        values.push({ sku_id: skuId, demand_date: date, qty: cell.qty, amount: cell.amount, source: 'sellmate', updated_at: now });
      }
    }
    console.log(`📊 적재 대상: 품목 ${skuByCode.size}개 · (품목, 날짜) ${values.length}행`);

    if (DRY_RUN) {
      console.log('🧪 DRY_RUN — DB 미반영. 위 수치와 미매칭 리포트를 확인하세요.');
      return;
    }

    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Sql;
      for (const part of chunk(values, 1000)) {
        await tx`
          INSERT INTO sku_demand_daily ${tx(part, 'sku_id', 'demand_date', 'qty', 'amount', 'source', 'updated_at')}
          ON CONFLICT (sku_id, demand_date) DO UPDATE SET
            qty = excluded.qty, amount = excluded.amount, source = 'sellmate', updated_at = excluded.updated_at
          WHERE sku_demand_daily.source <> 'core'
        `;
      }
      if (settings.d0 === null && coreSince !== null) {
        // 'default' 는 apps/core/.../replenishment-settings.reader.ts 의 SETTINGS_KEY 리터럴과 같은 값이어야 한다.
        // 이 스크립트는 apps/core 를 import 할 수 없어 리터럴을 그대로 둔다.
        await tx`UPDATE replenishment_settings SET demand_core_since = ${coreSince}::date, updated_at = now() WHERE key = 'default' AND demand_core_since IS NULL`;
        console.log(`✔ demand_core_since = ${coreSince} 설정`);
      }
    });
    console.log(`✔ sku_demand_daily: ${values.length}행 upsert`);
  } finally {
    await sql.end();
  }
}

// 테스트에서 import 할 때는 main 을 자동 실행하지 않는다.
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
