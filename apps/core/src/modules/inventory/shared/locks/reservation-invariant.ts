import { ConflictException } from '@nestjs/common';
import { DbTx } from '../../schema/inventory.schema';
import { readWarehouseAvailability, violatesAvailability } from '../availability/warehouse-availability';

/**
 * 예약 불변식 — 가용재고 정의는 availability 모듈이 소유한다. 여기는 그 정의를
 * "ON_HAND 를 뺄 수 있는가"라는 질문으로 감싸는 얇은 층이다.
 *
 * export 이름은 호출처 5곳(stock-event.store · inventory-command · stocktaking)을
 * 건드리지 않으려고 유지한다.
 */

/** 창고 grain ON_HAND 원장 합·confirmed 예약 합 (단일 statement 원자 읽기 — torn read 방지). */
export async function readWarehouseReservationBalance(
  trx: DbTx,
  skuId: string,
  warehouseId: string,
): Promise<{ onHand: number; reserved: number }> {
  const { onHand, reserved } = await readWarehouseAvailability(trx, skuId, warehouseId);
  return { onHand, reserved };
}

/** 차감/이동 후 창고 ON_HAND 합이 confirmed 예약 합보다 적어지면 true. */
export function violatesReservationInvariant(onHandSum: number, reservedSum: number, removingQty: number): boolean {
  return violatesAvailability(onHandSum, reservedSum, removingQty);
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
