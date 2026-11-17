/**
 * 이미 적재된 SKU 에 셀메이트 «바코드번호2» 를 보조 바코드(is_primary=false)로 한 번 넣는다 (#1356).
 * T 부터 스캔은 core 가 sku_barcodes 에서 찾으므로, 셀메이트에서 스캔되던 바코드번호2 가 없으면 «모르는 바코드»가 된다.
 * - 보조 바코드만 넣는다. SKU·그룹·대표 바코드는 건드리지 않는다
 * - 이미 같은 SKU 에 달린 값(대표든 보조든)은 그대로, 다른 SKU 가 쓰는 값은 넣지 않고 충돌로 보고만 한다
 * - 배정 규칙은 barcode2-plan.ts (가져오기와 같은 함수)
 *
 * 입력: 셀메이트 «현재고 전체» CSV(EUC-KR). 옵션정보일련번호 = skus.code 로 SKU 를 찾는다.
 * register-missing-barcodes.ts 보다 먼저 돌린다 — 그쪽은 바코드 행이 하나도 없는 SKU 만 본다.
 * --apply 전에는 «현재고 전체» 를 다시 받는다 — 받은 뒤에 생긴 SKU 는 파일에 없어 빠진다.
 * 다시 돌린 dry-run 의 «core 에 넣을 것» 이 0 이면 끝이다.
 *
 * 기본은 dry-run(읽기 전용 트랜잭션). --apply 를 줘야 반영한다. 테넌트 1 core DB(run.sh 기본 DB_NAME=core)에만 쓴다.
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live backfill-barcode2 <현재고 CSV>
 *   bash scripts/sellmate/run.sh live backfill-barcode2 <현재고 CSV> --apply
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { readRows } from './parse';
import { dedupeByItemCode, parseFile, type ParsedItem } from './import-products';
import { parseCliArgs } from './register-missing-barcodes';
import { planSecondaryBarcodes, type Barcode2Plan, type Barcode2Want } from './barcode2-plan';

const CHUNK = 1000;
const LIST_LIMIT = 10;

export interface Barcode2Backfill {
  plan: Barcode2Plan;
  /** 바코드번호2 후보가 있는데 skus.code 로 못 찾은 옵션정보일련번호. */
  notInCore: string[];
  /** skuId → stock_ledgers.qty 합. insert·conflicts 의 SKU 만. */
  stock: Map<string, number>;
}

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];

  for (let i = 0; i < list.length; i += CHUNK) {
    out.push(list.slice(i, i + CHUNK));
  }

  return out;
}

const isCandidate = (it: ParsedItem) => it.barcode2 !== '' && it.barcode2 !== it.barcode;

export async function readBarcode2Backfill(tx: DbTx, items: readonly ParsedItem[]): Promise<Barcode2Backfill> {
  const skuIdByCode = new Map<string, string>();

  for (const part of chunks([...new Set(items.map((it) => it.itemCode))])) {
    const rows = await tx
      .select({ id: wmsTables.skus.id, code: wmsTables.skus.code })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.code, part));

    for (const row of rows) {
      skuIdByCode.set(row.code, row.id);
    }
  }

  const notInCore = items.filter((it) => isCandidate(it) && !skuIdByCode.has(it.itemCode)).map((it) => it.itemCode);
  // 후보가 아닌 품목도 넣는다 — 그 대표 바코드가 다른 품목의 보조보다 먼저 차지해야 한다.
  // core 에 아직 없는 품목도 대표만은 자리표 소유자로 선점한다. 안 그러면 다음 가져오기 때 그 품목의 대표가
  // 이 백필이 넣은 남의 보조와 충돌해, T 부터 그 바코드가 엉뚱한 SKU 로 잡힌다.
  const wants: Barcode2Want[] = items.map((it) => {
    const skuId = skuIdByCode.get(it.itemCode);

    return skuId === undefined
      ? { skuId: `(core 에 없음) ${it.itemCode}`, primary: it.barcode, secondary: '' }
      : { skuId, primary: it.barcode, secondary: it.barcode2 };
  });
  const values = [...new Set(wants.flatMap((w) => [w.primary, w.secondary]).filter((v) => v !== ''))];
  const taken = new Map<string, string>();

  for (const part of chunks(values)) {
    const rows = await tx
      .select({ barcode: wmsTables.skuBarcodes.barcode, skuId: wmsTables.skuBarcodes.skuId })
      .from(wmsTables.skuBarcodes)
      .where(inArray(wmsTables.skuBarcodes.barcode, part));

    for (const row of rows) {
      taken.set(row.barcode, row.skuId);
    }
  }

  const plan = planSecondaryBarcodes(wants, taken);
  const stock = new Map<string, number>();
  const stockSkus = [...new Set([...plan.insert, ...plan.conflicts].map((row) => row.skuId))];

  for (const part of chunks(stockSkus)) {
    const sums = await tx
      .select({
        skuId: wmsTables.stockLedgers.skuId,
        qty: sql<number>`coalesce(sum(${wmsTables.stockLedgers.qty}), 0)::int`,
      })
      .from(wmsTables.stockLedgers)
      .where(inArray(wmsTables.stockLedgers.skuId, part))
      .groupBy(wmsTables.stockLedgers.skuId);

    for (const row of sums) {
      stock.set(row.skuId, row.qty);
    }
  }

  return { plan, notInCore, stock };
}

