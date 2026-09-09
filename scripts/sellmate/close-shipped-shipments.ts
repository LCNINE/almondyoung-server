/**
 * 셀메이트로 출고가 끝났는데 core 에 열린 채 남은 상자(shipment)를 종결하고,
 * 거기 붙들려 있는 확정 예약을 해제한다.
 *
 * 왜 필요한가: 실물 출고는 셀메이트에서 하고 core 의 dispatch 경로는 돌지 않는다.
 * `mark-core-shipped.js` 가 sales_orders / fulfillment_orders 만 shipped 로 올리고
 * shipments / shipment_lines 는 그대로 두기 때문에, 그 라인에 붙은 예약이 영원히
 * confirmed 로 남는다. `available_qty = on_hand − confirmed 예약` 이 음수가 되고
 * 판매가능수량이 0 으로 잘려 **실재고가 있는 상품이 품절로 노출된다.**
 *
 * 순서가 중요하다 — **상자를 먼저 닫고 예약을 푼다.** 재시도 워커
 * (FulfillmentOrderReservationRetryWorker, 10초 주기)의 후보 조건이
 * `shipment.status = 'draft'` 라, 예약만 풀면 풀어준 재고를 같은 유령 라인이 도로 먹는다.
 *
 * 판정 기준은 FO 상태다: 한 상자에 걸린 FO 가 **전부** terminal(shipped/completed/canceled)
 * 일 때만 닫는다. 합배송으로 진행 중 FO 가 하나라도 섞여 있으면 살아있는 출고 지시다.
 *
 * 남기는 예약: 진행 중 FO 의 예약은 건드리지 않는다. 그게 예약의 정당한 역할
 * (주문 ~ 다음 sync-stock 사이의 oversell 홀드)이다.
 *
 * 멱등: 대상이 없으면 0건으로 끝난다. 같은 날 여러 번 돌려도 안전하다.
 *
 *   DRY_RUN=1 bash scripts/sellmate/run.sh live close-shipped-shipments .
 *   bash scripts/sellmate/run.sh live close-shipped-shipments .
 *
 * 환경변수:
 *   DATABASE_URL   core 논리 DB (run.sh 가 주입)
 *   DRY_RUN=1      대상만 세고 DB 미반영
 *   OUT_VARIANTS   영향 variant id 를 적을 파일 (기본 apps/core/tmp/closeout-variant-ids.txt)
 */
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const OUT_VARIANTS = process.env.OUT_VARIANTS || 'apps/core/tmp/closeout-variant-ids.txt';

