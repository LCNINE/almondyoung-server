import { randomUUID } from 'crypto';
import { deriveCustOrdNo } from '../../fulfillment/waybill/cust-ord-no';
import { WAYBILL } from '../../fulfillment/waybill/waybill.constants';
import type { wmsTables } from '../../inventory/schema/inventory.schema';

export type CustomerReturnPickupStatus = 'pending' | 'reserved' | 'failed' | 'void' | 'cancel_pending' | 'cancelled';

export type PickupRow = typeof wmsTables.customerReturnPickups.$inferSelect;

/** 한 반품에 동시에 하나만 있을 수 있는 상태 — `uq_customer_return_pickups_active` 부분 인덱스와 같다. */
export const ACTIVE_PICKUP_STATUSES = [
  'pending',
  'reserved',
  'cancel_pending',
] as const satisfies readonly CustomerReturnPickupStatus[];

/**
 * 새 회수 행. id 를 앱이 정하는 이유: custOrdNo 가 id 에서 파생되므로 삽입 전에 번호가 필요하다.
 * 다시 접수는 새 행 = 새 번호다 — 한진은 한 번 취소한 주문번호를 다시 받지 않는다.
 */
export function newPickupRow(customerReturnId: string, createdBy: string | null) {
  const id = randomUUID();
  return {
    id,
    customerReturnId,
    carrier: 'HANJIN' as const,
    custOrdNo: deriveCustOrdNo(id, WAYBILL.RETURN_CUST_ORD_NO_PREFIX),
    createdBy,
  };
}
