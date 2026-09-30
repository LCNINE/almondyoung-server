import { and, asc, eq, inArray, isNotNull, notInArray, or } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';

/**
 * 현장이 부르는 번호로 박스를 찾는다 — 주문번호(표시 번호 `display_order_no` 또는 채널 주문 id)나 활성 송장 번호.
 * 송장 번호는 하이픈을 떼고도 맞춘다(종이의 4-4-4 표기). 잠그지 않는다 — 결과는 안내용이고 합류가 다시 잠가 판정한다.
 */
export async function findShipmentIdsByCode(trx: DbTx, warehouseId: string, code: string): Promise<string[]> {
  const trimmed = code.trim();
  const trackingCodes = [...new Set([trimmed, trimmed.replace(/-/g, '')])];
  const byOrder = trx
    .select({ id: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .innerJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
    .where(or(eq(wmsTables.salesOrders.displayOrderNo, trimmed), eq(wmsTables.salesOrders.channelOrderId, trimmed)));
  const byTracking = trx
    .select({ id: wmsTables.waybills.shipmentId })
    .from(wmsTables.waybills)
    .where(
      and(
        isNotNull(wmsTables.waybills.shipmentId),
        inArray(wmsTables.waybills.trackingNo, trackingCodes),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    );
  const rows = await trx
    .select({ id: wmsTables.shipments.id })
    .from(wmsTables.shipments)
    .where(
      and(
        eq(wmsTables.shipments.warehouseId, warehouseId),
        or(inArray(wmsTables.shipments.id, byOrder), inArray(wmsTables.shipments.id, byTracking)),
      ),
    )
    .orderBy(asc(wmsTables.shipments.createdAt), asc(wmsTables.shipments.id))
    .limit(20);
  return rows.map((row) => row.id);
}
