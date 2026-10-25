import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PublisherFor } from '@app/events';
import {
  FULFILLMENT_V2_STREAM,
  SHIPMENT_STREAM,
  type FulfillmentReopenedPayload,
  type ShipmentDispatchRecalledPayload,
} from '@packages/event-contracts/streams';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { fulfillmentReopenedOutboxEvent, shipmentDispatchRecalledOutboxEvent } from '../events';
import { reprojectFulfillmentOrders } from '../fulfillment-order/fulfillment-order-projection';
import { loadFulfillmentSummaries, type FulfillmentSummary } from '../services/dispatch-effects';
import { lockShipmentConnectedComponentGraph } from '../services/shipment-reservation.service';
import { transitionShipments } from '../shipment/shipment-lifecycle';

/** 리콜 서비스가 이벤트를 낼 때 쓰는 outbox 의존 그대로 + 사용된 송장을 voided 로 돌리는 한 걸음. */
export interface SupplierRecallDeps {
  shipments: PublisherFor<typeof SHIPMENT_STREAM>;
  fulfillmentsV2: PublisherFor<typeof FULFILLMENT_V2_STREAM>;
  /** 상자의 활성 송장 used → voided. 정확히 한 행이 아니면 던진다. */
  voidUsedWaybill: (shipmentId: string, tx: DbTx) => Promise<void>;
}

export interface SupplierRecallCommand {
  shipmentId: string;
  dispatchAttemptId: string;
  recallOperationId: string;
  expectedManifestVersion: number;
  actorId: string;
  at: Date;
}

export interface SupplierRecallResult {
  attemptNo: number;
  shipment: typeof wmsTables.shipments.$inferSelect;
  attempt: typeof wmsTables.dispatchAttempts.$inferSelect;
  summaries: FulfillmentSummary[];
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/** 락 순서(FOI → 상자 → 라인)로 입점사 상자의 연결 성분을 잠근다. 서비스가 작업 기록 행을 쓰기 전에도 부른다. */
export async function lockSupplierRecallGraph(tx: DbTx, shipmentId: string): Promise<void> {
  const seeds = await tx
    .select({ fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId })
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.shipmentId, shipmentId));
  if (seeds.length === 0) throw new NotFoundException(`Shipment ${shipmentId} has no lines to recall`);
  await lockShipmentConnectedComponentGraph(
    tx,
    seeds.map((seed) => seed.fulfillmentOrderItemId),
  );
}

/**
 * 발송한 입점사 상자를 되돌린다(K3 N10). 창고 리콜과 같은 명령·같은 결과 모양이지만 재고 원장·예약·추적 게이트를
 * 건너뛴다. 한 트랜잭션에서 shipped → recovery_required(DISPATCH_RECALL_PENDING) → draft, 시도 dispatched → recalled,
 * 송장 voided, FOI shipped_qty 감소, FO shipped_at NULL, 투영, 이벤트 둘. 상자의 넘김(supplier_handoff_id)은 그대로다.
 */
