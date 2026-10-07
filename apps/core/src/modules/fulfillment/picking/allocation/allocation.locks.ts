import { ConflictError } from '@app/shared';
import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { acquireStockAvailabilityLock } from '../../../inventory/shared/locks/stock-availability-lock';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { WAYBILL_TERMINAL_STATUSES } from '../../waybill/waybill.constants';
import { WaybillService } from '../../waybill/waybill.service';
import { isCancelRequestedError } from '../../hold/cancel-request-hold';
import { conflict } from './allocation.errors';
import { assertProfileComplete, assertRecipientComplete } from './allocation.queries';
import {
  LockedAggregate,
  SourceCapacity,
  StartBlocker,
  StartBlockerView,
  StartBlockReason,
  UNSTARTED_BATCH_WORK_ITEM_STATUSES,
  uniqueSorted,
} from './allocation.types';

/**
 * Layer 2 — each function takes exactly the one collaborator it needs, passed explicitly.
 *
 * These live apart from the `startBatchPicking` entry point on purpose: a test that
 * wants to drive the entry point against a fake `trx` has to be able to substitute the locking
 * and eligibility steps, and an intra-module call cannot be substituted.
 */

export async function lockAggregate(
  trx: DbTx,
  invariant: FulfillmentInvariantService,
  batchId: string,
  requestedShipmentIds: string[],
): Promise<LockedAggregate> {
  const initialLines = await trx
    .select({
      id: wmsTables.shipmentLines.id,
      shipmentId: wmsTables.shipmentLines.shipmentId,
      fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
      fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
    })
    .from(wmsTables.shipmentLines)
    .innerJoin(
      wmsTables.fulfillmentOrderItems,
      eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
    )
    .where(inArray(wmsTables.shipmentLines.shipmentId, requestedShipmentIds))
    .orderBy(asc(wmsTables.shipmentLines.id));
  if (!initialLines.length) throw new NotFoundException('Requested shipments have no lines');
  const fulfillmentOrderIds = uniqueSorted(initialLines.map((line) => line.fulfillmentOrderId));
  await invariant.assertFulfillmentOrders(fulfillmentOrderIds, trx);

  // The invariant owns the recursive FOI -> shipment -> line -> reservation -> invoice/work/session locks.
  // The following rows are re-read for strategy-specific identity, then batch -> work items -> profile/SKU follow;
  // source ledgers are locked last, by `lockSourceCapacities`.
  const shipments = await trx
    .select()
    .from(wmsTables.shipments)
    .where(inArray(wmsTables.shipments.id, requestedShipmentIds))
    .orderBy(asc(wmsTables.shipments.id))
    .for('update');
  const requestedLines = await trx
    .select()
    .from(wmsTables.shipmentLines)
    .where(inArray(wmsTables.shipmentLines.shipmentId, requestedShipmentIds))
    .orderBy(asc(wmsTables.shipmentLines.id))
    .for('update');
  if (shipments.length !== requestedShipmentIds.length) {
    throw new NotFoundException('One or more requested shipments do not exist in the locked component');
  }
  const profileIds = uniqueSorted(
    shipments.flatMap((shipment) => (shipment.shippingProfileId ? [shipment.shippingProfileId] : [])),
  );
  const skuIds = uniqueSorted(requestedLines.map((line) => line.skuId));
  const [batch] = await trx
    .select()
    .from(wmsTables.outboundBatches)
    .where(eq(wmsTables.outboundBatches.id, batchId))
    .limit(1)
    .for('update');
  if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
  const workItems = await trx
    .select()
    .from(wmsTables.outboundBatchWorkItems)
    .where(
      and(
        eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
        inArray(wmsTables.outboundBatchWorkItems.status, [
          'queued',
          'picking',
          'ready_to_pack',
          'packing',
          'short_pick_recovery',
        ]),
      ),
    )
    .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
    .for('update');
  // Match addShipment: recursive component/invoice -> batch/work items -> execution profile/SKU -> source ledgers.
  if (profileIds.length) {
    await trx
      .select({ id: wmsTables.deliveryProfiles.id })
      .from(wmsTables.deliveryProfiles)
      .where(inArray(wmsTables.deliveryProfiles.id, profileIds))
      .orderBy(asc(wmsTables.deliveryProfiles.id))
      .for('update');
  }
  await trx
    .select({ id: wmsTables.skus.id })
    .from(wmsTables.skus)
    .where(inArray(wmsTables.skus.id, skuIds))
    .orderBy(asc(wmsTables.skus.id))
    .for('update');

  const finalIdentity = await trx
    .select({ id: wmsTables.shipmentLines.id, shipmentId: wmsTables.shipmentLines.shipmentId })
    .from(wmsTables.shipmentLines)
    .where(inArray(wmsTables.shipmentLines.shipmentId, requestedShipmentIds))
    .orderBy(asc(wmsTables.shipmentLines.id));
  const signature = (rows: Array<{ id: string; shipmentId: string }>) =>
    rows
      .map((row) => `${row.id}:${row.shipmentId}`)
      .sort()
      .join(',');
  if (signature(initialLines) !== signature(finalIdentity) || signature(initialLines) !== signature(requestedLines)) {
    throw conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Shipment component changed while planning');
  }

  const enrichedLines = await trx
    .select({
      id: wmsTables.shipmentLines.id,
      shipmentId: wmsTables.shipmentLines.shipmentId,
      fulfillmentOrderItemId: wmsTables.shipmentLines.fulfillmentOrderItemId,
      fulfillmentOrderId: wmsTables.fulfillmentOrderItems.fulfillmentOrderId,
      skuId: wmsTables.shipmentLines.skuId,
      qty: wmsTables.shipmentLines.qty,
      reservedQty: wmsTables.shipmentLines.reservedQty,
      inspectedQty: wmsTables.shipmentLines.inspectedQty,
      fulfillmentMode: wmsTables.fulfillmentOrders.fulfillmentMode,
      stockType: wmsTables.skus.stockType,
      skuDeliveryProfileId: wmsTables.skus.deliveryProfileId,
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
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .where(inArray(wmsTables.shipmentLines.shipmentId, requestedShipmentIds))
    .orderBy(asc(wmsTables.shipmentLines.id));
  return { batch, shipments, lines: enrichedLines, workItems };
}

export async function assertStartEligibility(
  trx: DbTx,
  waybills: WaybillService,
  aggregate: LockedAggregate,
  requestedShipmentIds: string[],
): Promise<StartBlocker[]> {
  const blockers: StartBlocker[] = [];
  const requested = requestedShipmentIds.join(',');
  const isStartable = (item: { status: string }) =>
    (UNSTARTED_BATCH_WORK_ITEM_STATUSES as readonly string[]).includes(item.status);
  const startable = aggregate.workItems.filter(isStartable);
  if (uniqueSorted(startable.map((item) => item.shipmentId)).join(',') !== requested) {
    throw conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Startable batch work items changed while starting');
  }
  if (!aggregate.workItems.every(isStartable)) {
    // 시작 전 배치의 작업 항목은 queued·picking 뿐이어야 한다. 그 너머는 계획 흡수 전의 흔적이거나 손상이다.
    throw conflict('PICKING_BATCH_STATE_CORRUPT', 'An unstarted batch has work items beyond picking');
  }
  if (
    aggregate.shipments.some(
      (shipment) => shipment.status !== 'planned' || shipment.warehouseId !== aggregate.batch.warehouseId,
    )
  ) {
    throw conflict('PICKING_SHIPMENT_NOT_ELIGIBLE', 'Every shipment must be planned in the batch warehouse');
  }
  if (!aggregate.lines.length) throw conflict('PICKING_BATCH_EMPTY', 'Batch has no shipment lines');
  for (const shipment of aggregate.shipments) {
    if (!shipment.shippingProfileId) {
      throw conflict('SHIPMENT_PROFILE_REQUIRED', `Shipment ${shipment.id} has no shipping profile`);
    }
    assertRecipientComplete(shipment.recipientSnapshot);
    const [profile] = await trx
      .select()
      .from(wmsTables.deliveryProfiles)
      .where(eq(wmsTables.deliveryProfiles.id, shipment.shippingProfileId))
      .limit(1);
    if (!profile) throw new NotFoundException(`Shipping profile ${shipment.shippingProfileId} not found`);
    assertProfileComplete(profile);
    const shipmentLines = aggregate.lines.filter((line) => line.shipmentId === shipment.id);
    const modes = uniqueSorted(shipmentLines.map((line) => line.fulfillmentMode ?? 'in_house'));
    if (
      !profile.supportedFulfillmentModes ||
      modes.some((mode) => !profile.supportedFulfillmentModes!.includes(mode as never))
    ) {
      throw conflict('SHIPMENT_PROFILE_INCOMPATIBLE', 'Shipping profile does not support fulfillment mode');
    }
    if (
      shipmentLines.some(
        (line) =>
          line.stockType === 'drop_shipped' ||
          line.fulfillmentMode === 'drop_ship' ||
          line.skuDeliveryProfileId !== shipment.shippingProfileId ||
          line.reservedQty !== line.qty ||
          line.inspectedQty !== 0,
      )
    ) {
      throw conflict(
        'PICKING_SHIPMENT_NOT_ELIGIBLE',
        `Shipment ${shipment.id} must contain only uninspected, fully reserved physical lines`,
      );
    }
    try {
      await waybills.assertDispatchable(shipment.id, trx);
    } catch (error) {
      // 송장 문제는 박스 사유로 모은다(스펙 §6 WAYBILL_NOT_READY). 인증·SQL 오류는 그대로 샌다.
      if (!(error instanceof ConflictError)) throw error;
      blockers.push(dispatchBlocker(shipment.id, error));
    }
  }
  const lineIds = aggregate.lines.map((line) => line.id);
  const reservations = await trx
    .select({
      shipmentLineId: wmsTables.stockReservations.shipmentLineId,
      skuId: wmsTables.stockReservations.skuId,
      warehouseId: wmsTables.stockReservations.warehouseId,
      qty: wmsTables.stockReservations.quantity,
    })
    .from(wmsTables.stockReservations)
    .where(
      and(
        inArray(wmsTables.stockReservations.shipmentLineId, lineIds),
        eq(wmsTables.stockReservations.status, 'confirmed'),
        isNull(wmsTables.stockReservations.invalidatedAt),
      ),
    );
  const reservedByLine = new Map<string, number>();
  const lineById = new Map(aggregate.lines.map((line) => [line.id, line]));
  for (const reservation of reservations) {
    const line = reservation.shipmentLineId ? lineById.get(reservation.shipmentLineId) : undefined;
    if (!line || reservation.skuId !== line.skuId || reservation.warehouseId !== aggregate.batch.warehouseId) {
      throw conflict('PICKING_RESERVATION_MISMATCH', 'Reservation identity does not match shipment line');
    }
    reservedByLine.set(line.id, (reservedByLine.get(line.id) ?? 0) + reservation.qty);
  }
  if (aggregate.lines.some((line) => reservedByLine.get(line.id) !== line.qty)) {
    throw conflict('PICKING_RESERVATION_MISMATCH', 'Every shipment line must remain fully reserved');
  }
  return blockers;
}

export async function lockSourceCapacities(
  trx: DbTx,
  controlledStock: BatchControlledStockGuard,
  aggregate: LockedAggregate,
): Promise<{ capacities: SourceCapacity[]; inboundPendingBySku: Map<string, number> }> {
  return lockSkuCapacities(
    trx,
    controlledStock,
    aggregate.batch.warehouseId,
    aggregate.lines.map((line) => line.skuId),
  );
}

/**
 * 한 창고의 SKU 들에 대해 가용 잠금 → ON_HAND 원장 잠금 → 로케이션별 일반 가용(세션 통제·적치 대기 제외).
 * 배치 시작(`lockSourceCapacities`)과 합류(`BoxAllocationManager.planJoin`)가 같이 쓴다.
 */
export async function lockSkuCapacities(
  trx: DbTx,
  controlledStock: BatchControlledStockGuard,
  warehouseId: string,
  requestedSkuIds: readonly string[],
): Promise<{ capacities: SourceCapacity[]; inboundPendingBySku: Map<string, number> }> {
  const skuIds = uniqueSorted(requestedSkuIds);
  for (const skuId of skuIds) {
    await acquireStockAvailabilityLock(trx, skuId, warehouseId);
  }
  const ledgers = await trx
    .select({
      skuId: wmsTables.stockLedgers.skuId,
      locationId: wmsTables.stockLedgers.locationId,
      version: wmsTables.stockLedgers.version,
    })
    .from(wmsTables.stockLedgers)
    .where(
      and(
        inArray(wmsTables.stockLedgers.skuId, skuIds),
        eq(wmsTables.stockLedgers.warehouseId, warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    )
    .orderBy(asc(wmsTables.stockLedgers.skuId), asc(wmsTables.stockLedgers.locationId))
    .for('update');
  // 코드는 잠그지 않고 따로 읽는다 — 원장 조회에 조인하면 FOR UPDATE 가 locations 행까지 잠근다.
  const locationIds = uniqueSorted(ledgers.map((ledger) => ledger.locationId));
  const codes = locationIds.length
    ? await trx
        .select({ id: wmsTables.locations.id, code: wmsTables.locations.code })
        .from(wmsTables.locations)
        .where(inArray(wmsTables.locations.id, locationIds))
    : [];
  const codeById = new Map(codes.map((row) => [row.id, row.code]));
  const capacities: SourceCapacity[] = [];
  const inboundPendingBySku = new Map<string, number>();
  for (const ledger of ledgers) {
    const availability = await controlledStock.getAvailability(
      {
        skuId: ledger.skuId,
        warehouseId: warehouseId,
        sourceLocationId: ledger.locationId,
      },
      trx,
    );
    if (availability.stockVersion !== ledger.version) {
      throw conflict('PICKING_SOURCE_STALE', 'Source stock changed while locking capacity');
    }
    inboundPendingBySku.set(
      ledger.skuId,
      (inboundPendingBySku.get(ledger.skuId) ?? 0) + availability.inboundPendingQty,
    );
    if (availability.generallyAvailableQty > 0) {
      capacities.push({
        skuId: ledger.skuId,
        sourceLocationId: ledger.locationId,
        // holds because locations.id is the FK target of stock_ledgers.location_id (restrict), read in the same tx.
        locationCode: codeById.get(ledger.locationId)!,
        stockVersion: ledger.version,
        remainingQty: availability.generallyAvailableQty,
      });
    }
  }
  return { capacities, inboundPendingBySku };
}

/**
 * 차단 목록에 현장이 읽을 이름을 붙이고 정렬한다(박스 → 사유 → 줄). 잠그지 않는다 — 거절 직전의 설명일 뿐이다.
 */
export async function describeStartBlockers(trx: DbTx, blockers: StartBlocker[]): Promise<StartBlockerView[]> {
  const skuIds = uniqueSorted(blockers.flatMap((blocker) => (blocker.skuId ? [blocker.skuId] : [])));
  const shipmentIds = uniqueSorted(blockers.map((blocker) => blocker.shipmentId));
  const skus = skuIds.length
    ? await trx
        .select({ id: wmsTables.skus.id, code: wmsTables.skus.code, name: wmsTables.skus.name })
        .from(wmsTables.skus)
        .where(inArray(wmsTables.skus.id, skuIds))
    : [];
  const waybills = await trx
    .select({ shipmentId: wmsTables.waybills.shipmentId, trackingNo: wmsTables.waybills.trackingNo })
    .from(wmsTables.waybills)
    .where(
      and(
        inArray(wmsTables.waybills.shipmentId, shipmentIds),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    );
  const skuById = new Map(skus.map((sku) => [sku.id, sku]));
  const trackingByShipment = new Map(waybills.map((row) => [row.shipmentId, row.trackingNo]));
  const order: Record<StartBlockReason, number> = {
    INBOUND_PENDING: 0,
    STOCK_SHORT: 1,
    WAYBILL_NOT_READY: 2,
    CANCEL_REQUESTED: 3,
  };
  return blockers
    .map((blocker) => ({
      ...blocker,
      trackingNo: trackingByShipment.get(blocker.shipmentId) ?? null,
      skuCode: blocker.skuId ? (skuById.get(blocker.skuId)?.code ?? null) : null,
      skuName: blocker.skuId ? (skuById.get(blocker.skuId)?.name ?? null) : null,
    }))
    .sort(
      (left, right) =>
        left.shipmentId.localeCompare(right.shipmentId) ||
        order[left.reason] - order[right.reason] ||
        (left.shipmentLineId ?? '').localeCompare(right.shipmentLineId ?? ''),
    );
}

/**
 * `assertDispatchable` 의 거절을 박스 사유로 바꾼다. 출고 보류(취소 요청, #1016 35번)는 송장 문제가 아니다 —
 * `WAYBILL_NOT_READY` 에 섞으면 현장이 «송장 재발급»으로 읽는다.
 */
export function dispatchBlocker(shipmentId: string, error: ConflictError): StartBlocker {
  return {
    shipmentId,
    reason: isCancelRequestedError(error) ? 'CANCEL_REQUESTED' : 'WAYBILL_NOT_READY',
    shipmentLineId: null,
    skuId: null,
    requiredQty: null,
    shortQty: null,
    detail: error.message,
  };
}
