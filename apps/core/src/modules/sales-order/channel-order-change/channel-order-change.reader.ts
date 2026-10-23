import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { readLineQuantities } from '../line-quantities/line-quantities.reader';
import { toShippingAddress } from './channel-order-diff';
import type { EffectiveSalesOrder } from './channel-order-change.types';

const FINISHED_SHIPMENT_STATUSES = ['shipped', 'in_transit', 'delivered', 'canceled', 'superseded', 'failed'] as const;
export const FINISHED_FULFILLMENT_STATUSES = ['shipped', 'completed', 'canceled'] as const;
/** 공급처에 이미 넘어간 직배. `pending` 은 아직 넘기지 않았고, 넘길 때 판매주문 주소를 읽는다. */
const HANDED_OFF_DIRECT_SHIP_STATUSES = ['forwarded', 'completed'] as const;

@Injectable()
export class ChannelOrderChangeReader {
  /** 그 판매주문의 가장 최근 «무시» 채널 행의 델타(스펙 §6.2). 없으면 null. */
  async latestDismissedChannelDeltas(salesOrderId: string, tx: DbTx): Promise<unknown[] | null> {
    const table = wmsTables.salesOrderAmendments;
    const [row] = await tx
      .select({ deltas: table.deltas })
      .from(table)
      .where(and(eq(table.salesOrderId, salesOrderId), eq(table.origin, 'channel'), eq(table.status, 'dismissed')))
      .orderBy(sql`${table.dismissedAt} DESC NULLS LAST`, desc(table.id))
      .limit(1);
    if (!row) return null;
    return Array.isArray(row.deltas) ? row.deltas : [];
  }

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
    const lineQuantities = await readLineQuantities(tx, salesOrderId);
    return {
      id: order.id,
      status: order.status,
      shippingAddress: toShippingAddress(order.shippingAddress),
      lines: lines.map((line) => ({
        id: line.id,
        channelOrderItemId: line.channelOrderItemId,
        channelProductId: line.channelProductId,
        effectiveQuantity: Math.max(0, lineQuantities.get(line.id)?.remaining ?? 0),
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

  /**
   * 이 취소가 그 자리에서 끝나지 않았는가 — 끝나지 않았으면 그 사유(blocker detail), 끝났으면 null.
   * ① 박스 쪽에서 대기(CANCEL_REPLAN_PENDING·이탈 대기)로 끝남 — 상자 후 경로.
   * ② 이미 출고된 수량을 건드려 출고분 보존·회수 이관이 생김 — 상자 전 경로(`toPostShipmentCancellationEffects`).
   *    채널 정정은 회수를 열지 않는다(스펙 §7.2 R1) — 사람이 판단할 대기로 남긴다.
   */
  async cancellationNeedsFollowUp(salesOrderId: string, sourceEventId: string, tx: DbTx): Promise<string | null> {
    const rows = await tx
      .select({ effects: wmsTables.salesOrderCancellations.effects })
      .from(wmsTables.salesOrderCancellations)
      .where(
        and(
          eq(wmsTables.salesOrderCancellations.salesOrderId, salesOrderId),
          sql`${wmsTables.salesOrderCancellations.metadata}->>'sourceEventId' = ${sourceEventId}`,
        ),
      );
    const effects = rows.flatMap((row) => (Array.isArray(row.effects) ? row.effects : []));
    if (effects.some(isPendingShipmentCancellation)) return 'shipment cancellation would wait';
    if (effects.some(isPostShipmentFollowUp)) return 'cancellation needs post-shipment follow-up';
    return null;
  }

  /** 주문의 출고지시가 하나 이상 있고, 끝나지 않은 출고지시도 아직 떠나지 않은 박스도 없는가(전량 출고). */
  /**
   * 와우프레스로 이미 보냈거나 보내는 중인 인쇄 줄이 있는가 — 그 인쇄물은 주문할 때 받은 옛 주소로 간다.
   * 발주 워커와 엇갈리지 않게 이 주문의 인쇄 행을 잠근다. 잠긴 행은 워커가 건너뛰고 다음 차례에 새 주소로 발주한다
   */
  async hasPrintSentToVendor(salesOrderId: string, tx: DbTx): Promise<boolean> {
    const rows = await tx
      .select({
        status: wmsTables.printOrders.status,
        orderAttemptedAt: wmsTables.printOrders.orderAttemptedAt,
        vendorOrderNumber: wmsTables.printOrders.vendorOrderNumber,
      })
      .from(wmsTables.printOrders)
      .where(eq(wmsTables.printOrders.salesOrderId, salesOrderId))
      .for('update');
    return rows.some(
      (r) =>
        r.status !== 'cancelled' &&
        (r.status === 'submitting' || r.orderAttemptedAt !== null || r.vendorOrderNumber !== null),
    );
  }

  async hasActivePrintOrder(salesOrderLineId: string, tx: DbTx): Promise<boolean> {
    const t = wmsTables.printOrders;
    const rows = await tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.salesOrderLineId, salesOrderLineId), ne(t.status, 'cancelled')))
      .for('update');
    return rows.length > 0;
  }

  async isFullyShipped(salesOrderId: string, tx: DbTx): Promise<boolean> {
    const fulfillmentOrders = await tx
      .select({ status: wmsTables.fulfillmentOrders.status })
      .from(wmsTables.fulfillmentOrders)
      .where(eq(wmsTables.fulfillmentOrders.salesOrderId, salesOrderId));
    if (fulfillmentOrders.length === 0) return false;
    const finished: readonly string[] = FINISHED_FULFILLMENT_STATUSES;
    if (fulfillmentOrders.some((fo) => !finished.includes(fo.status))) return false;
    return (await this.remainingShipmentIds(salesOrderId, tx)).length === 0;
  }
}

function effectType(effect: unknown): unknown {
  return typeof effect === 'object' && effect !== null ? Reflect.get(effect, 'type') : undefined;
}

function isPendingShipmentCancellation(effect: unknown): boolean {
  if (typeof effect !== 'object' || effect === null) return false;
  if (Reflect.get(effect, 'type') !== 'shipment_outstanding_cancellation') return false;
  const metadata: unknown = Reflect.get(effect, 'metadata');
  return typeof metadata === 'object' && metadata !== null && Reflect.get(metadata, 'operationStatus') === 'pending';
}

/** `SalesOrdersService.toPostShipmentCancellationEffects` 가 남기는 두 효과 형식. */
function isPostShipmentFollowUp(effect: unknown): boolean {
  const type = effectType(effect);
  return (
    type === 'preserved_shipped_fulfillment_order_item' ||
    (typeof type === 'string' && type.startsWith('linked_post_shipment_'))
  );
}
