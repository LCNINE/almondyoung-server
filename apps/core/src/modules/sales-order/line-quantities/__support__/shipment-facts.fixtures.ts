import { randomUUID } from 'crypto';
import { and, eq, isNull, max, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  seedBox,
  seedDirectSupplier,
  seedHandoff,
  World,
} from '../../../fulfillment/order-progress/__support__/order-progress.fixtures';
import type { SupplierShipmentStage } from '../../../fulfillment/shipment/supplier-shipment-stage';

/**
 * 출고·배송 사실 픽스처 (K6 PR2b) — 실제 발송(`shipment-dispatch.service.ts` 의 dispatchLocked)·배송 추적
 * (`shipment-delivery-tracking.service.ts`)·회수(`shipment-recall.service.ts`)가 남기는 행 모양 그대로 쓴다.
 * 상자 status 만 바꾼 «만든» 데이터는 수량이 없어 라인 수량 문이 출고로 보지 않는다(P5) — 출고·배송은 이것으로 만든다.
 * 원장 이벤트·예약 소진·송장은 만들지 않는다. 수량 문이 읽지 않는 칸이다.
 */

export async function seedDispatchedParcel(
  tx: DbTx,
  w: World,
  parcel: {
    shipmentId: string;
    lines: Array<{ shipmentLineId: string; foItemId: string; qty: number }>;
    delivered?: boolean;
  },
): Promise<{ dispatchAttemptId: string }> {
  const [location] = await tx
    .insert(wmsTables.locations)
    .values({ warehouseId: w.warehouseId, code: `SF-Z-${randomUUID().slice(0, 8)}`, locationType: 'zone' })
    .returning();
  // 회수 뒤 재발송이면 시도 번호가 이어진다 — 실제 경로처럼 상자의 max + 1
  const [attemptNoRow] = await tx
    .select({ attemptNo: max(wmsTables.dispatchAttempts.attemptNo) })
    .from(wmsTables.dispatchAttempts)
    .where(eq(wmsTables.dispatchAttempts.shipmentId, parcel.shipmentId));
  const attemptNo = Number(attemptNoRow?.attemptNo ?? 0) + 1;
  const dispatchAttemptId = randomUUID();
  const journalId = randomUUID();
  const attemptKey = `dispatch:${parcel.shipmentId}:${attemptNo}`;
  const dispatchedAt = new Date();
  await tx.insert(wmsTables.stockJournals).values({
    id: journalId,
    sourceType: 'SHIPMENT_DISPATCH_ATTEMPT',
    sourceId: dispatchAttemptId,
    idempotencyKey: attemptKey,
  });
  await tx.insert(wmsTables.dispatchAttempts).values({
    id: dispatchAttemptId,
    shipmentId: parcel.shipmentId,
    attemptNo,
    status: 'dispatched',
    idempotencyKey: attemptKey,
    stockJournalId: journalId,
    dispatchedAt,
  });
  await tx.insert(wmsTables.dispatchAttemptSources).values(
    parcel.lines.map((line) => ({
      dispatchAttemptId,
      shipmentLineId: line.shipmentLineId,
      sourceLocationId: location.id,
      qty: line.qty,
    })),
  );
  // incrementFulfillmentItems 의 모양 — 발송이 FOI shipped_qty 를 올린다
  for (const line of parcel.lines) {
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ shippedQty: sql`${wmsTables.fulfillmentOrderItems.shippedQty} + ${line.qty}`, updatedAt: dispatchedAt })
      .where(eq(wmsTables.fulfillmentOrderItems.id, line.foItemId));
  }
  await tx
    .update(wmsTables.shipments)
    .set(
      parcel.delivered
        ? { status: 'delivered', shippedAt: dispatchedAt, deliveredAt: dispatchedAt, lastUpdated: dispatchedAt }
        : { status: 'shipped', shippedAt: dispatchedAt, lastUpdated: dispatchedAt },
    )
    .where(eq(wmsTables.shipments.id, parcel.shipmentId));
  if (parcel.delivered) {
    // 추적 행은 항상 출고 시도에 붙는다(Task 25 contract) — 배송완료는 소포 단위다
    await tx.insert(wmsTables.shipmentTracking).values({
      shipmentId: parcel.shipmentId,
      dispatchAttemptId,
      providerEventId: `sf-${randomUUID()}`,
      status: 'delivered',
      timestamp: dispatchedAt,
    });
  }
  return { dispatchAttemptId };
}

