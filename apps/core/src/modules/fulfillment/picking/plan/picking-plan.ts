import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { acquireStockAvailabilityLock } from '../../../inventory/shared/locks/stock-availability-lock';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { WaybillService } from '../../waybill/waybill.service';
import {
  PickingPlanResult,
  PickingStartResult,
  PickingStrategyName,
  PlanPickingInput,
  StartPickingInput,
} from '../picking-strategy.interface';
import { conflict, errorMessage, isPlanValidationError } from './picking-plan.errors';
import {
  assertProfileComplete,
  assertRecipientComplete,
  invalidateDraftPlan,
  requiredIds,
} from './picking-plan.queries';
import {
  ACTIVE_WORK_ITEM_STATUSES,
  LockedAggregate,
  PickingPlanDeps,
  SourceCapacity,
  uniqueSorted,
} from './picking-plan.types';

/**
 * The picking plan layer, shared by every picking strategy.
 *
 * Measured before extraction: inside these bodies the strategy was consulted only for
 * `capabilities.name` (14 sites, zero capability branches), so a `strategyName` argument makes the
 * whole layer strategy-agnostic. See ADR-0030 for the diff measurements that drew this boundary —
 * and for the rule that nothing joins this module without a measured 3-strategy diff of 4 or less.
 */

// ---------------------------------------------------------------------------
// Layer 2 — one collaborator each, passed explicitly.
// ---------------------------------------------------------------------------

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
  // The following rows are re-read for strategy-specific identity and then batch -> plan -> source follows.
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
  // Match addShipment: recursive component/invoice -> batch/work items -> execution profile/SKU -> plan/source.
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

export async function assertPlanningEligibility(
  trx: DbTx,
  waybills: WaybillService,
  aggregate: LockedAggregate,
  requestedShipmentIds: string[],
): Promise<void> {
  const requested = requestedShipmentIds.join(',');
  const eligibleItems = aggregate.workItems.filter((item) =>
    (ACTIVE_WORK_ITEM_STATUSES as readonly string[]).includes(item.status),
  );
  if (uniqueSorted(eligibleItems.map((item) => item.shipmentId)).join(',') !== requested) {
    throw conflict(
      'PICKING_WORK_ITEM_MEMBERSHIP_MISMATCH',
      'Plan membership must exactly match queued/picking batch work items',
    );
  }
  if (
    aggregate.shipments.some(
      (shipment) => shipment.status !== 'planned' || shipment.warehouseId !== aggregate.batch.warehouseId,
    )
  ) {
    throw conflict('PICKING_SHIPMENT_NOT_ELIGIBLE', 'Every shipment must be planned in the batch warehouse');
  }
  if (!aggregate.lines.length) throw conflict('PICKING_PLAN_EMPTY', 'Picking plan has no shipment lines');
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
    await waybills.assertDispatchable(shipment.id, trx);
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
}

export async function lockSourceCapacities(
  trx: DbTx,
  controlledStock: BatchControlledStockGuard,
  aggregate: LockedAggregate,
): Promise<SourceCapacity[]> {
  const skuIds = uniqueSorted(aggregate.lines.map((line) => line.skuId));
  for (const skuId of skuIds) {
    await acquireStockAvailabilityLock(trx, skuId, aggregate.batch.warehouseId);
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
        eq(wmsTables.stockLedgers.warehouseId, aggregate.batch.warehouseId),
        eq(wmsTables.stockLedgers.stockState, 'ON_HAND'),
      ),
    )
    .orderBy(asc(wmsTables.stockLedgers.skuId), asc(wmsTables.stockLedgers.locationId))
    .for('update');
  const capacities: SourceCapacity[] = [];
  for (const ledger of ledgers) {
    const availability = await controlledStock.getAvailability(
      {
        skuId: ledger.skuId,
        warehouseId: aggregate.batch.warehouseId,
        sourceLocationId: ledger.locationId,
      },
      trx,
    );
    if (availability.stockVersion !== ledger.version) {
      throw conflict('PICKING_SOURCE_STALE', 'Source stock changed while locking capacity');
    }
    if (availability.generallyAvailableQty > 0) {
      capacities.push({
        skuId: ledger.skuId,
        sourceLocationId: ledger.locationId,
        stockVersion: ledger.version,
        remainingQty: availability.generallyAvailableQty,
      });
    }
  }
  return capacities;
}

