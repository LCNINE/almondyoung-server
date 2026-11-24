import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { inboundPendingQuantitySql } from '../../inventory/shared/availability/inbound-origin-availability';

export interface SkuStockBudget {
  /** 창고의 ON_HAND 합 */
  onHandQty: number;
  /** 배치를 시작하면 바로 배정할 수 있는 수량 */
  pickableQty: number;
  /** 입고했지만 아직 적치하지 않은 수량 */
  inboundPendingQty: number;
}

/**
 * pickable = ON_HAND − 배치 세션이 쥔 몫(SETTLED 제외, active·recovery_required) − 적치 전 입고.
 * 배치 시작의 배정과 같은 기준이다. 확정 예약은 빼지 않은 값이다. ON_HAND 행이 없는 상품은 결과에 없다.
 */
export async function loadSkuStockBudgets(
  trx: DbTx,
  warehouseId: string,
  requestedSkuIds: readonly string[],
): Promise<Map<string, SkuStockBudget>> {
  const skuIds = [...new Set(requestedSkuIds)];
  const budgets = new Map<string, SkuStockBudget>();
  if (skuIds.length === 0) return budgets;

  const onHand = await trx
    .select({
      skuId: wmsTables.stockLedgers.skuId,
      qty: sql<number>`sum(${wmsTables.stockLedgers.qty})::int`,
    })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        inArray(wmsTables.stockLedgers.skuId, skuIds),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    )
    .groupBy(wmsTables.stockLedgers.skuId);
  const controlled = await trx
    .select({
      skuId: wmsTables.batchInventorySessionBalances.skuId,
      qty: sql<number>`sum(${wmsTables.batchInventorySessionBalances.qty})::int`,
    })
    .from(wmsTables.batchInventorySessionBalances)
    .innerJoin(
      wmsTables.batchInventorySessions,
      eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionBalances.sessionId),
    )
    .innerJoin(
      wmsTables.locations,
      eq(wmsTables.locations.id, wmsTables.batchInventorySessionBalances.sourceLocationId),
    )
    .where(
      and(
        inArray(wmsTables.batchInventorySessionBalances.skuId, skuIds),
        eq(wmsTables.locations.warehouseId, warehouseId),
        ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    )
    .groupBy(wmsTables.batchInventorySessionBalances.skuId);
  const skuList = sql.join(
    skuIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const inbound = await trx.execute<{ sku_id: string; qty: number }>(sql`
    SELECT irl.sku_id, SUM(${inboundPendingQuantitySql})::int AS qty
      FROM inbound_receipt_lines irl
      JOIN inbound_receipts ir ON ir.id = irl.receipt_id
      JOIN locations origin ON origin.id = irl.origin_location_id
     WHERE ir.status = 'posted'
       AND ir.warehouse_id = ${warehouseId}
       AND origin.warehouse_id = ir.warehouse_id
       AND origin.is_system = true
       AND irl.sku_id IN (${skuList})
     GROUP BY irl.sku_id
  `);

  for (const row of onHand) {
    const qty = Number(row.qty);
    budgets.set(row.skuId, { onHandQty: qty, pickableQty: qty, inboundPendingQty: 0 });
  }
  for (const row of controlled) {
    const budget = budgets.get(row.skuId);
    if (budget) budget.pickableQty -= Number(row.qty);
  }
  for (const row of inbound) {
    const budget = budgets.get(row.sku_id);
    if (!budget) continue;
    budget.pickableQty -= Number(row.qty);
    budget.inboundPendingQty += Number(row.qty);
  }
  return budgets;
}
