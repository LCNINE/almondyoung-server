import { randomUUID } from 'crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { DbTx, returnRequests, wmsTables } from '../../../inventory/schema/inventory.schema';

/** 정체 보드 판정 스펙 전용 — 판정이 읽는 칸만 채운다(실제 흐름 서비스는 부르지 않는다). */
export type World = { warehouseId: string; skuId: string; holderId: string };

export async function seedWorld(tx: DbTx): Promise<World> {
  const suffix = randomUUID().slice(0, 8);
  const [wh] = await tx
    .insert(wmsTables.warehouses)
    .values({ name: `op-wh-${suffix}`, supportedPickingStrategies: ['discrete'], isSellable: true })
    .returning();
  const [holder] = await tx
    .insert(wmsTables.holders)
    .values({ name: `op-holder-${suffix}` })
    .returning();
  const [sku] = await tx
    .insert(wmsTables.skus)
    .values({ name: 'op-sku', code: `OP-${randomUUID().toUpperCase()}`, holderId: holder.id })
    .returning();
  return { warehouseId: wh.id, skuId: sku.id, holderId: holder.id };
}

export async function seedOrder(
  tx: DbTx,
  args: {
    status?: 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
    createdAt?: Date;
    /** 라인 주문 수량. 안 주면 1 */
    quantity?: number;
  } = {},
): Promise<{ salesOrderId: string; lineId: string }> {
  const [so] = await tx
    .insert(wmsTables.salesOrders)
    .values({
      channelOrderId: `OP-${randomUUID().slice(0, 8)}`,
      salesChannel: 'medusa',
      status: args.status ?? 'confirmed',
      shippingAddress: { name: 'OP', address1: 'x' },
      orderDate: args.createdAt ?? new Date(),
      createdAt: args.createdAt ?? new Date(),
    })
    .returning();
  const [line] = await tx
    .insert(wmsTables.salesOrderLines)
    .values({
      salesOrderId: so.id,
      variantId: randomUUID(),
      productName: 'OP',
      quantity: args.quantity ?? 1,
      unitPrice: 1000,
    })
    .returning();
  return { salesOrderId: so.id, lineId: line.id };
}

export async function seedBacklog(
  tx: DbTx,
  salesOrderId: string,
  status: 'pending' | 'processing' | 'awaiting_matching' | 'completed' | 'not_required' | 'failed',
  createdAt = new Date(),
): Promise<void> {
  await tx.insert(wmsTables.fulfillmentOrderCreationBacklogs).values({ salesOrderId, status, createdAt });
}

export async function seedFo(
  tx: DbTx,
  w: World,
  order: { salesOrderId: string; lineId: string },
  args: {
    status?: 'created' | 'partially_reserved' | 'ready' | 'processing' | 'completed';
    /**
     * 옛 FO 단위 직배(`fulfillment_mode='drop_ship'`·`direct_ship_status`) — 옛 쓰기 경로(direct-ship.service·취소 알림, PR 5·8 에서 걷는다)
     * 스펙 전용. 정체 보드·K6 수량 사실·판매주문 단계는 이걸 읽지 않는다(K3 PR4, N8) — 직배는 `seedBox({ supplierId })` 로 만든다.
     */
    dropShip?: 'pending' | 'forwarded' | 'completed' | 'canceled';
    createdAt?: Date;
    /** FO 항목 수량. 안 주면 1 */
    qty?: number;
    /** FO owner(= 업체 holder). 안 주면 넘긴 직배('forwarded')일 때 w.holderId, 아니면 null */
    ownerId?: string | null;
  } = {},
): Promise<{ foId: string; foItemId: string }> {
  const [fo] = await tx
    .insert(wmsTables.fulfillmentOrders)
    .values({
      salesOrderId: order.salesOrderId,
      warehouseId: w.warehouseId,
      status: args.status ?? 'ready',
      fulfillmentMode: args.dropShip ? 'drop_ship' : 'in_house',
      directShipStatus: args.dropShip ?? null,
      ownerId: args.ownerId !== undefined ? args.ownerId : args.dropShip === 'forwarded' ? w.holderId : null,
      totalQty: args.qty ?? 1,
      createdAt: args.createdAt ?? new Date(),
    })
    .returning();
  const [item] = await tx
    .insert(wmsTables.fulfillmentOrderItems)
    .values({
      fulfillmentOrderId: fo.id,
      salesOrderId: order.salesOrderId,
      salesOrderLineId: order.lineId,
      skuId: w.skuId,
      qty: args.qty ?? 1,
    })
    .returning();
  // 실제 FO 생성은 라인 구성을 굳힌다 — 고객 취소 계획이 비율을 거기서 읽는다(#1063)
  await tx
    .insert(wmsTables.salesOrderLineCompositions)
    .values({ salesOrderLineId: order.lineId, skuId: w.skuId, qtyPerUnit: 1 })
    .onConflictDoNothing();
  // 구성 행이 있으면 출처도 있어야 한다(스펙 §4.3) — 이미 굳힌 라인은 그대로 둔다
  await tx
    .update(wmsTables.salesOrderLines)
    .set({ compositionSource: 'matching', compositionSetAt: new Date() })
    .where(and(eq(wmsTables.salesOrderLines.id, order.lineId), isNull(wmsTables.salesOrderLines.compositionSource)));
  return { foId: fo.id, foItemId: item.id };
}

