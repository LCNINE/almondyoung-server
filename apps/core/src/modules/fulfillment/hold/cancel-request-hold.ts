import { and, eq, inArray } from 'drizzle-orm';
import { ConflictError } from '@app/shared';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/** 관문 셋의 거절 사유(스펙 §5.3). 메시지 접두사로 싣는다 — 배치 시작·합류는 이 접두사로 차단 사유를 가른다. */
export const CANCEL_REQUESTED = 'CANCEL_REQUESTED';

/**
 * 열린 채널 취소 요청(`sales_order_amendments.status = 'requested'`)이 걸린 판매주문을 담은 박스 (#1016 35번, ADR-0042 원칙 2).
 * 요청 행의 존재가 곧 «출고 보류»다 — 따로 풀 일이 없다. 합포장 박스는 한 주문만 걸려도 통째로 멈춘다.
 * 잠그지 않는다: 부르는 쪽이 박스 행을 먼저 잠근다(요청 트랜잭션도 같은 행을 잠가 직렬화된다).
 */
export async function heldShipmentIds(tx: DbTx, shipmentIds: readonly string[]): Promise<Set<string>> {
  if (shipmentIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .innerJoin(
      wmsTables.salesOrderAmendments,
      and(
        eq(wmsTables.salesOrderAmendments.salesOrderId, wmsTables.fulfillmentOrders.salesOrderId),
        eq(wmsTables.salesOrderAmendments.status, 'requested'),
      ),
    )
    .where(inArray(wmsTables.shipmentLines.shipmentId, [...shipmentIds]));
  return new Set(rows.map((row) => row.shipmentId));
}

export async function assertShipmentNotHeld(tx: DbTx, shipmentId: string): Promise<void> {
  if ((await heldShipmentIds(tx, [shipmentId])).size > 0) {
    throw new ConflictError(`${CANCEL_REQUESTED}: 취소 처리 중인 주문이 있습니다 (shipment ${shipmentId})`);
  }
}

export function isCancelRequestedError(error: unknown): boolean {
  return error instanceof ConflictError && error.message.startsWith(CANCEL_REQUESTED);
}
