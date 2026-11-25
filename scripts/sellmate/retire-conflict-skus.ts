/**
 * 짝 표의 code_barcode_conflict 를 푼다 — 예전 품목 SKU 의 재고를 0 으로 내리고 바코드를 떼며,
 * 지금 파는 SKU 가 들고 있는 남의 바코드를 뗀다. 갈래는 retire-conflict-plan.ts.
 *
 * 왜: 셀메이트에서 내린 예전 품목의 core SKU 가 같은 바코드와 재고를 들고 있어, sync-stock 이 못 맞추는 재고가
 * T 뒤에도 남아 같은 물건이 두 번 세어진다(런북 §1 짝 표 🔴).
 *
 * 입력은 마지막 `evening-reconcile pair --apply` 가 남긴 sellmate_item_pairs 다 — 짝 표를 먼저 돌린다.
 * 쓰기(--apply 일 때만, 한 트랜잭션): sync-stock 과 같은 advisory lock → applyStockDelta(ADJUST_DOWN, reason='sellmate-retire')
 * → sku_barcodes 행 삭제. 커밋 뒤 매칭된 SKU 의 sellable 을 다시 계산한다.
 * 기본은 dry-run — 표만 찍는다. 다시 돌려도 된다(뗀 바코드는 보유자가 없어 다음 실행의 대상이 아니다).
 *
 *   bash scripts/sellmate/run.sh live retire-conflict-skus
 *   bash scripts/sellmate/run.sh live retire-conflict-skus --apply
 * 그 다음 짝 표를 다시 돌려 종료 0 을 본다.
 */
import postgres, { Sql } from 'postgres';
import { applyStockDelta, BUCHEON_WAREHOUSE_ID } from './stock-delta';
import { lockStock } from './reconcile/reconcile-store';
import { recalcSellableForSkus } from './recalc-sellable';
import { ConflictRow, Holder, Plan, planRetire } from './retire-conflict-plan';

export const RETIRE_SOURCE = 'sellmate-retire';

class RefusedError extends Error {}

async function loadPlan(tx: Sql): Promise<Plan> {
  const conflicts = await tx<ConflictRow[]>`
    SELECT option_serial AS "optionSerial", item_name AS "itemName", barcode
    FROM sellmate_item_pairs
    WHERE unpaired_reason = 'code_barcode_conflict' AND barcode IS NOT NULL
    ORDER BY item_name, option_serial
  `;
  const barcodes = conflicts.map((c) => c.barcode);
  const holders: readonly Holder[] =
    barcodes.length === 0
      ? []
      : await tx<Holder[]>`
    SELECT s.id AS "skuId", s.code, s.name, b.barcode, b.is_primary AS "isPrimary",
      (SELECT count(*)::int FROM sku_barcodes x WHERE x.sku_id = s.id) AS "barcodeCount",
      coalesce((SELECT sum(l.qty)::int FROM stock_ledgers l
        WHERE l.sku_id = s.id AND l.stock_state = 'ON_HAND' AND l.warehouse_id = ${BUCHEON_WAREHOUSE_ID}), 0) AS "onHandBucheon",
      coalesce((SELECT sum(l.qty)::int FROM stock_ledgers l
        WHERE l.sku_id = s.id AND l.stock_state = 'ON_HAND' AND l.warehouse_id <> ${BUCHEON_WAREHOUSE_ID}), 0) AS "onHandElsewhere",
      (SELECT count(*)::int FROM stock_reservations r
        WHERE r.sku_id = s.id AND r.status <> 'released') AS "openReservations"
    FROM sku_barcodes b JOIN skus s ON s.id = b.sku_id
    WHERE b.barcode IN ${tx(barcodes)}
  `;
  const paired = await tx<{ sku_id: string }[]>`
    SELECT DISTINCT sku_id FROM sellmate_item_pairs WHERE sku_id IS NOT NULL
  `;

  return planRetire(
    conflicts,
    new Map(holders.map((h): [string, Holder] => [h.barcode, h])),
    new Set(paired.map((p) => p.sku_id)),
  );
}

