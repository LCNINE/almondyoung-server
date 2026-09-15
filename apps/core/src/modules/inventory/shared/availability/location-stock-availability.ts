import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';
import { inboundPendingQuantitySql, inboundReceiptInvalidSql } from './inbound-origin-availability';

interface LocationStockRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  stockState: string;
  quantity: number;
  pendingQty: number | string;
  controlledQty: number | string;
  invalidReceipt: boolean;
}

/**
 * Location display reads ledger, pending receipts and custody in one statement snapshot.
 * Aggregate each protection before joining to avoid multiplying quantities across receipts/sessions.
 * NULL receipt origins invalidate every source for that SKU/warehouse, as in the command guard.
 */
export async function readLocationStockAvailability(tx: DbTx, locationId: string, warehouseId: string) {
  const rows = (await tx.execute(sql`
    WITH location_stock AS (
      SELECT sl.sku_id, sl.stock_state, sl.qty
      FROM stock_ledgers sl
      WHERE sl.location_id = ${locationId} AND sl.warehouse_id = ${warehouseId}
    ), pending AS (
      SELECT irl.sku_id,
        COALESCE(SUM(${inboundPendingQuantitySql})
          FILTER (WHERE origin.warehouse_id = ir.warehouse_id AND origin.is_system = true), 0) AS qty,
        BOOL_OR(${inboundReceiptInvalidSql}) AS invalid
      FROM inbound_receipt_lines irl
      JOIN inbound_receipts ir ON ir.id = irl.receipt_id
      LEFT JOIN locations origin ON origin.id = irl.origin_location_id
      WHERE ir.status = 'posted' AND ir.warehouse_id = ${warehouseId}
        AND (irl.origin_location_id = ${locationId} OR irl.origin_location_id IS NULL)
        AND irl.sku_id IN (SELECT sku_id FROM location_stock)
      GROUP BY irl.sku_id
    ), custody AS (
      SELECT b.sku_id, SUM(b.qty) AS qty
      FROM batch_inventory_session_balances b
      JOIN batch_inventory_sessions s ON s.id = b.session_id
      WHERE b.source_location_id = ${locationId} AND b.custody_type <> 'SETTLED'
        AND s.status IN ('active', 'recovery_required')
        AND b.sku_id IN (SELECT sku_id FROM location_stock)
      GROUP BY b.sku_id
    )
    SELECT ls.sku_id AS "skuId", sku.code AS "skuCode", sku.name AS "skuName",
      ls.stock_state AS "stockState", ls.qty AS quantity,
      COALESCE(p.qty, 0) AS "pendingQty", COALESCE(c.qty, 0) AS "controlledQty",
      COALESCE(p.invalid, false) AS "invalidReceipt"
    FROM location_stock ls
    JOIN skus sku ON sku.id = ls.sku_id
    LEFT JOIN pending p ON p.sku_id = ls.sku_id
    LEFT JOIN custody c ON c.sku_id = ls.sku_id
    ORDER BY sku.code, ls.stock_state
  `)) as unknown as LocationStockRow[];

  return rows.map(({ pendingQty, controlledQty, invalidReceipt, ...item }) => {
    if (item.stockState !== 'ON_HAND') return { ...item, inboundPendingQty: 0, generallyMovableQty: 0 };
    const inboundPendingQty = Number(pendingQty);
    const batchControlledQty = Number(controlledQty);
    if (invalidReceipt || item.quantity < inboundPendingQty + batchControlledQty) {
      throw new ConflictException({ code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' });
    }
    return {
      ...item,
      inboundPendingQty,
      generallyMovableQty: Math.max(0, item.quantity - inboundPendingQty - batchControlledQty),
    };
  });
}