/** 직배 입점사(K3) — `is_direct_delivery = true` 공급사. */
export async function seedDirectSupplier(tx: DbTx): Promise<string> {
  const [row] = await tx
    .insert(wmsTables.suppliers)
    .values({ name: `op-supplier-${randomUUID().slice(0, 8)}`, isDirectDelivery: true })
    .returning();
  return row.id;
}

/** 입점사 넘김 묶음(K3) — 상자를 묶을 때 `seedBox({ supplierId, supplierHandoffId })` 로 같은 입점사를 준다. createdAt = 넘긴 시각 */
export async function seedHandoff(tx: DbTx, supplierId: string, createdAt = new Date()): Promise<string> {
  const [row] = await tx
    .insert(wmsTables.supplierHandoffs)
    .values({ supplierId, createdBy: 'op-operator', createdAt })
    .returning();
  return row.id;
}

export async function seedBox(
  tx: DbTx,
  w: World,
  foItemIds: string[],
  args: {
    status: 'draft' | 'planned' | 'shipped' | 'in_transit' | 'delivered' | 'failed' | 'canceled' | 'recovery_required';
    recoveryCode?: string;
    openedAt?: Date;
    plannedAt?: Date;
    shippedAt?: Date;
    /** 라인별 수량(foItemIds 와 같은 순서). 안 주면 라인마다 1 */
    qty?: number[];
    /** 주면 입점사 상자(warehouse_id NULL, K3) */
    supplierId?: string;
    /** 넘김 묶음(`seedHandoff`). 같은 입점사의 묶음이어야 한다 — 복합 FK 가 지킨다 */
    supplierHandoffId?: string;
    /** `lineIndex` 번째 라인을 입점사가 «못 보냄»으로 알렸다 */
    unfulfillable?: { lineIndex: number; reason: string; at: Date };
  },
): Promise<{ shipmentId: string; lineIds: string[] }> {
  const [s] = await tx
    .insert(wmsTables.shipments)
    .values({
      warehouseId: args.supplierId ? null : w.warehouseId,
      supplierId: args.supplierId ?? null,
      supplierHandoffId: args.supplierHandoffId ?? null,
      status: args.status,
      recoveryCode: args.recoveryCode ?? null,
      openedAt: args.openedAt ?? new Date(),
      plannedAt: args.plannedAt ?? null,
      shippedAt: args.shippedAt ?? null,
    })
    .returning();
  const lineIds: string[] = [];
  for (const [i, fulfillmentOrderItemId] of foItemIds.entries()) {
    const [l] = await tx
      .insert(wmsTables.shipmentLines)
      .values({
        shipmentId: s.id,
        fulfillmentOrderItemId,
        skuId: w.skuId,
        qty: args.qty?.[i] ?? 1,
        ...(args.unfulfillable?.lineIndex === i
          ? {
              unfulfillableReason: args.unfulfillable.reason,
              unfulfillableReportedAt: args.unfulfillable.at,
              unfulfillableReportedBy: 'op-supplier',
            }
          : {}),
      })
      .returning();
    lineIds.push(l.id);
  }
  return { shipmentId: s.id, lineIds };
}