/** 회수 — 역분개 저널, 시도 `recalled`, FOI shipped_qty 를 되돌린다(`shipment-recall.service.ts` 의 FOI 감소 모양). */
export async function recallParcel(
  tx: DbTx,
  p: { dispatchAttemptId: string; lines: Array<{ foItemId: string; qty: number }> },
): Promise<void> {
  const operationId = randomUUID();
  const reversalJournalId = randomUUID();
  const recalledAt = new Date();
  await tx.insert(wmsTables.stockJournals).values({
    id: reversalJournalId,
    sourceType: 'SHIPMENT_RECALL',
    sourceId: operationId,
    idempotencyKey: `shipment-recall:${operationId}`,
  });
  await tx
    .update(wmsTables.dispatchAttempts)
    .set({ status: 'recalled', recalledAt, reversalJournalId, updatedAt: recalledAt })
    .where(eq(wmsTables.dispatchAttempts.id, p.dispatchAttemptId));
  for (const line of p.lines) {
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ shippedQty: sql`${wmsTables.fulfillmentOrderItems.shippedQty} - ${line.qty}`, updatedAt: recalledAt })
      .where(eq(wmsTables.fulfillmentOrderItems.id, line.foItemId));
  }
}

/**
 * 입점사 몫 (K3 PR4) — FO 생성(`createV2`)이 직배 라인에 남기는 모양: 직배 SKU(`drop_shipped`, 직배 공급사 하나)의 FOI 와
 * 그 FOI 의 입점사 상자(warehouse_id NULL). 입점사 상자 라인은 예약하지 않는다. `foId` 를 안 주면 직배만 있는 주문이라
 * 창고 없는 FO 를 만든다(N2). 단계(`supplier-shipment-stage.ts`)는 `stage` 로 —
 *   pending   = draft, 넘김 없음
 *   forwarded = draft, 넘김 묶음 있음
 *   shipped   = shipped(넘긴 뒤 발송), FOI shipped_qty = qty — 입점사 발송이 남기는 수량. 배송완료 추적은 없다
 */
export async function seedSupplierShare(
  tx: DbTx,
  w: World,
  order: { salesOrderId: string; lineId: string },
  args: { stage: SupplierShipmentStage; qty?: number; foId?: string },
): Promise<{ foId: string; foItemId: string; shipmentId: string; skuId: string; supplierId: string }> {
  const qty = args.qty ?? 1;
  const supplierId = await seedDirectSupplier(tx);
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({
      name: 'sf-direct-sku',
      code: `SF-D-${randomUUID().toUpperCase()}`,
      holderId: w.holderId,
      stockType: 'drop_shipped',
    })
    .returning();
  await tx.insert(wmsTables.skuSuppliers).values({ skuId: sku.id, supplierId });
  const foId =
    args.foId ??
    (
      await tx
        .insert(wmsTables.fulfillmentOrders)
        .values({ salesOrderId: order.salesOrderId, warehouseId: null, status: 'ready', totalQty: qty })
        .returning()
    )[0].id;
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: foId,
      salesOrderId: order.salesOrderId,
      salesOrderLineId: order.lineId,
      skuId: sku.id,
      qty,
      shippedQty: args.stage === 'shipped' ? qty : 0,
    })
    .returning();
  await tx
    .insert(wmsTables.salesOrderLineCompositions)
    .values({ salesOrderLineId: order.lineId, skuId: sku.id, qtyPerUnit: 1 })
    .onConflictDoNothing();
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ compositionSource: 'matching', compositionSetAt: new Date() })
    .where(and(eq(wmsTables.salesOrderLines.id, order.lineId), isNull(wmsTables.salesOrderLines.compositionSource)));
  const supplierHandoffId = args.stage === 'pending' ? undefined : await seedHandoff(tx, supplierId);
  const box = await seedBox(tx, { ...w, skuId: sku.id }, [item.id], {
    status: args.stage === 'shipped' ? 'shipped' : 'draft',
    shippedAt: args.stage === 'shipped' ? new Date() : undefined,
    qty: [qty],
    supplierId,
    supplierHandoffId,
  });
  return { foId, foItemId: item.id, shipmentId: box.shipmentId, skuId: sku.id, supplierId };
}