export async function recallSupplierShipment(
  deps: SupplierRecallDeps,
  tx: DbTx,
  cmd: SupplierRecallCommand,
): Promise<SupplierRecallResult> {
  await lockSupplierRecallGraph(tx, cmd.shipmentId);

  const [shipment] = await tx
    .select()
    .from(wmsTables.shipments)
    .where(eq(wmsTables.shipments.id, cmd.shipmentId))
    .limit(1)
    .for('update');
  if (!shipment) throw new NotFoundException(`Shipment ${cmd.shipmentId} not found`);
  if (shipment.supplierId === null) {
    throw conflict('SHIPMENT_RECALL_NOT_SUPPLIER', `Shipment ${shipment.id} is not a supplier box`);
  }
  if (shipment.manifestVersion !== cmd.expectedManifestVersion) {
    throw conflict('SHIPMENT_RECALL_STALE_MANIFEST', 'Shipment manifest changed');
  }
  if (shipment.status !== 'shipped') {
    throw conflict('SHIPMENT_RECALL_NOT_SHIPPED', `Shipment is ${shipment.status}`);
  }

  const [attempt] = await tx
    .select()
    .from(wmsTables.dispatchAttempts)
    .where(eq(wmsTables.dispatchAttempts.id, cmd.dispatchAttemptId))
    .limit(1)
    .for('update');
  if (!attempt || attempt.shipmentId !== cmd.shipmentId) {
    throw new NotFoundException(`Dispatch attempt ${cmd.dispatchAttemptId} not found on shipment ${cmd.shipmentId}`);
  }
  if (attempt.kind !== 'supplier') {
    throw conflict('SHIPMENT_RECALL_ATTEMPT_NOT_SUPPLIER', 'Dispatch attempt is not a supplier attempt');
  }
  if (attempt.status !== 'dispatched') {
    throw conflict('SHIPMENT_RECALL_ATTEMPT_NOT_DISPATCHED', `Dispatch attempt is ${attempt.status}`);
  }
  if (!attempt.waybillId || !attempt.dispatchedAt) {
    throw conflict('SHIPMENT_RECALL_ATTEMPT_INCOMPLETE', 'Dispatch attempt lacks immutable dispatch evidence');
  }
  const [waybill] = await tx
    .select({ status: wmsTables.waybills.status })
    .from(wmsTables.waybills)
    .where(and(eq(wmsTables.waybills.id, attempt.waybillId), eq(wmsTables.waybills.shipmentId, cmd.shipmentId)))
    .limit(1);
  if (!waybill || waybill.status !== 'used') {
    throw conflict('SHIPMENT_RECALL_WAYBILL_NOT_USED', 'Active shipment waybill is not the used dispatch waybill');
  }

  const [quarantined] = await tx
    .update(wmsTables.dispatchAttempts)
    .set({ status: 'recovery_required', recoveryCode: 'DISPATCH_RECALL_PENDING', updatedAt: cmd.at })
    .where(and(eq(wmsTables.dispatchAttempts.id, attempt.id), eq(wmsTables.dispatchAttempts.status, 'dispatched')))
    .returning({ id: wmsTables.dispatchAttempts.id });
  if (!quarantined) throw conflict('SHIPMENT_RECALL_ATTEMPT_CHANGED', 'Dispatch attempt changed');
  await transitionShipments(tx, {
    shipmentIds: [shipment.id],
    from: ['shipped'],
    to: 'recovery_required',
    recoveryCode: 'DISPATCH_RECALL_PENDING',
    at: cmd.at,
    stale: () => conflict('SHIPMENT_RECALL_SHIPMENT_CHANGED', 'Shipment changed'),
  });
  await deps.voidUsedWaybill(shipment.id, tx);

  const lines = await tx
    .select()
    .from(wmsTables.shipmentLines)
    .where(eq(wmsTables.shipmentLines.shipmentId, shipment.id))
    .orderBy(asc(wmsTables.shipmentLines.id))
    .for('update');
  if (lines.length === 0) throw conflict('SHIPMENT_RECALL_QUANTITY_MISMATCH', 'Shipment has no lines');
  const fulfillmentOrderIds = new Set<string>();
  for (const line of lines) {
    const [item] = await tx
      .select()
      .from(wmsTables.fulfillmentOrderItems)
      .where(eq(wmsTables.fulfillmentOrderItems.id, line.fulfillmentOrderItemId))
      .limit(1)
      .for('update');
    if (!item || item.shippedQty < line.qty) {
      throw conflict('SHIPMENT_RECALL_FOI_PROGRESS_MISMATCH', `FOI ${line.fulfillmentOrderItemId} is not shipped`);
    }
    fulfillmentOrderIds.add(item.fulfillmentOrderId);
    await tx
      .update(wmsTables.fulfillmentOrderItems)
      .set({ shippedQty: item.shippedQty - line.qty, updatedAt: cmd.at })
      .where(eq(wmsTables.fulfillmentOrderItems.id, item.id));
  }

  const [updatedShipment] = await transitionShipments(tx, {
    shipmentIds: [shipment.id],
    from: ['recovery_required'],
    to: 'draft',
    expect: { recoveryCode: 'DISPATCH_RECALL_PENDING', manifestVersion: shipment.manifestVersion },
    at: cmd.at,
    stale: () => conflict('SHIPMENT_RECALL_SHIPMENT_CHANGED', 'Shipment changed during recall'),
  });
  const [recalledAttempt] = await tx
    .update(wmsTables.dispatchAttempts)
    .set({ status: 'recalled', recalledAt: cmd.at, recoveryCode: null, updatedAt: cmd.at })
    .where(
      and(
        eq(wmsTables.dispatchAttempts.id, attempt.id),
        eq(wmsTables.dispatchAttempts.status, 'recovery_required'),
        eq(wmsTables.dispatchAttempts.recoveryCode, 'DISPATCH_RECALL_PENDING'),
      ),
    )
    .returning();
  if (!recalledAttempt) throw conflict('SHIPMENT_RECALL_ATTEMPT_CHANGED', 'Dispatch attempt changed during recall');

  const orderIds = [...fulfillmentOrderIds].sort();
  await tx
    .update(wmsTables.fulfillmentOrders)
    .set({ shippedAt: null, updatedAt: cmd.at })
    .where(inArray(wmsTables.fulfillmentOrders.id, orderIds));
  await reprojectFulfillmentOrders(tx, orderIds, cmd.at);

  await deps.shipments.enqueue(
    shipmentDispatchRecalledOutboxEvent({
      shipmentId: shipment.id,
      dispatchAttemptId: attempt.id,
      attemptNo: attempt.attemptNo,
      recallOperationId: cmd.recallOperationId,
      recalledAt: cmd.at.toISOString(),
    } satisfies ShipmentDispatchRecalledPayload),
    tx,
  );
  const summaries = await loadFulfillmentSummaries(tx, lines);
  for (const summary of summaries) {
    if (summary.outstandingQty <= 0) {
      throw conflict('SHIPMENT_RECALL_FO_NOT_REOPENED', `FO ${summary.fulfillmentOrderId} has no demand to reopen`);
    }
    await deps.fulfillmentsV2.enqueue(
      fulfillmentReopenedOutboxEvent({
        fulfillmentOrderId: summary.fulfillmentOrderId,
        salesOrderId: summary.salesOrderId,
        dispatchAttemptId: attempt.id,
        recallOperationId: cmd.recallOperationId,
        reopenedAt: cmd.at.toISOString(),
        shippedQty: summary.shippedQty,
        canceledQty: summary.canceledQty,
        outstandingQty: summary.outstandingQty,
      } satisfies FulfillmentReopenedPayload),
      tx,
    );
  }
  return { attemptNo: attempt.attemptNo, shipment: updatedShipment, attempt: recalledAttempt, summaries };
}
