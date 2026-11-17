/**
 * sku_barcodes 행이 하나도 없는 SKU 에 SKU 코드(skus.code)를 대표 바코드로 등록한다 (#1281).
 * 스테이션 SKU 라벨이 «바코드 없음» 으로 찍히지 않게 하려는 일회성 보충이다. #1356 백필 뒤에 돌린다.
 * - 이미 행이 하나라도 있는 SKU 는 건드리지 않는다
 * - 그 코드를 다른 SKU 가 바코드로 쓰고 있으면 넣지 않고 보고만 한다
 *
 * 기본은 dry-run(읽기 전용 트랜잭션, 계획만 출력). --apply 를 줘야 반영한다. 테넌트 DB 마다 따로 돈다.
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live register-missing-barcodes
 *   bash scripts/sellmate/run.sh live register-missing-barcodes --apply
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray, notExists, eq, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';

const CHUNK = 1000;

export interface MissingBarcodeRow {
  skuId: string;
  code: string;
}

export interface MissingBarcodePlan {
  insert: { skuId: string; barcode: string }[];
  conflicts: { skuId: string; barcode: string; ownerSkuId: string }[];
}

/**
 * rows: 바코드 행이 없는 SKU 와 그 코드. taken: 이미 쓰이는 바코드 값 → 소유 SKU id.
 * DB 를 모르는 순수 함수다.
 */
export function planMissingBarcodes(
  rows: readonly MissingBarcodeRow[],
  taken: ReadonlyMap<string, string>,
): MissingBarcodePlan {
  const plan: MissingBarcodePlan = { insert: [], conflicts: [] };
  const claimed = new Map<string, string>();

  for (const { skuId, code } of rows) {
    const owner = taken.get(code) ?? claimed.get(code);

    if (owner !== undefined) {
      plan.conflicts.push({ skuId, barcode: code, ownerSkuId: owner });
      continue;
    }

    claimed.set(code, skuId);
    plan.insert.push({ skuId, barcode: code });
  }

  return plan;
}

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];

  for (let i = 0; i < list.length; i += CHUNK) {
    out.push(list.slice(i, i + CHUNK));
  }

  return out;
}

async function readPlan(tx: DbTx): Promise<{ plan: MissingBarcodePlan; missingCount: number }> {
  const rows: MissingBarcodeRow[] = await tx
    .select({ skuId: wmsTables.skus.id, code: wmsTables.skus.code })
    .from(wmsTables.skus)
    .where(
      notExists(
        tx
          .select({ one: sql`1` })
          .from(wmsTables.skuBarcodes)
          .where(eq(wmsTables.skuBarcodes.skuId, wmsTables.skus.id)),
      ),
    )
    .orderBy(wmsTables.skus.createdAt, wmsTables.skus.id);
  const taken = new Map<string, string>();

  for (const part of chunks([...new Set(rows.map((row) => row.code))])) {
    const owned = await tx
      .select({ barcode: wmsTables.skuBarcodes.barcode, skuId: wmsTables.skuBarcodes.skuId })
      .from(wmsTables.skuBarcodes)
      .where(inArray(wmsTables.skuBarcodes.barcode, part));

    for (const row of owned) {
      taken.set(row.barcode, row.skuId);
    }
  }

  return { plan: planMissingBarcodes(rows, taken), missingCount: rows.length };
}

function printPlan(plan: MissingBarcodePlan, missingCount: number) {
  console.log(`📄 바코드 행이 없는 SKU ${missingCount}개`);
  console.log(`   SKU 코드를 대표 바코드로 등록 ${plan.insert.length}`);
  console.log(`   손대지 않음(다른 SKU 가 그 값을 씀) ${plan.conflicts.length}`);

  for (const c of plan.conflicts.slice(0, 10)) {
    console.log(`   ⚠️  충돌 ${c.barcode} (sku ${c.skuId}) — 쓰는 sku ${c.ownerSkuId}`);
  }
}

async function applyPlan(tx: DbTx, plan: MissingBarcodePlan): Promise<number> {
  let inserted = 0;

  for (const part of chunks(plan.insert)) {
    const done = await tx
      .insert(wmsTables.skuBarcodes)
      .values(part.map((row) => ({ skuId: row.skuId, barcode: row.barcode, isPrimary: true })))
      .onConflictDoNothing({ target: wmsTables.skuBarcodes.barcode })
      .returning({ id: wmsTables.skuBarcodes.id });

    inserted += done.length;
  }

  return inserted;
}

export function parseCliArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { apply: boolean } {
  const dryRunEnv = env.DRY_RUN === '1' || env.DRY_RUN === 'true';
  const apply = argv.includes('--apply');

  if (dryRunEnv && apply) {
    throw new Error('DRY_RUN 과 --apply 를 함께 줄 수 없습니다 — 하나만 고르세요');
  }

  return { apply };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;

  if (!url) {
    console.error(
      'DATABASE_URL 환경변수가 필요합니다 (core 논리 DB). 라이브는 scripts/sellmate/run.sh live register-missing-barcodes',
    );
    process.exit(1);
  }

  const { apply } = parseCliArgs(process.argv.slice(2), process.env);
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema: wmsSchema });

  try {
    if (!apply) {
      await db.transaction(
        async (tx) => {
          const { plan, missingCount } = await readPlan(tx);

          printPlan(plan, missingCount);
          console.log('\n🧪 DRY-RUN — 아무것도 바꾸지 않았습니다. 반영하려면 --apply');
        },
        { accessMode: 'read only' },
      );

      return;
    }

    await db.transaction(async (tx) => {
      const { plan, missingCount } = await readPlan(tx);

      printPlan(plan, missingCount);

      const inserted = await applyPlan(tx, plan);

      console.log(
        `\n✅ 적용 — 넣음 ${inserted} · 충돌로 건너뜀 ${plan.conflicts.length + (plan.insert.length - inserted)}`,
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
