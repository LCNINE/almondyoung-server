/**
 * #1063 백필(스펙 §9.1) — PR 1 배포(`migrate → deploy`) **뒤 한 번**.
 *
 * FO 항목이 있는데 구성 출처가 NULL 인 라인을 FO 항목에서 역산해 `matching` 으로 굳힌다. 이게 끝나야 PR 2 의 주문별 수정이
 * 그 라인을 `COMPOSITION_NOT_FROZEN` 으로 거절하지 않는다. 출고에는 영향이 없다(FO 는 이미 만들어졌다).
 * 역산이 안 되는 라인(ambiguous·indivisible)은 쓰지 않고 목록만 찍는다 — 사람이 판단한다.
 *
 * 사용법 (deployments/lcnine/services 에서):
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-14-backfill-line-compositions.ts          # 조회만 (기본)
 *   npx sst shell --stage live -- npx tsx ../../../scripts/ops/1016-14-backfill-line-compositions.ts --apply  # 실제 굳히기
 */
import postgres from 'postgres';
import { Resource } from 'sst';
import { sumCancelledByLine } from '../../apps/core/src/modules/product-matching/line-composition/partial-cancellation';
import { BackfillLine, deriveComposition } from './1016-14-line-composition-backfill';

const APPLY = process.argv.includes('--apply');

type FoItemRow = { lineId: string; salesOrderId: string; quantity: number; skuId: string; qty: number };
type CancellationRow = { salesOrderId: string; metadata: unknown };

async function main() {
  // `Resource` 의 타입 선언에는 `Db` 가 없다(SST 가 배포 시점에 채운다). 기존 ops 스크립트와 같은 이유로 캐스팅한다.
  const Db = (Resource as unknown as { Db: { host: string; port: number; username: string; password: string } }).Db;
  const sql = postgres({
    host: Db.host,
    port: Db.port,
    username: Db.username,
    password: Db.password,
    database: 'core',
    ssl: 'require',
    max: 1,
    connect_timeout: 30,
  });
  try {
    console.log(`모드: ${APPLY ? '적용 (--apply)' : '조회만 — 적용하려면 --apply'}\n`);

    // fulfillment_order_items.sales_order_line_id 는 varchar 라 uuid 를 text 로 맞춘다
    const rows = await sql<FoItemRow[]>`
      SELECT l.id AS "lineId", l.sales_order_id AS "salesOrderId", l.quantity,
             foi.sku_id AS "skuId", SUM(foi.qty)::int AS qty
      FROM sales_order_lines l
      JOIN fulfillment_order_items foi ON foi.sales_order_line_id = l.id::text
      WHERE l.composition_source IS NULL
      GROUP BY l.id, l.sales_order_id, l.quantity, foi.sku_id
      ORDER BY l.id`;
    const orderIds = [...new Set(rows.map((r) => r.salesOrderId))];
    const cancellations: CancellationRow[] =
      orderIds.length === 0
        ? []
        : await sql<CancellationRow[]>`
            SELECT sales_order_id AS "salesOrderId", metadata
            FROM sales_order_cancellations WHERE sales_order_id = ANY(${orderIds}::uuid[])`;
    const cancelledByLine = sumCancelledByLine(cancellations.map((c) => c.metadata));

    const lines = new Map<string, BackfillLine>();
    for (const row of rows) {
      const line = lines.get(row.lineId) ?? {
        lineId: row.lineId,
        quantity: row.quantity,
        cancelledQty: cancelledByLine.get(row.lineId) ?? 0,
        foItems: [],
      };
      line.foItems.push({ skuId: row.skuId, qty: row.qty });
      lines.set(row.lineId, line);
    }

    const decisions = [...lines.values()].map(deriveComposition);
    const ok = decisions.filter((d) => d.kind === 'ok');
    const rest = decisions.filter((d) => d.kind !== 'ok');
    console.log(`대상 라인 ${decisions.length} · 역산 가능 ${ok.length} · 사람 판단 ${rest.length}`);
    for (const d of rest)
      console.log(`  ${d.kind}\t${d.lineId}${d.kind === 'ambiguous' ? `\t후보 ${d.candidates.join('/')}` : ''}`);

    if (!APPLY) return;

    let written = 0;
    for (const d of ok) {
      if (d.kind !== 'ok') continue;
      await sql.begin(async (trx) => {
        // postgres.js 의 TransactionSql 은 Omit 으로 호출 시그니처를 잃는다(타입 결함) — 런타임은 Sql 과 같다
        const tx = trx as unknown as postgres.Sql;
        // 출처 NULL 조건 — 그새 FO 생성·운영자가 굳혔으면 건드리지 않는다
        const claimed = await tx`
          UPDATE sales_order_lines
          SET composition_source = 'matching', composition_set_at = now(), updated_at = now()
          WHERE id = ${d.lineId} AND composition_source IS NULL
          RETURNING id`;
        if (claimed.length === 0) return;
        for (const item of d.items) {
          await tx`
            INSERT INTO sales_order_line_compositions (sales_order_line_id, sku_id, qty_per_unit)
            VALUES (${d.lineId}, ${item.skuId}, ${item.qtyPerUnit})`;
        }
        written += 1;
      });
    }
    console.log(`\n굳힘 ${written} / ${ok.length}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
