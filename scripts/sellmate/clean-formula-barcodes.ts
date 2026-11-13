/**
 * 셀메이트 «바코드번호(서식)» 열에서 ="…" 꼴 그대로 들어간 sku_barcodes 를 정리한다.
 * - 같은 SKU 에 정상 값이 있으면 수식 꼴 행을 지운다(대표·상자 수량은 정상 행으로 넘긴다)
 * - 정상 값이 없으면 벗긴 값으로 고친다 — 바코드가 수식 꼴뿐이라 스캔으로 못 찾던 SKU 가 풀린다
 * - 벗긴 값을 다른 SKU 가 쓰면 손대지 않고 보고만 한다
 *
 * 기본은 dry-run(읽기 전용 트랜잭션, 계획만 출력). --apply 를 줘야 반영한다.
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live clean-formula-barcodes
 *   bash scripts/sellmate/run.sh live clean-formula-barcodes --apply
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../apps/core/src/modules/inventory/schema/inventory.schema';
import { BarcodeRow, FormulaBarcodePlan, planFormulaBarcodes, unwrapFormula } from './formula-barcodes-plan';

const CHUNK = 1000;

function chunks<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];

  for (let i = 0; i < list.length; i += CHUNK) {
    out.push(list.slice(i, i + CHUNK));
  }

  return out;
}

const barcodeColumns = {
  id: wmsTables.skuBarcodes.id,
  skuId: wmsTables.skuBarcodes.skuId,
  barcode: wmsTables.skuBarcodes.barcode,
  isPrimary: wmsTables.skuBarcodes.isPrimary,
  packingUnit: wmsTables.skuBarcodes.packingUnit,
};

async function readPlan(tx: DbTx): Promise<{ plan: FormulaBarcodePlan; formulaCount: number }> {
  const formulaRows: BarcodeRow[] = await tx
    .select(barcodeColumns)
    .from(wmsTables.skuBarcodes)
    .where(sql`${wmsTables.skuBarcodes.barcode} ~ '^="[^"]*"$'`)
    .orderBy(wmsTables.skuBarcodes.createdAt, wmsTables.skuBarcodes.id);
  const values = [...new Set(formulaRows.map((row) => unwrapFormula(row.barcode)).filter(Boolean))];
  const cleanRows: BarcodeRow[] = [];

  for (const part of chunks(values)) {
    cleanRows.push(
      ...(await tx.select(barcodeColumns).from(wmsTables.skuBarcodes).where(inArray(wmsTables.skuBarcodes.barcode, part)))
    );
  }

  return { plan: planFormulaBarcodes(formulaRows, cleanRows), formulaCount: formulaRows.length };
}

async function printPlan(tx: DbTx, plan: FormulaBarcodePlan, formulaCount: number) {
  console.log(`📄 수식 꼴 바코드 ${formulaCount}행`);
  console.log(`   지움(같은 SKU 에 정상 값 있음) ${plan.deletes.length}`);
  console.log(`   고침(벗긴 값으로)              ${plan.updates.length}`);
  console.log(`   대표·상자 수량 넘김            ${plan.carries.length}`);
  console.log(`   손대지 않음(다른 SKU 가 씀)    ${plan.conflicts.length}`);
  console.log(`   손대지 않음(벗기면 빈 값)      ${plan.empties.length}`);

  for (const u of plan.updates.slice(0, 5)) {
    console.log(`   예) 고침 ${u.row.barcode} → ${u.to}`);
  }

  for (const c of plan.conflicts.slice(0, 10)) {
    console.log(`   ⚠️  충돌 ${c.row.barcode} (sku ${c.row.skuId}) — 정상 값의 주인 sku ${c.ownerSkuId}`);
  }

  const fixedSkuIds = [...new Set(plan.updates.map((u) => u.row.skuId))];
  const stocked: { code: string; name: string; qty: number }[] = [];

  for (const part of chunks(fixedSkuIds)) {
    stocked.push(
      ...(await tx
        .select({
          code: wmsTables.skus.code,
          name: wmsTables.skus.name,
          qty: sql<number>`sum(${wmsTables.stockLedgers.qty})::int`,
        })
        .from(wmsTables.stockLedgers)
        .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.stockLedgers.skuId))
        .where(
          and(
            inArray(wmsTables.stockLedgers.skuId, part),
            eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
            gt(wmsTables.stockLedgers.qty, 0)
          )
        )
        .groupBy(wmsTables.skus.code, wmsTables.skus.name))
    );
  }

  console.log(`\n🔓 고치면 스캔으로 찾게 되는 SKU ${fixedSkuIds.length}개 — 그중 재고 있는 SKU ${stocked.length}개`);

  for (const s of stocked) {
    console.log(`   ${s.code}  ${s.name}  (ON_HAND ${s.qty})`);
  }
}

async function applyPlan(tx: DbTx, plan: FormulaBarcodePlan) {
  for (const part of chunks(plan.deletes.map((row) => row.id))) {
    await tx.delete(wmsTables.skuBarcodes).where(inArray(wmsTables.skuBarcodes.id, part));
  }

  for (const carry of plan.carries) {
    await tx
      .update(wmsTables.skuBarcodes)
      .set({
        ...(carry.isPrimary ? { isPrimary: true } : {}),
        ...(carry.packingUnit !== null ? { packingUnit: carry.packingUnit } : {}),
        updatedAt: new Date(),
      })
      .where(eq(wmsTables.skuBarcodes.id, carry.to.id));
  }

  for (const update of plan.updates) {
    await tx
      .update(wmsTables.skuBarcodes)
      .set({ barcode: update.to, updatedAt: new Date() })
      .where(and(eq(wmsTables.skuBarcodes.id, update.row.id), eq(wmsTables.skuBarcodes.barcode, update.row.barcode)));
  }
}

export function parseCliArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): { apply: boolean } {
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
    console.error('DATABASE_URL 환경변수가 필요합니다 (core 논리 DB). 라이브는 scripts/sellmate/run.sh live clean-formula-barcodes');
    process.exit(1);
  }

  const { apply } = parseCliArgs(process.argv.slice(2), process.env);
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema: wmsSchema });

  try {
    if (!apply) {
      await db.transaction(
        async (tx) => {
          const { plan, formulaCount } = await readPlan(tx);

          await printPlan(tx, plan, formulaCount);
          console.log('\n🧪 DRY-RUN — 아무것도 바꾸지 않았습니다. 반영하려면 --apply');
        },
        { accessMode: 'read only' }
      );

      return;
    }

    await db.transaction(async (tx) => {
      const { plan, formulaCount } = await readPlan(tx);

      await printPlan(tx, plan, formulaCount);
      await applyPlan(tx, plan);
      console.log(`\n✅ 적용 — 지움 ${plan.deletes.length} · 고침 ${plan.updates.length} · 넘김 ${plan.carries.length}`);
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