// 종결 대상 상자. 라인이 없는 상자는 판단 근거가 없으므로 JOIN 으로 자연히 빠진다.
const CLOSEOUT_CTE = `
  SELECT s.id     AS shipment_id,
         CASE WHEN bool_and(fo.status = 'canceled') THEN 'canceled' ELSE 'shipped' END AS new_status
    FROM shipments s
    JOIN shipment_lines sl ON sl.shipment_id = s.id
    JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
    JOIN fulfillment_orders fo ON fo.id = foi.fulfillment_order_id
   WHERE s.status IN ('draft','planned','recovery_required')
   GROUP BY s.id
  HAVING bool_and(fo.status IN ('shipped','completed','canceled'))
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL 필요 (run.sh 로 실행하면 자동 주입)');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });

  try {
    const [before] = await sql.unsafe(`
      WITH closeout AS (${CLOSEOUT_CTE})
      SELECT (SELECT count(*) FROM closeout)::int AS shipments,
             count(*)::int                        AS reservations,
             coalesce(sum(r.quantity),0)::int     AS quantity,
             count(DISTINCT r.sku_id)::int        AS skus
        FROM stock_reservations r
        JOIN shipment_lines sl ON sl.id = r.shipment_line_id
       WHERE r.status = 'confirmed'
         AND sl.shipment_id IN (SELECT shipment_id FROM closeout)
    `);

    console.log(
      `📦 종결 대상 상자 ${before.shipments}개 | 해제될 예약 ${before.reservations}행 / ${before.quantity}개 / SKU ${before.skus}종`,
    );

    if (before.shipments === 0) {
      console.log('✅ 종결할 상자 없음 — 할 일 없다.');
      return;
    }

    if (DRY_RUN) {
      console.log('\n✅ DRY-RUN 종료 — DB 미반영.');
      return;
    }

    const variantIds = await sql.begin(async (trx) => {
      await trx.unsafe(`CREATE TEMP TABLE closeout ON COMMIT DROP AS ${CLOSEOUT_CTE}`);
      await trx.unsafe(`
        CREATE TEMP TABLE closeout_reservation ON COMMIT DROP AS
        SELECT r.id AS reservation_id, r.sku_id
          FROM stock_reservations r
          JOIN shipment_lines sl ON sl.id = r.shipment_line_id
         WHERE r.status = 'confirmed'
           AND sl.shipment_id IN (SELECT shipment_id FROM closeout)
      `);

      // 1. 상자 종결이 먼저다 (위 주석의 순서 이유)
      await trx.unsafe(`
        UPDATE shipments s
           SET status       = c.new_status::shipment_status,
               shipped_at   = CASE WHEN c.new_status = 'shipped' THEN coalesce(s.shipped_at, now()) ELSE s.shipped_at END,
               last_updated = now()
          FROM closeout c
         WHERE s.id = c.shipment_id
      `);

      // 2. 유령 예약 해제
      await trx.unsafe(`
        UPDATE stock_reservations r
           SET status = 'released',
               state_reason = 'closeout: fulfillment order already terminal',
               invalidated_at = now(),
               updated_at = now()
          FROM closeout_reservation cr
         WHERE r.id = cr.reservation_id
      `);

      // 3. 예약 수량 프로젝션 정리
      await trx.unsafe(`
        UPDATE shipment_lines sl SET reserved_qty = 0
          FROM closeout c
         WHERE sl.shipment_id = c.shipment_id AND sl.reserved_qty <> 0
      `);
      await trx.unsafe(`
        UPDATE fulfillment_order_items foi SET reserved_qty = 0, updated_at = now()
         WHERE foi.reserved_qty <> 0
           AND foi.id IN (SELECT sl.fulfillment_order_item_id FROM shipment_lines sl
                           WHERE sl.shipment_id IN (SELECT shipment_id FROM closeout))
      `);
      await trx.unsafe(`
        UPDATE fulfillment_orders fo SET total_reserved_qty = 0, updated_at = now()
         WHERE fo.total_reserved_qty <> 0
           AND fo.id IN (SELECT foi.fulfillment_order_id FROM shipment_lines sl
                           JOIN fulfillment_order_items foi ON foi.id = sl.fulfillment_order_item_id
                          WHERE sl.shipment_id IN (SELECT shipment_id FROM closeout))
      `);

      return trx.unsafe<{ variant_id: string }[]>(`
        SELECT DISTINCT pm.variant_id
          FROM closeout_reservation cr
          JOIN product_variant_sku_links l ON l.sku_id = cr.sku_id
          JOIN product_matchings pm ON pm.id = l.product_matching_id
      `);
    });

    const [after] = await sql`
      SELECT count(*)::int AS skus, coalesce(sum(v.on_hand_qty),0)::int AS on_hand
        FROM stock_summary_view v
        JOIN warehouses w ON w.id = v.warehouse_id AND w.is_sellable
       WHERE v.on_hand_qty > 0 AND v.available_qty <= 0
    `;

    const ids = variantIds.map((row) => row.variant_id);
    fs.mkdirSync(path.dirname(OUT_VARIANTS), { recursive: true });
    fs.writeFileSync(OUT_VARIANTS, ids.join('\n') + (ids.length ? '\n' : ''));

    console.log(`✅ 상자 ${before.shipments}개 종결 · 예약 ${before.reservations}행 해제`);
    console.log(`   재고가 예약에 막힌 SKU: ${after.skus}종 / ${after.on_hand}개 (진행 중 주문이 잡은 정상분)`);
    console.log(`   영향 variant ${ids.length}개 → ${OUT_VARIANTS}`);
    console.log(`\n★ 이어서 재계산해야 스토어프론트에 반영된다:`);
    console.log(`   VARIANT_IDS=$(paste -sd, ${OUT_VARIANTS}) bash scripts/sellmate/run.sh live recalc-sellable .`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error('❌ 실패:', error);
  process.exit(1);
});
