import { NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import {
  PickingPlanResult,
  PickingStartResult,
  PickingStrategyName,
  PlanPickingInput,
  StartPickingInput,
} from '../picking-strategy.interface';
import { conflict, errorMessage, isPlanValidationError } from './picking-plan.errors';
import {
  assertPlanningEligibility,
  assertWarehouseConfiguration,
  lockAggregate,
  lockSourceCapacities,
  planStalenessReason,
} from './picking-plan.locks';
import { invalidateDraftPlan, requiredIds } from './picking-plan.queries';
import { LockedAggregate, PickingPlanDeps, uniqueSorted } from './picking-plan.types';

/**
 * The picking plan layer, shared by every picking strategy.
 *
 * Measured before extraction: inside these bodies the strategy was consulted only for
 * `capabilities.name` (14 sites, zero capability branches), so a `strategyName` argument makes the
 * whole layer strategy-agnostic. See ADR-0030 for the diff measurements that drew this boundary —
 * and for the rule that nothing joins this module without a measured 3-strategy diff of 4 or less.
 *
 * This file holds only the two entry points; layer 1 lives in `picking-plan.queries.ts` and
 * layer 2 in `picking-plan.locks.ts`.
 */

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