export async function planStalenessReason(
  trx: DbTx,
  controlledStock: BatchControlledStockGuard,
  planId: string,
  aggregate: LockedAggregate,
  strategyName: PickingStrategyName,
): Promise<string | null> {
  const [plan] = await trx
    .select()
    .from(wmsTables.pickingPlans)
    .where(eq(wmsTables.pickingPlans.id, planId))
    .limit(1)
    .for('update');
  if (!plan || plan.batchId !== aggregate.batch.id || plan.strategy !== strategyName) {
    return `Picking plan identity no longer matches the ${strategyName} batch`;
  }
  if (plan.status !== 'draft') return `Picking plan is ${plan.status}`;
  const members = await trx
    .select()
    .from(wmsTables.pickingPlanMembers)
    .where(and(eq(wmsTables.pickingPlanMembers.planId, planId), isNull(wmsTables.pickingPlanMembers.retiredAt)))
    .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId))
    .for('update');
  const shipmentById = new Map(aggregate.shipments.map((shipment) => [shipment.id, shipment]));
  if (
    members.length !== aggregate.shipments.length ||
    members.some((member) => {
      const shipment = shipmentById.get(member.shipmentId);
      return (
        !shipment ||
        member.manifestVersion !== shipment.manifestVersion ||
        member.reservationVersion !== shipment.reservationVersion
      );
    })
  ) {
    return 'Shipment membership, manifest version, or reservation version changed after planning';
  }

  const allocations = await trx
    .select({
      id: wmsTables.pickingSourceAllocations.id,
      shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
      sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
      qty: wmsTables.pickingSourceAllocations.qty,
      sourceStockVersion: wmsTables.pickingSourceAllocations.sourceStockVersion,
      skuId: wmsTables.shipmentLines.skuId,
    })
    .from(wmsTables.pickingSourceAllocations)
    .innerJoin(
      wmsTables.shipmentLines,
      eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
    )
    .where(eq(wmsTables.pickingSourceAllocations.planId, planId))
    .orderBy(
      asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      asc(wmsTables.pickingSourceAllocations.shipmentLineId),
      asc(wmsTables.pickingSourceAllocations.id),
    )
    .for('update');
  const allocationByLine = new Map<string, number>();
  const sourceGroups = new Map<
    string,
    { skuId: string; sourceLocationId: string; stockVersion: number; qty: number }
  >();
  for (const allocation of allocations) {
    allocationByLine.set(
      allocation.shipmentLineId,
      (allocationByLine.get(allocation.shipmentLineId) ?? 0) + allocation.qty,
    );
    const key = `${allocation.skuId}|${allocation.sourceLocationId}`;
    const existing = sourceGroups.get(key);
    if (existing && existing.stockVersion !== allocation.sourceStockVersion) {
      return `Source snapshot versions disagree for ${key}`;
    }
    sourceGroups.set(key, {
      skuId: allocation.skuId,
      sourceLocationId: allocation.sourceLocationId,
      stockVersion: allocation.sourceStockVersion,
      qty: (existing?.qty ?? 0) + allocation.qty,
    });
  }
  if (
    allocations.length === 0 ||
    aggregate.lines.some((line) => allocationByLine.get(line.id) !== line.qty) ||
    [...allocationByLine.keys()].some((lineId) => !aggregate.lines.some((line) => line.id === lineId))
  ) {
    return 'Picking source allocation no longer exactly covers the shipment lines';
  }

  const sources = [...sourceGroups.values()].sort((left, right) =>
    `${left.skuId}|${left.sourceLocationId}`.localeCompare(`${right.skuId}|${right.sourceLocationId}`),
  );
  for (const skuId of uniqueSorted(sources.map((source) => source.skuId))) {
    await acquireStockAvailabilityLock(trx, skuId, aggregate.batch.warehouseId);
  }
  for (const source of sources) {
    const availability = await controlledStock.getAvailability(
      {
        skuId: source.skuId,
        warehouseId: aggregate.batch.warehouseId,
        sourceLocationId: source.sourceLocationId,
      },
      trx,
      { lock: true },
    );
    if (availability.stockVersion !== source.stockVersion || availability.generallyAvailableQty < source.qty) {
      return `Source ${source.skuId}/${source.sourceLocationId} changed after planning`;
    }
  }
  return null;
}

/**
 * Second warehouse check, reached only after `PickingStrategyRegistry.resolveForWarehouse` has
 * already made the same assertion with a different error code. ADR-0030 §3.5 retires this in a
 * separate, independently revertable commit because it is a behaviour change, not a pure move.
 */
