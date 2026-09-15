import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';

export interface InboundOriginKey {
  skuId: string;
  warehouseId: string;
  sourceLocationId: string;
}

export interface InboundOriginAvailability {
  onHandQty: number;
  pendingQty: number;
  invalidReceipt: boolean;
}

interface InboundOriginAvailabilityRow {
  on_hand_qty: number | string;
  pending_qty: number | string;
  invalid_receipt: boolean;
}

/**
 * 한 SKU·창고·원위치의 ON_HAND와 미처리 입고를 같은 statement snapshot에서 읽는다.
 * 일반 선반의 입고는 원장에는 남지만 입고 대기에는 포함하지 않는다.
 */
export async function readInboundOriginAvailability(
  tx: DbTx,
  input: InboundOriginKey,
): Promise<InboundOriginAvailability> {
  const rows = (await tx.execute(sql`
    SELECT
      COALESCE((
        SELECT SUM(sl.qty)
          FROM stock_ledgers sl
         WHERE sl.sku_id = ${input.skuId}
           AND sl.warehouse_id = ${input.warehouseId}
           AND sl.location_id = ${input.sourceLocationId}
           AND sl.stock_state = 'ON_HAND'
      ), 0) AS on_hand_qty,
      COALESCE((
        SELECT SUM(
          irl.quantity
          - irl.putaway_from_origin_qty
          - irl.returned_qty
          - irl.canceled_qty
        ) FILTER (
          WHERE origin.warehouse_id = ir.warehouse_id
            AND origin.is_system = true
        )
          FROM inbound_receipt_lines irl
          JOIN inbound_receipts ir ON ir.id = irl.receipt_id
          LEFT JOIN locations origin ON origin.id = irl.origin_location_id
         WHERE ir.status = 'posted'
           AND ir.warehouse_id = ${input.warehouseId}
           AND irl.sku_id = ${input.skuId}
           AND (
             irl.origin_location_id = ${input.sourceLocationId}
             OR irl.origin_location_id IS NULL
           )
      ), 0) AS pending_qty,
      COALESCE((
        SELECT BOOL_OR(
          irl.quantity <= 0
          OR irl.putaway_from_origin_qty < 0
          OR irl.returned_qty < 0
          OR irl.canceled_qty < 0
          OR irl.putaway_from_origin_qty
            + irl.returned_qty
            + irl.canceled_qty > irl.quantity
          OR origin.id IS NULL
          OR origin.warehouse_id <> ir.warehouse_id
        )
          FROM inbound_receipt_lines irl
          JOIN inbound_receipts ir ON ir.id = irl.receipt_id
          LEFT JOIN locations origin ON origin.id = irl.origin_location_id
         WHERE ir.status = 'posted'
           AND ir.warehouse_id = ${input.warehouseId}
           AND irl.sku_id = ${input.skuId}
           AND (
             irl.origin_location_id = ${input.sourceLocationId}
             OR irl.origin_location_id IS NULL
           )
      ), false) AS invalid_receipt
  `)) as unknown as InboundOriginAvailabilityRow[];

  const row = rows[0];
  return {
    onHandQty: Number(row?.on_hand_qty ?? 0),
    pendingQty: Number(row?.pending_qty ?? 0),
    invalidReceipt: row?.invalid_receipt ?? false,
  };
}

/**
 * 호출자는 이 grain의 stock availability lock을 보유해야 한다. 이 함수는 입고
 * 회차나 라인을 잠그지 않고, 남은 입고 대기를 침범하는 ON_HAND 감소만 거절한다.
 */
export async function assertInboundOriginRemovalAllowed(
  tx: DbTx,
  input: InboundOriginKey & { quantity: number },
): Promise<void> {
  const current = await readInboundOriginAvailability(tx, input);
  if (current.invalidReceipt || current.onHandQty < current.pendingQty)
    throw new ConflictException({ code: 'INBOUND_ORIGIN_STOCK_INCONSISTENT' });
  if (current.onHandQty - input.quantity < current.pendingQty)
    throw new ConflictException({ code: 'INBOUND_ORIGIN_STOCK_PROTECTED' });
}
