import { Injectable } from '@nestjs/common';
import { and, eq, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';

/** 커널이 취소를 시도하기 전·후에 읽는 것. 의존성이 없다 — 호출자의 트랜잭션으로 읽는다 */
@Injectable()
export class OrderCancellationReader {
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