export async function assertWarehouseConfiguration(
  trx: DbTx,
  warehouseId: string,
  strategyName: PickingStrategyName,
): Promise<void> {
  const [warehouse] = await trx
    .select({ supportedPickingStrategies: wmsTables.warehouses.supportedPickingStrategies })
    .from(wmsTables.warehouses)
    .where(eq(wmsTables.warehouses.id, warehouseId))
    .limit(1);
  if (!warehouse) throw new NotFoundException(`Warehouse ${warehouseId} not found`);
  if (!warehouse.supportedPickingStrategies?.includes(strategyName)) {
    throw conflict(
      'PICKING_STRATEGY_NOT_CONFIGURED',
      `Warehouse ${warehouseId} does not explicitly enable ${strategyName}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Entry points — the only functions that take the whole dependency bundle.
// ---------------------------------------------------------------------------

export async function planPicking(
  deps: PickingPlanDeps,
  strategyName: PickingStrategyName,
  input: PlanPickingInput,
  tx?: DbTx,
): Promise<PickingPlanResult> {
  const commandType = `picking.${strategyName}.plan`;
  deps.workflowGate.assertV2MutationAllowed(commandType);
  const shipmentIds = requiredIds('shipmentIds', input.shipmentIds);
  return deps.commands.execute<PickingPlanResult>(
    {
      commandType,
      idempotencyKey: input.idempotencyKey,
      canonicalRequest: {
        strategy: strategyName,
        batchId: input.batchId,
        shipmentIds,
        actorId: input.actorId,
      },
    },
    async (trx, commandRequestId) => {
      const optimisticOpenPlans = await trx
        .select({ id: wmsTables.pickingPlans.id, status: wmsTables.pickingPlans.status })
        .from(wmsTables.pickingPlans)
        .where(
          and(
            eq(wmsTables.pickingPlans.batchId, input.batchId),
            inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
          ),
        )
        .orderBy(asc(wmsTables.pickingPlans.id));
      if (optimisticOpenPlans.length > 1) {
        throw conflict('PICKING_PLAN_OPEN_STATE_CORRUPT', `Batch ${input.batchId} has multiple open plans`);
      }
      if (optimisticOpenPlans[0]?.status === 'active') {
        throw conflict('PICKING_PLAN_ALREADY_ACTIVE', `Batch ${input.batchId} already has an active plan`);
      }
      const optimisticDraftId = optimisticOpenPlans[0]?.status === 'draft' ? optimisticOpenPlans[0].id : undefined;
      let aggregateShipmentIds = shipmentIds;
      if (optimisticDraftId) {
        const storedMembers = await trx
          .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
          .from(wmsTables.pickingPlanMembers)
          .where(
            and(
              eq(wmsTables.pickingPlanMembers.planId, optimisticDraftId),
              isNull(wmsTables.pickingPlanMembers.retiredAt),
            ),
          )
          .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId));
        const storedShipmentIds = storedMembers.map((member) => member.shipmentId);
        if (storedShipmentIds.join(',') !== shipmentIds.join(',')) {
          throw conflict(
            'PICKING_PLAN_REQUEST_MEMBERSHIP_MISMATCH',
            'Requested shipments do not match the existing draft plan membership',
          );
        }
        aggregateShipmentIds = storedShipmentIds;
      }
      let aggregate: LockedAggregate;
      try {
        aggregate = await lockAggregate(trx, deps.invariant, input.batchId, aggregateShipmentIds);
      } catch (error) {
        if (!optimisticDraftId || !isPlanValidationError(error)) throw error;
        const response = await invalidateDraftPlan(
          trx,
          optimisticDraftId,
          input.batchId,
          errorMessage(error),
          commandRequestId,
        );
        return { response, resourceType: 'picking_plan', resourceId: optimisticDraftId };
      }

      const openPlans = await trx
        .select()
        .from(wmsTables.pickingPlans)
        .where(
          and(
            eq(wmsTables.pickingPlans.batchId, input.batchId),
            inArray(wmsTables.pickingPlans.status, ['draft', 'active']),
          ),
        )
        .orderBy(asc(wmsTables.pickingPlans.id))
        .for('update');
      if (openPlans.length > 1) {
        throw conflict('PICKING_PLAN_OPEN_STATE_CORRUPT', `Batch ${input.batchId} has multiple open plans`);
      }
      const openPlan = openPlans[0];
      if (openPlan?.status === 'active') {
        throw conflict('PICKING_PLAN_ALREADY_ACTIVE', `Batch ${input.batchId} already has an active plan`);
      }
      if (openPlan?.status === 'draft') {
        const lockedMembers = await trx
          .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
          .from(wmsTables.pickingPlanMembers)
          .where(
            and(eq(wmsTables.pickingPlanMembers.planId, openPlan.id), isNull(wmsTables.pickingPlanMembers.retiredAt)),
          )
          .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId))
          .for('update');
        const storedShipmentIds = lockedMembers.map((member) => member.shipmentId);
        if (storedShipmentIds.join(',') !== shipmentIds.join(',')) {
          throw conflict(
            'PICKING_PLAN_REQUEST_MEMBERSHIP_MISMATCH',
            'Requested shipments do not match the locked draft plan membership',
          );
        }
        let staleReason: string | null = null;
        try {
          await assertWarehouseConfiguration(trx, aggregate.batch.warehouseId, strategyName);
          await assertPlanningEligibility(trx, deps.waybills, aggregate, storedShipmentIds);
          staleReason = await planStalenessReason(trx, deps.controlledStock, openPlan.id, aggregate, strategyName);
        } catch (error) {
          if (!isPlanValidationError(error)) throw error;
          staleReason = errorMessage(error);
        }
        if (!staleReason) {
          const [allocationSummary] = await trx
            .select({
              count: sql<number>`count(*)::int`,
              totalQty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int`,
            })
            .from(wmsTables.pickingSourceAllocations)
            .where(eq(wmsTables.pickingSourceAllocations.planId, openPlan.id));
          const members = await trx
            .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
            .from(wmsTables.pickingPlanMembers)
            .where(
              and(eq(wmsTables.pickingPlanMembers.planId, openPlan.id), isNull(wmsTables.pickingPlanMembers.retiredAt)),
            )
            .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId));
          const response: PickingPlanResult = {
            state: 'planned',
            operationId: commandRequestId,
            planId: openPlan.id,
            batchId: input.batchId,
            strategy: strategyName,
            version: openPlan.version,
            shipmentIds: members.map((member) => member.shipmentId),
            allocationCount: Number(allocationSummary?.count ?? 0),
            totalQty: Number(allocationSummary?.totalQty ?? 0),
          };
          return { response, resourceType: 'picking_plan', resourceId: openPlan.id };
        }
        const response = await invalidateDraftPlan(trx, openPlan.id, input.batchId, staleReason, commandRequestId);
        return { response, resourceType: 'picking_plan', resourceId: openPlan.id };
      }

      await assertWarehouseConfiguration(trx, aggregate.batch.warehouseId, strategyName);
      await assertPlanningEligibility(trx, deps.waybills, aggregate, shipmentIds);

      const capacities = await lockSourceCapacities(trx, deps.controlledStock, aggregate);
      const allocations: Array<{
        shipmentLineId: string;
        sourceLocationId: string;
        qty: number;
        sourceStockVersion: number;
      }> = [];
      for (const line of [...aggregate.lines].sort((left, right) => left.id.localeCompare(right.id))) {
        let remaining = line.qty;
        const sources = capacities
          .filter((source) => source.skuId === line.skuId && source.remainingQty > 0)
          .sort((left, right) => left.sourceLocationId.localeCompare(right.sourceLocationId));
        for (const source of sources) {
          if (remaining === 0) break;
          const quantity = Math.min(remaining, source.remainingQty);
          allocations.push({
            shipmentLineId: line.id,
            sourceLocationId: source.sourceLocationId,
            qty: quantity,
            sourceStockVersion: source.stockVersion,
          });
          source.remainingQty -= quantity;
          remaining -= quantity;
        }
        if (remaining > 0) {
          throw conflict(
            'PICKING_SOURCE_INSUFFICIENT',
            `Generally available source stock is short by ${remaining} for shipment line ${line.id}`,
          );
        }
      }

      const [versionRow] = await trx
        .select({ version: sql<number>`coalesce(max(${wmsTables.pickingPlans.version}), 0)::int` })
        .from(wmsTables.pickingPlans)
        .where(eq(wmsTables.pickingPlans.batchId, input.batchId));
      const version = Number(versionRow?.version ?? 0) + 1;
      const [plan] = await trx
        .insert(wmsTables.pickingPlans)
        .values({
          batchId: input.batchId,
          strategy: strategyName,
          version,
          createdBy: input.actorId,
        })
        .returning();
      const shipmentById = new Map(aggregate.shipments.map((shipment) => [shipment.id, shipment]));
      await trx.insert(wmsTables.pickingPlanMembers).values(
        shipmentIds.map((shipmentId) => {
          const shipment = shipmentById.get(shipmentId)!;
          return {
            planId: plan.id,
            shipmentId,
            manifestVersion: shipment.manifestVersion,
            reservationVersion: shipment.reservationVersion,
          };
        }),
      );
      await trx
        .insert(wmsTables.pickingSourceAllocations)
        .values(allocations.map((allocation) => ({ planId: plan.id, ...allocation })));
      const response: PickingPlanResult = {
        state: 'planned',
        operationId: commandRequestId,
        planId: plan.id,
        batchId: input.batchId,
        strategy: strategyName,
        version,
        shipmentIds,
        allocationCount: allocations.length,
        totalQty: allocations.reduce((total, allocation) => total + allocation.qty, 0),
      };
      return { response, resourceType: 'picking_plan', resourceId: plan.id };
    },
    tx,
  );
}