/** 실제로 들어간 행 수를 돌려준다. 그 사이 다른 쪽이 같은 값을 넣었으면 그 행은 건너뛴다. */
export async function applyBarcode2Backfill(tx: DbTx, plan: Barcode2Plan): Promise<number> {
  let inserted = 0;

  for (const part of chunks(plan.insert)) {
    const done = await tx
      .insert(wmsTables.skuBarcodes)
      .values(part.map((row) => ({ skuId: row.skuId, barcode: row.barcode, isPrimary: false })))
      .onConflictDoNothing({ target: wmsTables.skuBarcodes.barcode })
      .returning({ id: wmsTables.skuBarcodes.id });

    inserted += done.length;
  }

  return inserted;
}

function withStock(rows: readonly { skuId: string }[], stock: ReadonlyMap<string, number>): number {
  return new Set(rows.filter((row) => (stock.get(row.skuId) ?? 0) > 0).map((row) => row.skuId)).size;
}

function printBackfill(candidates: number, { plan, notInCore, stock }: Barcode2Backfill): void {
  console.log(`📄 바코드번호2 후보 ${candidates}행 (대표와 다른 값)`);
  console.log(`   core 에 넣을 것 ${plan.insert.length}  (재고 있는 SKU ${withStock(plan.insert, stock)})`);
  console.log(`   이미 같은 SKU ${plan.alreadyOk}`);
  console.log(
    `   다른 SKU 가 점유(충돌, 넣지 않음) ${plan.conflicts.length}  (재고 있는 SKU ${withStock(plan.conflicts, stock)})`,
  );
  console.log(`   core 에 SKU 없음 ${notInCore.length}`);

  for (const c of plan.conflicts.slice(0, LIST_LIMIT)) {
    console.log(
      `   ⚠️  충돌 ${c.barcode} (sku ${c.skuId}, 재고 ${stock.get(c.skuId) ?? 0}) — 쓰는 sku ${c.ownerSkuId}`,
    );
  }

  for (const code of notInCore.slice(0, LIST_LIMIT)) {
    console.log(`   ❔ core 에 없는 옵션정보일련번호 ${code}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));

  if (!file) {
    console.error('사용법: bash scripts/sellmate/run.sh live backfill-barcode2 <현재고 CSV> [--apply]');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      'DATABASE_URL 환경변수가 필요합니다 (core 논리 DB). 라이브는 scripts/sellmate/run.sh live backfill-barcode2',
    );
    process.exit(1);
  }

  const { apply } = parseCliArgs(args, process.env);
  const items = dedupeByItemCode(parseFile(await readRows(file), file, true));
  const candidates = items.filter(isCandidate).length;
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema: wmsSchema });

  try {
    if (!apply) {
      await db.transaction(
        async (tx) => {
          printBackfill(candidates, await readBarcode2Backfill(tx, items));
          console.log('\n🧪 DRY-RUN — 아무것도 바꾸지 않았습니다. 반영하려면 --apply');
        },
        { accessMode: 'read only' },
      );

      return;
    }

    await db.transaction(async (tx) => {
      const backfill = await readBarcode2Backfill(tx, items);

      printBackfill(candidates, backfill);

      const inserted = await applyBarcode2Backfill(tx, backfill.plan);

      console.log(
        `\n✅ 적용 — 보조 바코드 넣음 ${inserted} · 충돌로 건너뜀 ${backfill.plan.conflicts.length + (backfill.plan.insert.length - inserted)}`,
      );
    });
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('\n❌ 실패:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
