import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, ne, notInArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { ACTIVE_WORK_ITEM_STATUSES } from './work-item-status';

/**
 * 박스 하나와 그 줄을 읽고·잠그고·기록하는 공용 조각. 분할·취소(ShipmentPlanningService)와 작성 중 박스 맞추기
 * (DraftBoxAmender)가 같이 쓴다 — 가드나 스냅샷 모양이 두 벌이면 한쪽만 고쳐진다.
 */
export type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
export type ShipmentLineRow = typeof wmsTables.shipmentLines.$inferSelect & {
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  fulfillmentMode: string | null;
};
export type ShipmentAggregate = {
  shipment: ShipmentRow;
  lines: ShipmentLineRow[];
  fulfillmentOrderIds: string[];
};
export type ShipmentManifestSnapshot = {
  shipmentId: string;
  status: string;
  warehouseId: string;
  shippingProfileId: string | null;
  recipientSnapshot: unknown;
  manifestVersion: number;
  reservationVersion: number;
  lines: Array<{
    id: string;
    fulfillmentOrderItemId: string;
    skuId: string;
    qty: number;
    reservedQty: number;
    inspectedQty: number;
    lineVersion: number;
  }>;
};
export type ShipmentOperationType = (typeof wmsTables.shipmentOperations.type.enumValues)[number];
export type ShipmentOperationMember = {
  shipmentId: string;
  role: 'source' | 'target';
  before: ShipmentManifestSnapshot | null;
  after: ShipmentManifestSnapshot;
};

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

export async function lockShipmentAggregate(
  tx: DbTx,
  invariant: FulfillmentInvariantService,
  shipmentId: string,
): Promise<ShipmentAggregate> {
  const optimistic = await loadShipmentAggregate(tx, shipmentId);
  await invariant.assertFulfillmentOrders(optimistic.fulfillmentOrderIds, tx);
  const locked = await loadShipmentAggregate(tx, shipmentId);
  if (
    optimistic.lines.map((line) => `${line.id}:${line.shipmentId}`).join(',') !==
    locked.lines.map((line) => `${line.id}:${line.shipmentId}`).join(',')
  ) {
    throw conflict('SHIPMENT_COMPONENT_CHANGED_RETRY', 'Shipment component changed while acquiring locks');
  }
  return locked;
}

