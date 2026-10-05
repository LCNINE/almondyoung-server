import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { SalesOrdersService } from '../services/sales-orders.service';
import { toShippingAddress } from './channel-order-diff';
import type { EffectiveSalesOrder } from './channel-order-change.types';

const FINISHED_SHIPMENT_STATUSES = ['shipped', 'in_transit', 'delivered', 'canceled', 'superseded', 'failed'] as const;
export const FINISHED_FULFILLMENT_STATUSES = ['shipped', 'completed', 'canceled'] as const;
/** 공급처에 이미 넘어간 직배. `pending` 은 아직 넘기지 않았고, 넘길 때 판매주문 주소를 읽는다. */
const HANDED_OFF_DIRECT_SHIP_STATUSES = ['forwarded', 'completed'] as const;

@Injectable()
export class ChannelOrderChangeReader {
  constructor(private readonly salesOrders: SalesOrdersService) {}

  /** 판매주문을 FOR UPDATE 로 잡고 «지금 유효한» 모양으로 읽는다(스펙 §6). 없으면 null. */
  async lockEffectiveOrder(salesOrderId: string, tx: DbTx): Promise<EffectiveSalesOrder | null> {
    const [order] = await tx
      .select({
        id: wmsTables.salesOrders.id,
        status: wmsTables.salesOrders.status,
        shippingAddress: wmsTables.salesOrders.shippingAddress,
      })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .for('update');
    if (!order) return null;
    const lines = await tx
      .select({
        id: wmsTables.salesOrderLines.id,
        channelOrderItemId: wmsTables.salesOrderLines.channelOrderItemId,
        channelProductId: wmsTables.salesOrderLines.channelProductId,
        quantity: wmsTables.salesOrderLines.quantity,
        unitPrice: wmsTables.salesOrderLines.unitPrice,
      })
      .from(wmsTables.salesOrderLines)
      .where(eq(wmsTables.salesOrderLines.salesOrderId, salesOrderId))
      .orderBy(asc(wmsTables.salesOrderLines.id));
    const cancelled = await this.salesOrders.getCancelledQuantityByLine(salesOrderId, tx);
    return {
      id: order.id,
      status: order.status,
      shippingAddress: toShippingAddress(order.shippingAddress),
      lines: lines.map((line) => ({
        id: line.id,
        channelOrderItemId: line.channelOrderItemId,
        channelProductId: line.channelProductId,
        effectiveQuantity: Math.max(0, line.quantity - (cancelled.get(line.id) ?? 0)),
        unitPrice: line.unitPrice,
      })),
    };
  }

  /** 아직 떠나지 않은 박스(id 순 — 잠금 순서). */
  async remainingShipmentIds(salesOrderId: string, tx: DbTx): Promise<string[]> {
    const rows = await tx
      .selectDistinct({ id: wmsTables.shipments.id })
      .from(wmsTables.shipments)
      .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.shipmentId, wmsTables.shipments.id))
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .innerJoin(
        wmsTables.fulfillmentOrders,
        eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
      )
      .where(
        and(
          eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId),
          notInArray(wmsTables.shipments.status, [...FINISHED_SHIPMENT_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.shipments.id));
    return rows.map((row) => row.id);
  }

  /** 공급처에 이미 넘어간 직배가 있는가 — 주소를 바꿔도 따라가지 못한다. */
  async hasDropShipInProgress(salesOrderId: string, tx: DbTx): Promise<boolean> {
    const [row] = await tx
      .select({ id: wmsTables.fulfillmentOrders.id })
      .from(wmsTables.fulfillmentOrders)
      .where(
        and(
          eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId),
          eq(wmsTables.fulfillmentOrders.fulfillmentMode, 'drop_ship'),
          inArray(wmsTables.fulfillmentOrders.directShipStatus, [...HANDED_OFF_DIRECT_SHIP_STATUSES]),
          notInArray(wmsTables.fulfillmentOrders.status, [...FINISHED_FULFILLMENT_STATUSES]),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  /** 이 취소가 박스 쪽에서 대기(CANCEL_REPLAN_PENDING·이탈 대기)로 끝났는가. */
  async cancellationLeftPendingShipment(salesOrderId: string, sourceEventId: string, tx: DbTx): Promise<boolean> {
    const rows = await tx
      .select({ effects: wmsTables.salesOrderCancellations.effects })
      .from(wmsTables.salesOrderCancellations)
      .where(
        and(
          eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          sql`${wmsTables.salesOrderCancellations.metadata}->>'sourceEventId' = ${sourceEventId}`,
        ),
      );
    return rows.some((row) =>
      (Array.isArray(row.effects) ? row.effects : []).some((effect: unknown) => {
        if (typeof effect !== 'object' || effect === null) return false;
        const metadata: unknown = Reflect.get(effect, 'metadata');
        return (
          Reflect.get(effect, 'type') === 'shipment_outstanding_cancellation' &&
          typeof metadata === 'object' &&
          metadata !== null &&
          Reflect.get(metadata, 'operationStatus') === 'pending'
        );
      }),
    );
  }
}
