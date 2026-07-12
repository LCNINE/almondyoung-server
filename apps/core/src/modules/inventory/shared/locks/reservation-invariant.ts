import { ConflictException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';

/**
 * 창고 grain ON_HAND 원장 합·confirmed 예약 합 (단일 statement 원자 읽기 — torn read 방지, 작업 10 I-1).
 * store·command·stocktaking 공용 leaf — core↔store 순환을 피하려고 InventoryCommandService 에서 추출.
 */
export async function readWarehouseReservationBalance(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
): Promise<{ onHand: number; reserved: number }> {
  const rows = (await trx.execute(sql`
    SELECT
      COALESCE((SELECT SUM(qty) FROM stock_ledgers
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND stock_state = 'ON_HAND'), 0) AS on_hand,
      COALESCE((SELECT SUM(quantity) FROM stock_reservations
                 WHERE sku_id = ${skuId} AND warehouse_id = ${warehouseId} AND status = 'confirmed'), 0) AS reserved
  `)) as unknown as { on_hand: number | string; reserved: number | string }[];
  return { onHand: Number(rows[0]?.on_hand ?? 0), reserved: Number(rows[0]?.reserved ?? 0) };
}

/** 차감/이동 후 창고 ON_HAND 합이 confirmed 예약 합보다 적어지면 true. */
export function violatesReservationInvariant(onHandSum: number, reservedSum: number, removingQty: number): boolean {
  return onHandSum - removingQty < reservedSum;
}

/** 락 획득 후 호출. 창고 합산 예약 불변식 위반 시 409(ConflictException). */
export async function assertReservationInvariant(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
  removingQty: number,
): Promise<void> {
  const { onHand, reserved } = await readWarehouseReservationBalance(trx, skuId, warehouseId);
  if (violatesReservationInvariant(onHand, reserved, removingQty)) {
    throw new ConflictException(
      `예약된 재고는 감소/이동할 수 없습니다. 창고 ON_HAND ${onHand} − ${removingQty} < 예약 ${reserved}`,
    );
  }
}
