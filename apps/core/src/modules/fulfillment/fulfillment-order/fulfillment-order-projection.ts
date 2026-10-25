import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  FulfillmentOrderItemProgressInput,
  projectFulfillmentOrderItemProgress,
  projectFulfillmentOrderProgress,
} from '../services/fulfillment-progress.service';

/** 수요를 아직 들고 있는 상자 상태. 이 상자의 라인만 활성 라인 수량·확정 예약에 들어간다. */
export const ACTIVE_SHIPMENT_STATUSES = ['draft', 'planned', 'recovery_required'] as const;

/**
 * FO·FOI status 를 쓰는 유일한 문(K3). FOI 수량 사실·활성 상자 라인·확정 예약을 직접 읽어 투영하고 쓴다 —
 * 호출자는 입력을 조립하지 않는다. 호출자가 이미 FO 를 잠근 트랜잭션 안에서 부른다.
 * 바깥에서 status 를 쓰면 `fulfillment-order-status-writes.guard.spec.ts` 가 빨갛다.
 */
export async function reprojectFulfillmentOrders(
  tx: DbTx,
  fulfillmentOrderIds: readonly string[],
  at: Date = new Date(),
): Promise<void> {
  for (const fulfillmentOrderId of [...new Set(fulfillmentOrderIds)].sort()) {
    await reprojectOne(tx, fulfillmentOrderId, at);
  }
}

async function reprojectOne(tx: DbTx, fulfillmentOrderId: string, at: Date): Promise<void> {
  const items = await tx
    .select()
    .from(wmsTables.fulfillmentOrderItems)
    .where(eq(wmsTables.fulfillmentOrderItems.fulfillmentOrderId, fulfillmentOrderId))
    .orderBy(asc(wmsTables.fulfillmentOrderItems.id));

  const inputs: FulfillmentOrderItemProgressInput[] = [];
  for (const item of items) {
    const input = await readItemInput(tx, item);
    inputs.push(input);
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({
        reservedQty: input.confirmedReservedQty,
        status: projectFulfillmentOrderItemProgress(input).status,
        updatedAt: at,
      })
      .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
  }

  // 항목이 없으면 투영할 수요가 없다 — 취소로 비워진 FO 라 canceled 로 닫는다(순수 투영은 빈 입력이면 던진다).
  const projected = inputs.length === 0 ? null : projectFulfillmentOrderProgress(inputs);
  const status = projected?.status ?? 'canceled';
  const fo = wmsTables.fulfillmentOrders;
  await tx
    .update(fo)
    .set({
      status,
      totalReservedQty: projected?.confirmedReservedQty ?? 0,
      reservationFailureReason: null,
      reservationFailureDetails: null,
      // 되살아난 FO 의 옛 값은 비우지 않는다 — 처음 닫힌 시각을 지킨다.
      // raw sql 에 Date 를 그대로 넘기면 postgres.js 가 직렬화하지 못한다 — ISO 문자열로 캐스팅한다.
      ...(status === 'canceled'
        ? { canceledAt: sql`coalesce(${fo.canceledAt}, ${at.toISOString()}::timestamptz)` }
        : {}),
      updatedAt: at,
    })
    .where(eq(fo.id, fulfillmentOrderId));
}

async function readItemInput(
  tx: DbTx,
  item: typeof wmsTables.fulfillmentOrderItems.$inferSelect,
): Promise<FulfillmentOrderItemProgressInput> {
  const activeLines = await tx
    .select({
      id: wmsTables.shipmentLines.id,
      qty: wmsTables.shipmentLines.qty,
      inspectedQty: wmsTables.shipmentLines.inspectedQty,
      shipmentStatus: wmsTables.shipments.status,
      supplierId: wmsTables.shipments.supplierId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(wmsTables.shipments, eq(wmsTables.shipments.id, wmsTables.shipmentLines.shipmentId))
    .where(
      and(
        eq(wmsTables.shipmentLines.fulfillmentOrderItemId, item.id),
        inArray(wmsTables.shipments.status, [...ACTIVE_SHIPMENT_STATUSES]),
      ),
    );
  const activeLineIds = activeLines.map((line) => line.id);
  const reservations =
    activeLineIds.length === 0
      ? []
      : await tx
          .select({ quantity: wmsTables.stockReservations.quantity })
          .from(wmsTables.stockReservations)
          .where(
            and(
              inArray(wmsTables.stockReservations.shipmentLineId, activeLineIds),
              eq(wmsTables.stockReservations.status, 'confirmed'),
            ),
          );
  return {
    id: item.id,
    qty: item.qty,
    shippedQty: item.shippedQty,
    canceledQty: item.canceledQty,
    confirmedReservedQty: reservations.reduce((total, row) => total + row.quantity, 0),
    activeLineQty: activeLines.reduce((total, line) => total + line.qty, 0),
    supplierLineQty: activeLines
      .filter((line) => line.supplierId !== null)
      .reduce((total, line) => total + line.qty, 0),
    processing: item.pickedQty > 0 || activeLines.some((line) => line.inspectedQty > 0),
    recoveryRequired: activeLines.some((line) => line.shipmentStatus === 'recovery_required'),
  };
}