function report(plan: Plan): void {
  const retire = plan.rows.filter((r) => r.kind === 'retire');
  const unbarcode = plan.rows.filter((r) => r.kind === 'unbarcode');

  console.log(
    `\n📋 예전 품목 정리 ${retire.length}개 — 재고 0 + 바코드 떼기 (합계 -${retire.reduce((s, r) => s + r.take, 0)})`,
  );
  console.log('   core 코드 | core 이름 | 떼는 바코드 | 부천 재고 → 0 | 셀메이트 품목');
  for (const r of retire) {
    console.log(`   ${r.holder.code} | ${r.holder.name} | ${r.barcode} | ${r.take} | ${r.itemName}`);
  }

  console.log(`\n📋 남의 바코드만 떼기 ${unbarcode.length}개 — 재고는 그대로`);
  console.log('   core 코드 | core 이름 | 떼는 바코드(대표?) | 그 바코드의 셀메이트 품목');
  for (const r of unbarcode) {
    console.log(
      `   ${r.holder.code} | ${r.holder.name} | ${r.barcode}${r.holder.isPrimary ? ' (대표)' : ''} | ${r.itemName}`,
    );
  }

  if (plan.noHolder.length) {
    console.log(`\nℹ️  보유자 없는 충돌 ${plan.noHolder.length}건 — 이미 풀렸다. 짝 표를 다시 돌리면 사라진다:`);
    for (const c of plan.noHolder) console.log(`   ${c.barcode} | ${c.itemName}`);
  }
  if (plan.blockers.length) console.log(`\n⛔ --apply 는 거절된다:\n   ${plan.blockers.join('\n   ')}`);
}

async function inTransaction<T>(sql: Sql, fn: (tx: Sql) => Promise<T>): Promise<T> {
  const conn = await sql.reserve();
  try {
    await conn`BEGIN`;
    try {
      const result = await fn(conn);
      await conn`COMMIT`;

      return result;
    } catch (err) {
      await conn`ROLLBACK`.catch(() => undefined);
      throw err;
    }
  } finally {
    conn.release();
  }
}

async function main(): Promise<void> {
  const apply = process.argv.slice(2).includes('--apply');
  const url = process.env.DATABASE_URL;
  if (!url) throw new RefusedError('DATABASE_URL 이 필요하다 — bash scripts/sellmate/run.sh live retire-conflict-skus');

  const sql = postgres(url, { max: 2, onnotice: () => undefined });
  try {
    if (!apply) {
      report(await loadPlan(sql));
      console.log('\n✅ DRY-RUN 종료 — DB 미반영. 반영은 --apply.');

      return;
    }

    const changed = await inTransaction(sql, async (tx) => {
      await lockStock(tx);
      const plan = await loadPlan(tx);
      report(plan);
      if (plan.blockers.length) throw new RefusedError('--apply 를 거절한다(위 ⛔)');

      const now = new Date();
      const skuIds: string[] = [];
      for (const r of plan.rows) {
        if (r.take > 0) {
          await applyStockDelta(tx, {
            skuId: r.holder.skuId,
            delta: -r.take,
            source: RETIRE_SOURCE,
            label: r.holder.code,
            occurredAt: now,
          });
          skuIds.push(r.holder.skuId);
        }

        const del = await tx`DELETE FROM sku_barcodes WHERE sku_id = ${r.holder.skuId} AND barcode = ${r.barcode}`;
        if (del.count !== 1)
          throw new Error(`바코드 삭제 영향행 ${del.count}: ${r.holder.code} ${r.barcode} — 전체 롤백`);
      }

      return { skuIds, rows: plan.rows.length };
    });

    console.log(
      `\n✅ 반영 완료: ${changed.rows}건 바코드 삭제, ${changed.skuIds.length}개 SKU 재고 0 (reason='${RETIRE_SOURCE}').`,
    );
    const variants = await recalcSellableForSkus(url, changed.skuIds, false);
    console.log(`   sellable 재계산 variant ${variants}개. 이어서 짝 표를 다시 돌린다.`);
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(
      `\n❌ ${err instanceof RefusedError ? '' : '실패: '}${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