export async function seedWorkItem(
  tx: DbTx,
  w: World,
  shipmentId: string,
  args: {
    status: 'queued' | 'picking' | 'packing' | 'completed' | 'excluded';
    completedAt?: Date;
    pickerClaimedAt?: Date;
  },
): Promise<void> {
  const [batch] = await tx
    .insert(wmsTables.outboundBatches)
    .values({ batchNumber: `OP-B-${randomUUID()}`, warehouseId: w.warehouseId, pickingMethod: 'individual' })
    .returning();
  await tx.insert(wmsTables.outboundBatchWorkItems).values({
    batchId: batch.id,
    shipmentId,
    status: args.status,
    completedAt: args.completedAt ?? null,
    pickerClaimedAt: args.pickerClaimedAt ?? null,
  });
}

export async function seedWaybill(
  tx: DbTx,
  shipmentId: string,
  status: 'pending' | 'allocated' | 'registered' | 'used' | 'voided',
): Promise<void> {
  await tx.insert(wmsTables.waybills).values({
    shipmentId,
    source: 'manual',
    carrier: 'HANJIN',
    status,
    trackingNo: status === 'registered' || status === 'used' ? `T${Date.now()}` : null,
    manifestVersion: 1,
    recipientHash: 'x'.repeat(64),
  });
}

export async function seedConfirmedReservation(
  tx: DbTx,
  w: World,
  args: { foId: string; foItemId: string; shipmentLineId: string; quantity?: number },
): Promise<void> {
  await tx.insert(wmsTables.stockReservations).values({
    targetType: 'SHIPMENT_LINE',
    targetId: args.foId,
    fulfillmentOrderItemId: args.foItemId,
    shipmentLineId: args.shipmentLineId,
    skuId: w.skuId,
    warehouseId: w.warehouseId,
    quantity: args.quantity ?? 1,
    status: 'confirmed',
  });
}

/** 상자의 모든 라인을 라인 수량만큼 확정 예약한다 — FO 가 ready/processing 인 실제 상자는 예약이 다 걸려 있다 */
export async function seedFullReservations(
  tx: DbTx,
  w: World,
  args: { foId: string; foItemIds: string[]; box: { lineIds: string[] }; qty?: number[] },
): Promise<void> {
  for (const [i, shipmentLineId] of args.box.lineIds.entries()) {
    await seedConfirmedReservation(tx, w, {
      foId: args.foId,
      foItemId: args.foItemIds[i],
      shipmentLineId,
      quantity: args.qty?.[i] ?? 1,
    });
  }
}

export async function seedCancellation(tx: DbTx, salesOrderId: string, occurredAt: Date): Promise<void> {
  await tx.insert(wmsTables.salesOrderCancellations).values({ salesOrderId, occurredAt, reasonCode: 'customer' });
}

export async function seedReturn(
  tx: DbTx,
  salesOrderId: string,
  status: 'requested' | 'collection_pending' | 'completed' | 'rejected',
  createdAt = new Date(),
): Promise<void> {
  await tx.insert(returnRequests).values({ salesOrderId, status, reasonCode: 'defective', createdAt });
}

/** 확정된 채널 취소 요청(정산 중) — #1016 36번 재설계. createdAt 이 확정 시각이다 */
export async function seedSettling(
  tx: DbTx,
  salesOrderId: string,
  args: { createdAt: Date; state?: 'in_progress' | 'refused'; mode?: 'auto' | 'manual' },
): Promise<string> {
  const id = randomUUID();
  const at = args.createdAt.toISOString();
  await tx.insert(wmsTables.salesOrderAmendments).values({
    id,
    salesOrderId,
    amendmentKind: 'commercial',
    reasonCode: 'CHANNEL_CANCEL_REQUEST',
    deltas: [],
    metadata: {
      salesChannel: 'medusa',
      externalOrderId: `ext-${id.slice(0, 8)}`,
      request: {
        kind: 'cancel',
        scope: 'full',
        requestedBy: 'customer:c',
        sourceKey: id,
        appliedAt: at,
        command: { requestId: id },
      },
      settlement: {
        state: args.state ?? 'in_progress',
        mode: args.mode ?? 'auto',
        since: at,
        ...(args.state === 'refused'
          ? { lastFailure: { code: 'wallet_refund_refused:X', message: '거절', retryable: false, at } }
          : {}),
      },
    },
    origin: 'operator',
    status: 'settling',
    occurredAt: args.createdAt,
    createdAt: args.createdAt,
  });
  return id;
}
