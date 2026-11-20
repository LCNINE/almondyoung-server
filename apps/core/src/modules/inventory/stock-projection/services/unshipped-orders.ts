import type { shipments } from '../../schema/inventory.schema';
import { dayDiff, kstDateOf } from '../../replenishment/demand/calendar';
import { UnshippedOrderDto, UnshippedOrderProgress } from '../dto/unshipped-orders.dto';

export interface UnshippedOrderRow extends Omit<UnshippedOrderDto, 'orderedAt' | 'delayDays' | 'canShip' | 'progress'> {
  orderDate: Date | null;
  createdAt: Date;
  shipmentStatus: typeof shipments.$inferSelect.status | null;
  shipmentQuantity: number | null;
  inspectedQuantity: number | null;
}

function progressOf(rows: UnshippedOrderRow[]): UnshippedOrderProgress {
  const active = rows.filter(
    (row) =>
      row.shipmentStatus === 'draft' || row.shipmentStatus === 'planned' || row.shipmentStatus === 'recovery_required',
  );

  if (active.some((row) => row.shipmentStatus === 'recovery_required')) return 'recovery_required';

  const boxed = active.reduce((sum, row) => sum + (row.shipmentQuantity ?? 0), 0);

  if (boxed < rows[0].remainingQuantity) return 'not_boxed';

  const inspected = active.reduce((sum, row) => sum + (row.inspectedQuantity ?? 0), 0);

  if (inspected === 0) return 'waiting';

  return inspected >= boxed ? 'inspected' : 'inspecting';
}

/** SQL의 날짜·FOI 정렬을 유지하면서 분할 상자들을 FOI 한 행으로 접는다. */
export function unshippedOrders(rows: UnshippedOrderRow[], now: Date): UnshippedOrderDto[] {
  const byItem = new Map<string, UnshippedOrderRow[]>();

  for (const row of rows) {
    const group = byItem.get(row.fulfillmentOrderItemId);

    if (group) group.push(row);
    else byItem.set(row.fulfillmentOrderItemId, [row]);
  }

  const today = kstDateOf(now);

  return [...byItem.values()].map((group) => {
    const row = group[0];
    const orderedAt = row.orderDate ?? row.createdAt;

    return {
      fulfillmentOrderItemId: row.fulfillmentOrderItemId,
      salesOrderId: row.salesOrderId,
      orderNo: row.orderNo,
      channelName: row.channelName,
      orderedAt: orderedAt.toISOString(),
      delayDays: Math.max(dayDiff(kstDateOf(orderedAt), today), 0),
      customerName: row.customerName,
      remainingQuantity: row.remainingQuantity,
      reservedQuantity: row.reservedQuantity,
      canShip: row.reservedQuantity >= row.remainingQuantity,
      progress: progressOf(group),
    };
  });
}
