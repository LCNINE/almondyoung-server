import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';

/**
 * 판매주문의 교환 줄(K8 PR11)과 그 줄로 열린 교환 상자 — FOI·상자·상자 줄·확정 예약 합. 교환 상자 열기를 부르는 스펙들이 같이 쓴다.
 */
export async function exchangeBoxOf(tx: DbTx, salesOrderId: string) {
  const lines = await tx
    .select()
    .from(wmsTables.salesOrderLines)
    .where(
      and(
        eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId),
        isNotNull(wmsTables.salesOrderLines.exchangeReturnLineId),
      ),
    );
  const items =
    lines.length === 0
      ? []
      : await tx
          .select()
          .from(wmsTables.fulfillmentOrderItems)
          .where(
            inArray(
              wmsTables.fulfillmentOrderItems.salesOrderLineId,
              lines.map((line) => line.id),
            ),
          );
  const shipmentLines =
    items.length === 0
      ? []
      : await tx
          .select()
          .from(wmsTables.shipmentLines)
          .where(
            inArray(
              wmsTables.shipmentLines.fulfillmentOrderItemId,
              items.map((item) => item.id),
            ),
          );
  const shipmentIds = [...new Set(shipmentLines.map((line) => line.shipmentId))];
  const shipments =
    shipmentIds.length === 0
      ? []
      : await tx.select().from(wmsTables.shipments).where(inArray(wmsTables.shipments.id, shipmentIds));
  const reservations =
    shipmentLines.length === 0
      ? []
      : await tx
          .select()
          .from(wmsTables.stockReservations)
          .where(
            and(
              inArray(
                wmsTables.stockReservations.shipmentLineId,
                shipmentLines.map((line) => line.id),
              ),
              eq(wmsTables.stockReservations.status, 'confirmed'),
            ),
          );
  return {
    lines,
    items,
    shipmentLines,
    shipments,
    reserved: reservations.reduce((sum, row) => sum + row.quantity, 0),
  };
}