export async function startPicking(
  deps: PickingPlanDeps,
  strategyName: PickingStrategyName,
  input: StartPickingInput,
  tx?: DbTx,
): Promise<PickingStartResult> {
  const commandType = `picking.${strategyName}.start`;
  deps.workflowGate.assertV2MutationAllowed(commandType);
  return deps.commands.execute<PickingStartResult>(
    {
      commandType,
      idempotencyKey: input.idempotencyKey,
      canonicalRequest: {
        strategy: strategyName,
        batchId: input.batchId,
        planId: input.planId,
        actorId: input.actorId,
      },
    },
    async (trx, commandRequestId) => {
      const [identity] = await trx
        .select({ status: wmsTables.pickingPlans.status, strategy: wmsTables.pickingPlans.strategy })
        .from(wmsTables.pickingPlans)
        .where(and(eq(wmsTables.pickingPlans.id, input.planId), eq(wmsTables.pickingPlans.batchId, input.batchId)))
        .limit(1);
      if (!identity) throw new NotFoundException(`Picking plan ${input.planId} not found`);
      if (identity.strategy !== strategyName) {
        throw conflict('PICKING_STRATEGY_MISMATCH', `Picking plan ${input.planId} is ${identity.strategy}`);
      }

      if (identity.status === 'active') {
        const session = await deps.sessions.startSession(input.batchId, input.planId, trx, input.actorId);
        const response: PickingStartResult = {
          state: 'started',
          operationId: commandRequestId,
          planId: input.planId,
          sessionId: session.id,
          batchId: input.batchId,
          status: session.status,
        };
        return { response, resourceType: 'batch_inventory_session', resourceId: session.id };
      }
      if (identity.status !== 'draft') {
        throw conflict('PICKING_PLAN_NOT_STARTABLE', `Picking plan ${input.planId} is ${identity.status}`);
      }

      const memberRows = await trx
        .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
        .from(wmsTables.pickingPlanMembers)
        .where(
          and(eq(wmsTables.pickingPlanMembers.planId, input.planId), isNull(wmsTables.pickingPlanMembers.retiredAt)),
        );
      const shipmentIds = uniqueSorted(memberRows.map((member) => member.shipmentId));
      let invalidationReason: string | null = null;
      try {
        const aggregate = await lockAggregate(trx, deps.invariant, input.batchId, shipmentIds);
        await assertWarehouseConfiguration(trx, aggregate.batch.warehouseId, strategyName);
        await assertPlanningEligibility(trx, deps.waybills, aggregate, shipmentIds);
        invalidationReason = await planStalenessReason(
          trx,
          deps.controlledStock,
          input.planId,
          aggregate,
          strategyName,
        );
      } catch (error) {
        if (!isPlanValidationError(error)) throw error;
        invalidationReason = errorMessage(error);
      }

      if (invalidationReason) {
        const [invalidated] = await trx
          .update(wmsTables.pickingPlans)
          .set({
            status: 'invalidated',
            invalidatedAt: sql`now()`,
            invalidationReason,
            updatedAt: sql`now()`,
          })
          .where(and(eq(wmsTables.pickingPlans.id, input.planId), eq(wmsTables.pickingPlans.status, 'draft')))
          .returning({ id: wmsTables.pickingPlans.id });
        if (!invalidated) {
          throw conflict('PICKING_PLAN_STALE_VERSION', `Picking plan ${input.planId} changed while invalidating`);
        }
        const response: PickingStartResult = {
          state: 'invalidated',
          operationId: commandRequestId,
          planId: input.planId,
          batchId: input.batchId,
          reason: invalidationReason,
        };
        return { response, resourceType: 'picking_plan', resourceId: input.planId };
      }

      const session = await deps.sessions.startSession(input.batchId, input.planId, trx, input.actorId);
      const response: PickingStartResult = {
        state: 'started',
        operationId: commandRequestId,
        planId: input.planId,
        sessionId: session.id,
        batchId: input.batchId,
        status: session.status,
      };
      return { response, resourceType: 'batch_inventory_session', resourceId: session.id };
    },
    tx,
  );
}
