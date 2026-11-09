import { Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DbTx, SalesOrder, wmsTables } from '../../inventory/schema/inventory.schema';
import { isDigitalFulfillmentLine } from '../../product-matching/line-composition/line-composition';
import type { SalesChannelName } from './channel-cancellation-capability';

/** 커널이 취소를 시도하기 전·후에 읽는 것. 의존성이 없다 — 호출자의 트랜잭션으로 읽는다 */
@Injectable()
export class OrderCancellationReader {
  async salesOrder(salesOrderId: string, tx: DbTx): Promise<SalesOrder | undefined> {
    const rows = await tx.select().from(wmsTables.salesOrders).where(eq(wmsTables.salesOrders.id, salesOrderId)).limit(1);
    return rows[0];
  }

  /**
   * 채널 취소 수신이 판정에 쓰는 판매주문과 그 줄. 판매주문을 잠그고 읽는다 — 이미 취소된 수량을 읽고 그 차이를 취소하는
   * 사이에 다른 취소가 끼지 않게. 취소 확정(`SalesOrdersService.cancel`)의 첫 잠금과 같은 행이라 잠금 순서가 바뀌지 않는다
   */
  async lockOrderLines(
    salesOrderId: string,
    tx: DbTx,
  ): Promise<
    | { salesChannel: string; lines: Array<{ id: string; quantity: number; channelOrderItemId: string | null }> }
    | undefined
  > {
    const [so] = await tx
      .select({ salesChannel: wmsTables.salesOrders.salesChannel })
      .from(wmsTables.salesOrders)
      .where(eq(wmsTables.salesOrders.id, salesOrderId))
      .for('update');
    if (!so) return undefined;
    const t = wmsTables.salesOrderLines;
    const lines = await tx
      .select({ id: t.id, quantity: t.quantity, channelOrderItemId: t.channelOrderItemId })
      .from(t)
      .where(eq(t.salesOrderId, salesOrderId))
      .orderBy(t.id);
    return { salesChannel: so.salesChannel, lines };
  }

  /** 채널 키로 찾은 판매주문과 그 줄의 채널 줄 번호 — 마켓 고객 취소요청 문이 판정 전에 읽는다(잠그지 않는다) */
  async channelOrder(
    salesChannel: SalesChannelName,
    externalOrderId: string,
    tx: DbTx,
  ): Promise<
    { id: string; salesChannel: string; lines: Array<{ id: string; channelOrderItemId: string | null }> } | undefined
  > {
    const [so] = await tx
      .select({ id: wmsTables.salesOrders.id, salesChannel: wmsTables.salesOrders.salesChannel })
      .from(wmsTables.salesOrders)
      .where(
        and(
          eq(wmsTables.salesOrders.salesChannel, salesChannel),
          eq(wmsTables.salesOrders.channelOrderId, externalOrderId),
        ),
      )
      .limit(1);
    if (!so) return undefined;
    const t = wmsTables.salesOrderLines;
    const lines = await tx
      .select({ id: t.id, channelOrderItemId: t.channelOrderItemId })
      .from(t)
      .where(eq(t.salesOrderId, so.id))
      .orderBy(t.id);
    return { ...so, lines };
  }

  /** 디지털 이용권 줄 id — 부분 취소는 디지털을 회수하지 않으므로 호출자가 제외한다 */
  async digitalLineIds(salesOrderId: string, tx: DbTx): Promise<Set<string>> {
    const t = wmsTables.salesOrderLines;
    const rows = await tx
      .select({ id: t.id, fulfillmentKind: t.fulfillmentKind, requiresShipping: t.requiresShipping })
      .from(t)
      .where(eq(t.salesOrderId, salesOrderId));
    return new Set(rows.filter(isDigitalFulfillmentLine).map((line) => line.id));
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
