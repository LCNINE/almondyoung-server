import { Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { asc, eq, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { classifyOperationReason } from '../shipment/shipment-operation-reasons';

export interface OrderShipmentOperationItem {
  operationId: string;
  type: string;
  status: string;
  shipmentIds: string[];
  fulfillmentOrderId: string;
  otherOrdersInBox: boolean;
  reasonCode: string | null;
  reason: string;
  requestChannel: string | null;
  note: string | null;
  operatorId: string;
  createdAt: string;
  completedAt: string | null;
}

export interface OrderShipmentOperations {
  salesOrderId: string;
  items: OrderShipmentOperationItem[];
}

/**
 * 주문 이력용 상자 작업 목록. 지금 이 주문 상품이 든 상자(출고·취소 포함)의 작업을 시각 오름차순으로,
 * 작업 하나당 한 줄로 돌려준다. 분할처럼 상자가 둘인 작업은 shipmentIds 에 함께 담긴다.
 */
@Injectable()
export class OrderShipmentOperationsReader {
  constructor(@InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>) {}

  list(salesOrderId: string, tx?: DbTx): Promise<OrderShipmentOperations> {
    return this.dbService.run(async (trx) => {
      const { shipmentLines, fulfillmentOrderItems, fulfillmentOrders, shipmentOperations, shipmentOperationMembers } =
        wmsTables;

      const boxes = trx.$with('boxes').as(
        trx
          .select({
            shipmentId: shipmentLines.shipmentId,
            fulfillmentOrderId:
              sql<string>`(array_agg(${fulfillmentOrders.id} order by ${fulfillmentOrders.id}))[1]`.as(
                'fulfillment_order_id',
              ),
          })
          .from(shipmentLines)
          .innerJoin(fulfillmentOrderItems, eq(fulfillmentOrderItems.id, shipmentLines.fulfillmentOrderItemId))
          .innerJoin(fulfillmentOrders, eq(fulfillmentOrders.id, fulfillmentOrderItems.fulfillmentOrderId))
          .where(eq(fulfillmentOrders.salesOrderId, salesOrderId))
          .groupBy(shipmentLines.shipmentId),
      );

      const rows = await trx
        .with(boxes)
        .select({
          operationId: shipmentOperations.id,
          type: shipmentOperations.type,
          status: shipmentOperations.status,
          operatorId: shipmentOperations.operatorId,
          reason: shipmentOperations.reason,
          storedReasonCode: shipmentOperations.reasonCode,
          requestChannel: shipmentOperations.requestChannel,
          note: shipmentOperations.note,
          createdAt: shipmentOperations.createdAt,
          completedAt: shipmentOperations.completedAt,
          shipmentIds: sql<string[]>`array_agg(distinct ${shipmentOperationMembers.shipmentId})`,
          fulfillmentOrderId: sql<string>`(array_agg(${boxes.fulfillmentOrderId} order by ${boxes.fulfillmentOrderId}))[1]`,
          otherOrdersInBox: sql<boolean>`bool_or(exists (
            select 1
            from ${shipmentLines} sl
            join ${fulfillmentOrderItems} foi on foi.id = sl.fulfillment_order_item_id
            join ${fulfillmentOrders} fo on fo.id = foi.fulfillment_order_id
            where sl.shipment_id = ${shipmentOperationMembers.shipmentId}
              and fo.sales_order_id <> ${salesOrderId}
          ))`,
        })
        .from(shipmentOperationMembers)
        .innerJoin(boxes, eq(boxes.shipmentId, shipmentOperationMembers.shipmentId))
        .innerJoin(shipmentOperations, eq(shipmentOperations.id, shipmentOperationMembers.operationId))
        .groupBy(shipmentOperations.id)
        .orderBy(asc(shipmentOperations.createdAt), asc(shipmentOperations.id));

      return {
        salesOrderId,
        items: rows.map((row) => ({
          operationId: row.operationId,
          type: row.type,
          status: row.status,
          shipmentIds: row.shipmentIds,
          fulfillmentOrderId: row.fulfillmentOrderId,
          otherOrdersInBox: row.otherOrdersInBox,
          reasonCode: classifyOperationReason(row.type, { reasonCode: row.storedReasonCode, reason: row.reason }),
          reason: row.reason,
          requestChannel: row.requestChannel,
          note: row.note,
          operatorId: row.operatorId,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt ? row.completedAt.toISOString() : null,
        })),
      };
    }, tx);
  }
}
