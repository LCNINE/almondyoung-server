import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

export interface StockGiven {
  at: Date;
  /** 재고를 받은 상자에 담긴 주문 */
  orderNos: string[];
}

/** 상자마다 다른 주문을 우선할당하면서 재고를 내준 마지막 기록 */
export async function loadStockGiven(trx: DbTx, shipmentIds: readonly string[]): Promise<Map<string, StockGiven>> {
  if (shipmentIds.length === 0) return new Map();
  const giver = alias(wmsTables.shipmentOperationMembers, 'giver');
  const receiver = alias(wmsTables.shipmentOperationMembers, 'receiver');
  const rows = await trx
    .select({
      shipmentId: giver.shipmentId,
      operationId: wmsTables.shipmentOperations.id,
      at: wmsTables.shipmentOperations.createdAt,
      orderNo: sql<
        string | null
      >`COALESCE(${wmsTables.salesOrders.displayOrderNo}, ${wmsTables.salesOrders.channelOrderId})`,
    })
    .from(giver)
    .innerJoin(wmsTables.shipmentOperations, eq(wmsTables.shipmentOperations.id, giver.operationId))
    .innerJoin(receiver, and(eq(receiver.operationId, giver.operationId), eq(receiver.role, 'target')))
    .leftJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, receiver.shipmentId))
    .leftJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .leftJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .leftJoin(wmsTables.salesOrders, eq(wmsTables.salesOrders.id, wmsTables.fulfillmentOrders.salesOrderId))
    .where(
      and(
        inArray(giver.shipmentId, [...shipmentIds]),
        eq(giver.role, 'source'),
        eq(wmsTables.shipmentOperations.type, 'stock_priority'),
        eq(wmsTables.shipmentOperations.status, 'completed'),
      ),
    )
    .orderBy(desc(wmsTables.shipmentOperations.createdAt), desc(wmsTables.shipmentOperations.id));

  const latest = new Map<string, { operationId: string; at: Date; orderNos: Set<string> }>();
  for (const row of rows) {
    const current = latest.get(row.shipmentId);
    if (current && current.operationId !== row.operationId) continue;
    const entry = current ?? { operationId: row.operationId, at: row.at, orderNos: new Set<string>() };
    if (row.orderNo) entry.orderNos.add(row.orderNo);
    latest.set(row.shipmentId, entry);
  }
  return new Map([...latest].map(([id, entry]) => [id, { at: entry.at, orderNos: [...entry.orderNos] }]));
}