export async function loadShipmentAggregate(tx: DbTx, shipmentId: string): Promise<ShipmentAggregate> {
  const [shipment] = await tx.select().from(wmsTables.shipments).where(eq(wmsTables.shipments.id, shipmentId)).limit(1);
  if (!shipment) throw new NotFoundException(`Shipment ${shipmentId} not found`);
  const lines = await tx
    .select({
      id: wmsTables.shipmentLines.id,
      shipmentId: wmsTables.shipmentLines.shipmentId,
      fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
      skuId: wmsTables.shipmentLines.skuId,
      qty: wmsTables.shipmentLines.qty,
      reservedQty: wmsTables.shipmentLines.reservedQty,
      inspectedQty: wmsTables.shipmentLines.inspectedQty,
      lineVersion: wmsTables.shipmentLines.lineVersion,
      createdFromLineId: wmsTables.shipmentLines.createdFromLineId,
      forced: wmsTables.shipmentLines.forced,
      demandRequestedAt: wmsTables.shipmentLines.demandRequestedAt,
      createdAt: wmsTables.shipmentLines.createdAt,
      fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
      salesOrderLineId: wmsTables.fulfillmentOrderItems.salesOrderLineId,
      salesOrderId: wmsTables.fulfillmentOrders.salesOrderId,
      fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .innerJoin(
      wmsTables.fulfillmentOrders,
      eq(wmsTables.fulfillmentOrders.id, wmsTables.fulfillmentOrderItems.fulfillmentOrderId),
    )
    .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId))
    .orderBy(asc(wmsTables.shipmentLines.id));
  if (lines.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines`);
  return { shipment, lines, fulfillmentOrderIds: uniqueSorted(lines.map((line) => line.fulfillmentOrderId)) };
}

export function shipmentSnapshot(aggregate: ShipmentAggregate): ShipmentManifestSnapshot {
  return {
    shipmentId: aggregate.shipment.id,
    status: aggregate.shipment.status,
    warehouseId: aggregate.shipment.warehouseId,
    shippingProfileId: aggregate.shipment.shippingProfileId,
    recipientSnapshot: aggregate.shipment.recipientSnapshot,
    manifestVersion: aggregate.shipment.manifestVersion,
    reservationVersion: aggregate.shipment.reservationVersion,
    lines: aggregate.lines.map((line) => ({
      id: line.id,
      fulfillmentOrderItemId: line.fulfillmentOrderItemId,
      skuId: line.skuId,
      qty: line.qty,
      reservedQty: line.reservedQty,
      inspectedQty: line.inspectedQty,
      lineVersion: line.lineVersion,
    })),
  };
}

export async function createShipmentOperation(
  tx: DbTx,
  input: {
    type: ShipmentOperationType;
    actorId: string;
    reason: string;
    csCaseId: string | null;
    note: string | null;
    idempotencyKey: string;
    requestHash: string;
    before: ShipmentManifestSnapshot;
  },
) {
  const [operation] = await tx
    .insert(wmsTables.shipmentOperations)
    .values({
      type: input.type,
      status: 'pending',
      operatorId: input.actorId,
      reason: input.reason,
      csCaseId: input.csCaseId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      beforeManifestSnapshot: input.before,
    })
    .returning();
  return operation;
}

export async function completeShipmentOperation(
  tx: DbTx,
  operationId: string,
  members: ShipmentOperationMember[],
): Promise<void> {
  await tx.insert(wmsTables.shipmentOperationMembers).values(
    members.map((member) => ({
      operationId,
      shipmentId: member.shipmentId,
      role: member.role,
      beforeManifestVersion: member.before?.manifestVersion ?? null,
      afterManifestVersion: member.after.manifestVersion,
      beforeManifestSnapshot: member.before,
      afterManifestSnapshot: member.after,
    })),
  );
  await tx
    .update(wmsTables.shipmentOperations)
    .set({
      status: 'completed',
      afterManifestSnapshot: members.map((member) => member.after),
      completedAt: new Date(),
    })
    .where(eq(wmsTables.shipmentOperations.id, operationId));
}

export async function selectConfirmedReservationQtyByLine(tx: DbTx, lineIds: string[]): Promise<Map<string, number>> {
  if (lineIds.length === 0) return new Map();
  const rows = await tx
    .select({ shipmentLineId: wmsTables.stockReservations.shipmentLineId, qty: wmsTables.stockReservations.quantity })
    .from(wmsTables.stockReservations)
    .where(
      and(
        inArray(wmsTables.stockReservations.shipmentLineId, lineIds),
        eq(wmsTables.stockReservations.status, 'confirmed'),
      ),
    );
  const result = new Map<string, number>();
  for (const row of rows) {
    if (row.shipmentLineId) result.set(row.shipmentLineId, (result.get(row.shipmentLineId) ?? 0) + row.qty);
  }
  return result;
}

// 'SHIPMENT_ACTIVE_INVOICE' 코드 문자열은 운영/클라이언트 의미 보존을 위해 유지(데이터소스만 waybill 로 전환).
export async function assertShipmentHasNoActiveWaybill(tx: DbTx, shipmentId: string): Promise<void> {
  const [waybill] = await tx
    .select({ id: wmsTables.waybills.id, status: wmsTables.waybills.status })
    .from(wmsTables.waybills)
    .where(
      and(
        eq(wmsTables.waybills.shipmentId, shipmentId),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    )
    .limit(1);
  if (waybill) throw conflict('SHIPMENT_ACTIVE_INVOICE', `Void active waybill ${waybill.id} before editing`);
}

export async function assertShipmentHasNoCustodyOrActiveWork(tx: DbTx, aggregate: ShipmentAggregate): Promise<void> {
  if (aggregate.lines.some((line) => line.inspectedQty > 0)) {
    throw conflict('SHIPMENT_CUSTODY_EXISTS', 'Explicit unpick is required before editing inspected quantity');
  }
  const [workItem] = await tx
    .select({ id: wmsTables.outboundBatchWorkItems.id })
    .from(wmsTables.outboundBatchWorkItems)
    .where(
      and(
        eq(wmsTables.outboundBatchWorkItems.shipmentId, aggregate.shipment.id),
        inArray(wmsTables.outboundBatchWorkItems.status, [...ACTIVE_WORK_ITEM_STATUSES]),
      ),
    )
    .limit(1);
  if (workItem) throw conflict('SHIPMENT_ACTIVE_WORK_ITEM', `Exclude work item ${workItem.id} before editing`);

  const [balance] = await tx
    .select({ id: wmsTables.batchInventorySessionBalances.id })
    .from(wmsTables.batchInventorySessionBalances)
    .where(
      and(
        inArray(
          wmsTables.batchInventorySessionBalances.shipmentLineId,
          aggregate.lines.map((line) => line.id),
        ),
        gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
      ),
    )
    .limit(1);
  if (balance) throw conflict('SHIPMENT_CUSTODY_EXISTS', 'Explicit unpick is required before editing custody');
}
