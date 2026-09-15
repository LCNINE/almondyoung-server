import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { SQL, sql } from 'drizzle-orm';
import { DbTx, wmsSchema } from '../../schema/inventory.schema';
import {
  inboundPendingQuantitySql,
  inboundReceiptInvalidSql,
} from '../../shared/availability/inbound-origin-availability';
import { isTodaySeoul } from '../../shared/services/time.util';
import { ReceiptLineState } from '../dto/inbound-receipt-state.dto';
import { receiptActionPolicy, ReceiptPolicyFacts } from './inbound-receipt-policy';

export interface ReceiptFactsRow extends Omit<
  ReceiptLineState,
  'canCancel' | 'cancelBlockReason' | 'canPutaway' | 'putawayBlockReason'
> {
  originValid: boolean;
  eventExists: boolean;
  isStagingOrigin: boolean;
  invalidReceipt: boolean;
  onHandQty: number | string;
  bucketPendingQty: number | string;
  custodyQty: number | string;
  receivedAt: Date | string;
  cursorAt: string;
  eventId: string | null;
  memo: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Shared statement-snapshot projection. Select/page lines first, then aggregate once per
 * distinct grain, including ALL competing receipt claims (not only the selected page).
 * Null/invalid origins and absent ledgers stay visible; these reads never mutate or lock.
 */
export function receiptFactsCtes(where: SQL, page: SQL = sql``): SQL {
  return sql`
    selected AS (
      SELECT irl.*, ir.warehouse_id, ir.status AS receipt_status, ir.occurred_at
      FROM inbound_receipt_lines irl JOIN inbound_receipts ir ON ir.id = irl.receipt_id
      LEFT JOIN locations origin ON origin.id = irl.origin_location_id
      WHERE ${where} ${page}
    ), grains AS (
      SELECT DISTINCT sku_id, warehouse_id, origin_location_id FROM selected
    ), pending AS (
      SELECT g.sku_id, g.warehouse_id, g.origin_location_id,
        COALESCE(SUM(${inboundPendingQuantitySql}) FILTER (
          WHERE origin.warehouse_id = ir.warehouse_id AND origin.is_system = true
        ), 0) AS qty, BOOL_OR(${inboundReceiptInvalidSql}) AS invalid
      FROM grains g
      JOIN inbound_receipts ir ON ir.warehouse_id = g.warehouse_id AND ir.status = 'posted'
      JOIN inbound_receipt_lines irl ON irl.receipt_id = ir.id AND irl.sku_id = g.sku_id
        AND (irl.origin_location_id = g.origin_location_id OR irl.origin_location_id IS NULL)
      LEFT JOIN locations origin ON origin.id = irl.origin_location_id
      GROUP BY g.sku_id, g.warehouse_id, g.origin_location_id
    ), custody AS (
      SELECT g.sku_id, g.warehouse_id, g.origin_location_id, SUM(b.qty) AS qty
      FROM grains g
      JOIN batch_inventory_session_balances b ON b.sku_id = g.sku_id AND b.source_location_id = g.origin_location_id
      JOIN batch_inventory_sessions s ON s.id = b.session_id
      WHERE b.custody_type <> 'SETTLED' AND s.status IN ('active', 'recovery_required')
      GROUP BY g.sku_id, g.warehouse_id, g.origin_location_id
    ), facts AS (
      SELECT irl.id AS "lineId", irl.receipt_id AS "receiptId", irl.warehouse_id AS "warehouseId",
        irl.source, irl.receipt_status AS "receiptStatus", irl.sku_id AS "skuId",
        sku.code AS "skuCode", sku.name AS "skuName", irl.origin_location_id AS "originLocationId",
        origin.code AS "originLocationCode", irl.quantity,
        irl.putaway_from_origin_qty AS "putawayFromOriginQty", irl.canceled_qty AS "canceledQty",
        irl.returned_qty AS "returnedQty", ${inboundPendingQuantitySql} AS "pendingQty",
        COALESCE(origin.warehouse_id = irl.warehouse_id, false) AS "originValid",
        COALESCE(origin.is_system, false) AS "isStagingOrigin",
        (event.id IS NOT NULL) AS "eventExists", COALESCE(p.invalid, false) AS "invalidReceipt",
        COALESCE(sl.qty, 0) AS "onHandQty", COALESCE(p.qty, 0) AS "bucketPendingQty",
        COALESCE(c.qty, 0) AS "custodyQty", irl.occurred_at AS "receivedAt",
        to_char(irl.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorAt",
        irl.event_id AS "eventId", irl.memo, irl.created_at AS "createdAt", irl.updated_at AS "updatedAt"
      FROM selected irl
      JOIN skus sku ON sku.id = irl.sku_id
      LEFT JOIN locations origin ON origin.id = irl.origin_location_id
      LEFT JOIN stock_events event ON event.id = irl.event_id AND event.transition_type = 'RECEIVE'
      LEFT JOIN stock_ledgers sl ON sl.sku_id = irl.sku_id AND sl.warehouse_id = irl.warehouse_id
        AND sl.location_id = irl.origin_location_id AND sl.stock_state = 'ON_HAND'
      LEFT JOIN pending p ON p.sku_id = irl.sku_id AND p.warehouse_id = irl.warehouse_id
        AND p.origin_location_id IS NOT DISTINCT FROM irl.origin_location_id
      LEFT JOIN custody c ON c.sku_id = irl.sku_id AND c.warehouse_id = irl.warehouse_id
        AND c.origin_location_id = irl.origin_location_id
    )`;
}

export function receiptStateFromFacts(row: ReceiptFactsRow, now = new Date()): ReceiptLineState {
  const policy = receiptActionPolicy({
    ...row,
    onHandQty: Number(row.onHandQty),
    bucketPendingQty: Number(row.bucketPendingQty),
    custodyQty: Number(row.custodyQty),
    isToday: isTodaySeoul(new Date(row.receivedAt), now),
  } satisfies ReceiptPolicyFacts);
  return {
    lineId: row.lineId,
    receiptId: row.receiptId,
    warehouseId: row.warehouseId,
    source: row.source,
    receiptStatus: row.receiptStatus,
    skuId: row.skuId,
    skuCode: row.skuCode,
    skuName: row.skuName,
    originLocationId: row.originLocationId,
    originLocationCode: row.originLocationCode,
    quantity: row.quantity,
    putawayFromOriginQty: row.putawayFromOriginQty,
    canceledQty: row.canceledQty,
    returnedQty: row.returnedQty,
    pendingQty: Number(row.pendingQty),
    ...policy,
  };
}

@Injectable()
export class InboundReceiptStateReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  async getLineState(params: { lineId: string; warehouseId: string }, tx?: DbTx): Promise<ReceiptLineState> {
    return this.dbService.run(async (trx) => {
      const rows = (await trx.execute(
        sql`WITH ${receiptFactsCtes(sql`irl.id = ${params.lineId}::uuid`)} SELECT * FROM facts`,
      )) as unknown as ReceiptFactsRow[];
      const row = rows[0];
      if (!row) throw new NotFoundException('inbound line not found');
      if (row.warehouseId.toLowerCase() !== params.warehouseId.toLowerCase())
        throw new ForbiddenException('warehouse mismatch');
      return receiptStateFromFacts(row);
    }, tx);
  }
}
