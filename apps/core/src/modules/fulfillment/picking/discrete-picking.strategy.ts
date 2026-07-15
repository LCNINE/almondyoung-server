import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { acquireStockAvailabilityLock } from '../../inventory/shared/locks/stock-availability-lock';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { BatchInventorySessionService } from '../services/batch-inventory-session.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { InvoiceOrchestrator } from '../services/invoice-orchestrator.service';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import {
  CompletePickInput,
  HandoffPickingInput,
  InspectionReadyOutput,
  PickingHandoffResult,
  PickingPlanResult,
  PickingScanResult,
  PickingStartResult,
  PickingStrategy,
  PlanPickingInput,
  ScanPickingInput,
  StartPickingInput,
  UnpickShipmentInput,
  UnpickShipmentResult,
} from './picking-strategy.interface';

type BatchRow = typeof wmsTables.outboundBatches.$inferSelect;
type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;

const ACTIVE_WORK_ITEM_STATUSES = ['queued', 'picking'] as const;
const PACKING_REF_PREFIX = 'work-item:';

interface LockedLine {
  id: string;
  shipmentId: string;
  fulfillmentOrderItemId: string;
  fulfillmentOrderId: string;
  skuId: string;
  qty: number;
  reservedQty: number;
  inspectedQty: number;
  fulfillmentMode: string | null;
  stockType: string;
  skuDeliveryProfileId: string | null;
}

interface LockedAggregate {
  batch: BatchRow;
  shipments: ShipmentRow[];
  lines: LockedLine[];
  workItems: WorkItemRow[];
}

interface SourceCapacity {
  skuId: string;
  sourceLocationId: string;
  stockVersion: number;
  remainingQty: number;
}

interface ShipmentCustodyBalance {
  id: string;
  skuId: string;
  sourceLocationId: string | null;
  custodyType: (typeof wmsTables.batchInventorySessionBalances.$inferSelect)['custodyType'];
  custodyRef: string | null;
  shipmentLineId: string | null;
  qty: number;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

@Injectable()
export class DiscretePickingStrategy implements PickingStrategy {
  readonly capabilities = Object.freeze({
    name: 'discrete' as const,
    requiresPhysicalTote: false,
    supportsAggregateSourcePick: false,
    inspectionReadyCustody: 'PACKING' as const,
    custodyFlow: Object.freeze(['AT_SOURCE', 'WORKER', 'PACKING']),
  });

  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly invariant: FulfillmentInvariantService,
    private readonly sessions: BatchInventorySessionService,
    private readonly controlledStock: BatchControlledStockGuard,
    private readonly invoices: InvoiceOrchestrator,
    private readonly batches: OutboundBatchOrchestrator,
  ) {}

  async plan(input: PlanPickingInput, tx?: DbTx): Promise<PickingPlanResult> {
    this.workflowGate.assertV2MutationAllowed('picking.discrete.plan');
    const shipmentIds = this.requiredIds('shipmentIds', input.shipmentIds);
    return this.commands.execute<PickingPlanResult>(
      {
        commandType: 'picking.discrete.plan',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
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
          throw this.conflict('PICKING_PLAN_OPEN_STATE_CORRUPT', `Batch ${input.batchId} has multiple open plans`);
        }
        if (optimisticOpenPlans[0]?.status === 'active') {
          throw this.conflict('PICKING_PLAN_ALREADY_ACTIVE', `Batch ${input.batchId} already has an active plan`);
        }
        const optimisticDraftId = optimisticOpenPlans[0]?.status === 'draft' ? optimisticOpenPlans[0].id : undefined;
        let aggregateShipmentIds = shipmentIds;
        if (optimisticDraftId) {
          const storedMembers = await trx
            .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
            .from(wmsTables.pickingPlanMembers)
            .where(eq(wmsTables.pickingPlanMembers.planId, optimisticDraftId))
            .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId));
          const storedShipmentIds = storedMembers.map((member) => member.shipmentId);
          if (storedShipmentIds.join(',') !== shipmentIds.join(',')) {
            throw this.conflict(
              'PICKING_PLAN_REQUEST_MEMBERSHIP_MISMATCH',
              'Requested shipments do not match the existing draft plan membership',
            );
          }
          aggregateShipmentIds = storedShipmentIds;
        }
        let aggregate: LockedAggregate;
        try {
          aggregate = await this.lockAggregate(input.batchId, aggregateShipmentIds, trx);
        } catch (error) {
          if (!optimisticDraftId || !this.isPlanValidationError(error)) throw error;
          const response = await this.invalidateDraftPlan(
            optimisticDraftId,
            input.batchId,
            this.errorMessage(error),
            commandRequestId,
            trx,
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
          throw this.conflict('PICKING_PLAN_OPEN_STATE_CORRUPT', `Batch ${input.batchId} has multiple open plans`);
        }
        const openPlan = openPlans[0];
        if (openPlan?.status === 'active') {
          throw this.conflict('PICKING_PLAN_ALREADY_ACTIVE', `Batch ${input.batchId} already has an active plan`);
        }
        if (openPlan?.status === 'draft') {
          const lockedMembers = await trx
            .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
            .from(wmsTables.pickingPlanMembers)
            .where(eq(wmsTables.pickingPlanMembers.planId, openPlan.id))
            .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId))
            .for('update');
          const storedShipmentIds = lockedMembers.map((member) => member.shipmentId);
          if (storedShipmentIds.join(',') !== shipmentIds.join(',')) {
            throw this.conflict(
              'PICKING_PLAN_REQUEST_MEMBERSHIP_MISMATCH',
              'Requested shipments do not match the locked draft plan membership',
            );
          }
          let staleReason: string | null = null;
          try {
            await this.assertWarehouseConfiguration(aggregate.batch.warehouseId, trx);
            await this.assertPlanningEligibility(aggregate, storedShipmentIds, trx);
            staleReason = await this.planStalenessReason(openPlan.id, aggregate, trx);
          } catch (error) {
            if (!this.isPlanValidationError(error)) throw error;
            staleReason = this.errorMessage(error);
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
              .where(eq(wmsTables.pickingPlanMembers.planId, openPlan.id))
              .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId));
            const response: PickingPlanResult = {
              state: 'planned',
              operationId: commandRequestId,
              planId: openPlan.id,
              batchId: input.batchId,
              strategy: this.capabilities.name,
              version: openPlan.version,
              shipmentIds: members.map((member) => member.shipmentId),
              allocationCount: Number(allocationSummary?.count ?? 0),
              totalQty: Number(allocationSummary?.totalQty ?? 0),
            };
            return { response, resourceType: 'picking_plan', resourceId: openPlan.id };
          }
          const response = await this.invalidateDraftPlan(
            openPlan.id,
            input.batchId,
            staleReason,
            commandRequestId,
            trx,
          );
          return { response, resourceType: 'picking_plan', resourceId: openPlan.id };
        }

        await this.assertWarehouseConfiguration(aggregate.batch.warehouseId, trx);
        await this.assertPlanningEligibility(aggregate, shipmentIds, trx);

        const capacities = await this.lockSourceCapacities(aggregate, trx);
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
            throw this.conflict(
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
            strategy: this.capabilities.name,
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
          strategy: this.capabilities.name,
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

  async start(input: StartPickingInput, tx?: DbTx): Promise<PickingStartResult> {
    this.workflowGate.assertV2MutationAllowed('picking.discrete.start');
    return this.commands.execute<PickingStartResult>(
      {
        commandType: 'picking.discrete.start',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
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
        if (identity.strategy !== this.capabilities.name) {
          throw this.conflict('PICKING_STRATEGY_MISMATCH', `Picking plan ${input.planId} is ${identity.strategy}`);
        }

        if (identity.status === 'active') {
          const session = await this.sessions.startSession(input.batchId, input.planId, trx, input.actorId);
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
          throw this.conflict('PICKING_PLAN_NOT_STARTABLE', `Picking plan ${input.planId} is ${identity.status}`);
        }

        const memberRows = await trx
          .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
          .from(wmsTables.pickingPlanMembers)
          .where(eq(wmsTables.pickingPlanMembers.planId, input.planId));
        const shipmentIds = uniqueSorted(memberRows.map((member) => member.shipmentId));
        let invalidationReason: string | null = null;
        try {
          const aggregate = await this.lockAggregate(input.batchId, shipmentIds, trx);
          await this.assertWarehouseConfiguration(aggregate.batch.warehouseId, trx);
          await this.assertPlanningEligibility(aggregate, shipmentIds, trx);
          invalidationReason = await this.planStalenessReason(input.planId, aggregate, trx);
        } catch (error) {
          if (
            !(
              error instanceof BadRequestException ||
              error instanceof ConflictException ||
              error instanceof NotFoundException
            )
          ) {
            throw error;
          }
          invalidationReason = this.errorMessage(error);
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
            throw this.conflict(
              'PICKING_PLAN_STALE_VERSION',
              `Picking plan ${input.planId} changed while invalidating`,
            );
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

        const session = await this.sessions.startSession(input.batchId, input.planId, trx, input.actorId);
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

  async scan(input: ScanPickingInput, tx?: DbTx): Promise<PickingScanResult> {
    this.workflowGate.assertV2MutationAllowed('picking.discrete.scan');
    this.assertPositiveQuantity(input.quantity);
    return this.commands.execute(
      {
        commandType: 'picking.discrete.scan',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          shipmentLineId: input.shipmentLineId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          actorId: input.actor.id,
          expectedLeaseVersion: input.expectedLeaseVersion,
          stage: 'AT_SOURCE_TO_WORKER',
          destinationRef: input.actor.id,
        },
      },
      async (trx, commandRequestId) => {
        await this.lockAndAssertPickerClaim(
          input.workItemId,
          input.batchId,
          input.shipmentId,
          input.actor.id,
          input.expectedLeaseVersion,
          trx,
        );
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        const [line] = await trx
          .select({ shipmentId: wmsTables.shipmentLines.shipmentId, skuId: wmsTables.shipmentLines.skuId })
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.id, input.shipmentLineId))
          .limit(1);
        if (!line || line.shipmentId !== input.shipmentId) {
          throw this.conflict('PICKING_WRONG_SHIPMENT_LINE', 'Scanned shipment line does not belong to the work item');
        }
        if (line.skuId !== input.skuId) {
          throw this.conflict('PICKING_WRONG_SKU', 'Scanned SKU does not match the shipment line');
        }
        const [allocation] = await trx
          .select({ qty: wmsTables.pickingSourceAllocations.qty })
          .from(wmsTables.pickingSourceAllocations)
          .where(
            and(
              eq(wmsTables.pickingSourceAllocations.planId, input.planId),
              eq(wmsTables.pickingSourceAllocations.shipmentLineId, input.shipmentLineId),
              eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
            ),
          )
          .limit(1);
        if (!allocation) {
          throw this.conflict('PICKING_WRONG_SOURCE', 'Shipment line is not allocated from the scanned source');
        }
        const [attributed] = await trx
          .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
          .from(wmsTables.batchInventorySessionBalances)
          .where(
            and(
              eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
              eq(wmsTables.batchInventorySessionBalances.shipmentLineId, input.shipmentLineId),
              eq(wmsTables.batchInventorySessionBalances.sourceLocationId, input.sourceLocationId),
              ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
            ),
          );
        const alreadyAttributed = Number(attributed?.qty ?? 0);
        if (alreadyAttributed + input.quantity > allocation.qty) {
          throw this.conflict(
            'PICKING_OVERPICK',
            `Scan exceeds allocation remaining ${Math.max(0, allocation.qty - alreadyAttributed)}`,
          );
        }

        await this.sessions.moveCustody(
          {
            sessionId: input.sessionId,
            idempotencyKey: `discrete-scan:${commandRequestId}`,
            actorId: input.actor.id,
            quantity: input.quantity,
            from: {
              skuId: input.skuId,
              sourceLocationId: input.sourceLocationId,
              custodyType: 'AT_SOURCE',
            },
            to: {
              skuId: input.skuId,
              sourceLocationId: input.sourceLocationId,
              custodyType: 'WORKER',
              custodyRef: input.actor.id,
              shipmentLineId: input.shipmentLineId,
            },
          },
          trx,
        );
        const response: PickingScanResult = {
          operationId: commandRequestId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          shipmentLineId: input.shipmentLineId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          workerId: input.actor.id,
        };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: input.workItemId };
      },
      tx,
    );
  }

  async handoff(input: HandoffPickingInput, tx?: DbTx): Promise<PickingHandoffResult> {
    this.workflowGate.assertV2MutationAllowed('picking.discrete.handoff');
    return this.commands.execute(
      {
        commandType: 'picking.discrete.handoff',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          targetWorkerId: input.targetWorkerId,
          expectedLeaseVersion: input.expectedLeaseVersion,
          reason: input.reason.trim(),
          actorId: input.actor.id,
          actorRoles: [...input.actor.roles].sort(),
        },
      },
      async (trx, commandRequestId) => {
        const item = await this.loadWorkItem(input.workItemId, trx);
        this.assertWorkItemIdentity(item, input.batchId, input.shipmentId);
        if (item.status !== 'picking' || !item.pickerId || item.leaseVersion !== input.expectedLeaseVersion) {
          throw this.conflict('PICKING_HANDOFF_NOT_ACTIVE', 'Work item has no active picker to hand off');
        }
        const oldOwnerId = item.pickerId;
        const optimisticBalances = await this.loadPositiveShipmentCustody(input.sessionId, input.shipmentId, trx);
        this.assertExclusiveWorkerCustody(optimisticBalances, oldOwnerId);
        const handedOff = await this.batches.handoff(
          input.workItemId,
          {
            claimType: 'picker',
            targetWorkerId: input.targetWorkerId,
            expectedLeaseVersion: input.expectedLeaseVersion,
            reason: input.reason,
          },
          `discrete-handoff-claim:${commandRequestId}`,
          input.actor,
          trx,
        );
        if (
          handedOff.workItem.batchId !== input.batchId ||
          handedOff.workItem.shipmentId !== input.shipmentId ||
          handedOff.workItem.pickerId !== input.targetWorkerId
        ) {
          throw this.conflict('PICKING_HANDOFF_STALE', 'Picker handoff returned an unexpected work item state');
        }
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        const balances = await this.loadPositiveShipmentCustody(input.sessionId, input.shipmentId, trx);
        this.assertExclusiveWorkerCustody(balances, oldOwnerId);

        let movedQty = 0;
        for (const balance of balances) {
          if (oldOwnerId === input.targetWorkerId) continue;
          if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
            throw this.conflict('PICKING_CUSTODY_CORRUPT', `Worker balance ${balance.id} is incomplete`);
          }
          await this.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `discrete-handoff:${commandRequestId}:${balance.id}`,
              actorId: input.actor.id,
              quantity: balance.qty,
              from: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: 'WORKER',
                custodyRef: oldOwnerId,
                shipmentLineId: balance.shipmentLineId,
              },
              to: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: 'WORKER',
                custodyRef: input.targetWorkerId,
                shipmentLineId: balance.shipmentLineId,
              },
            },
            trx,
          );
          movedQty += balance.qty;
        }
        const response: PickingHandoffResult = {
          operationId: commandRequestId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          workerId: input.targetWorkerId,
          leaseVersion: handedOff.workItem.leaseVersion,
          movedQty,
        };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: input.workItemId };
      },
      tx,
    );
  }

  async completePick(input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput> {
    this.workflowGate.assertV2MutationAllowed('picking.discrete.complete');
    return this.commands.execute(
      {
        commandType: 'picking.discrete.complete',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          actorId: input.actor.id,
          expectedLeaseVersion: input.expectedLeaseVersion,
        },
      },
      async (trx, commandRequestId) => {
        await this.lockAndAssertPickerClaim(
          input.workItemId,
          input.batchId,
          input.shipmentId,
          input.actor.id,
          input.expectedLeaseVersion,
          trx,
        );
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        const allocations = await this.loadShipmentAllocations(input.planId, input.shipmentId, trx);
        const packingRef = `${PACKING_REF_PREFIX}${input.workItemId}`;
        for (const allocation of allocations) {
          const balances = await trx
            .select({
              id: wmsTables.batchInventorySessionBalances.id,
              custodyType: wmsTables.batchInventorySessionBalances.custodyType,
              custodyRef: wmsTables.batchInventorySessionBalances.custodyRef,
              qty: wmsTables.batchInventorySessionBalances.qty,
            })
            .from(wmsTables.batchInventorySessionBalances)
            .where(
              and(
                eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
                eq(wmsTables.batchInventorySessionBalances.shipmentLineId, allocation.shipmentLineId),
                eq(wmsTables.batchInventorySessionBalances.sourceLocationId, allocation.sourceLocationId),
                ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
                gt(wmsTables.batchInventorySessionBalances.qty, 0),
              ),
            )
            .orderBy(asc(wmsTables.batchInventorySessionBalances.id));
          const total = balances.reduce((sum, balance) => sum + balance.qty, 0);
          const worker = balances.find(
            (balance) => balance.custodyType === 'WORKER' && balance.custodyRef === input.actor.id,
          );
          if (total !== allocation.qty || worker?.qty !== allocation.qty || balances.length !== 1) {
            throw this.conflict(
              'PICKING_INCOMPLETE',
              `Allocation ${allocation.shipmentLineId}/${allocation.sourceLocationId} is not fully held by the picker`,
            );
          }
          await this.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `discrete-complete:${commandRequestId}:${worker.id}`,
              actorId: input.actor.id,
              quantity: worker.qty,
              from: {
                skuId: allocation.skuId,
                sourceLocationId: allocation.sourceLocationId,
                custodyType: 'WORKER',
                custodyRef: input.actor.id,
                shipmentLineId: allocation.shipmentLineId,
              },
              to: {
                skuId: allocation.skuId,
                sourceLocationId: allocation.sourceLocationId,
                custodyType: 'PACKING',
                custodyRef: packingRef,
                shipmentLineId: allocation.shipmentLineId,
              },
            },
            trx,
          );
        }

        const now = await this.databaseNow(trx);
        const [completed] = await trx
          .update(wmsTables.outboundBatchWorkItems)
          .set({
            status: 'ready_to_pack',
            pickerReleasedAt: now,
            leaseExpiresAt: null,
            leaseVersion: input.expectedLeaseVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.id, input.workItemId),
              eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
              eq(wmsTables.outboundBatchWorkItems.shipmentId, input.shipmentId),
              eq(wmsTables.outboundBatchWorkItems.status, 'picking'),
              eq(wmsTables.outboundBatchWorkItems.pickerId, input.actor.id),
              eq(wmsTables.outboundBatchWorkItems.leaseVersion, input.expectedLeaseVersion),
              gt(wmsTables.outboundBatchWorkItems.leaseExpiresAt, now),
            ),
          )
          .returning({ id: wmsTables.outboundBatchWorkItems.id });
        if (!completed) throw this.conflict('PICKING_STALE_CLAIM', 'Picker claim changed while completing pick');

        const lines = allocations.map((allocation) => ({
          shipmentLineId: allocation.shipmentLineId,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          quantity: allocation.qty,
        }));
        const response: InspectionReadyOutput = {
          operationId: commandRequestId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          custodyType: 'PACKING',
          custodyRef: packingRef,
          lines,
          totalQty: lines.reduce((total, line) => total + line.quantity, 0),
        };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: input.workItemId };
      },
      tx,
    );
  }

  async unpickShipment(input: UnpickShipmentInput, tx?: DbTx): Promise<UnpickShipmentResult> {
    this.workflowGate.assertV2MutationAllowed('picking.discrete.unpick');
    return this.commands.execute(
      {
        commandType: 'picking.discrete.unpick',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          actorId: input.actor.id,
          actorRoles: [...input.actor.roles].sort(),
          expectedLeaseVersion: input.expectedLeaseVersion,
        },
      },
      async (trx, commandRequestId) => {
        const item = await this.loadWorkItem(input.workItemId, trx, true);
        this.assertWorkItemIdentity(item, input.batchId, input.shipmentId);
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        if (item.leaseVersion !== input.expectedLeaseVersion) {
          throw this.conflict('PICKING_STALE_CLAIM', `Work item ${item.id} lease version changed`);
        }
        const allocations = await this.loadShipmentAllocations(input.planId, input.shipmentId, trx);
        const privileged = input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master');
        const now = await this.databaseNow(trx);
        if (item.status === 'picking') {
          if (
            item.pickerId !== input.actor.id ||
            item.pickerReleasedAt ||
            !item.leaseExpiresAt ||
            item.leaseExpiresAt.getTime() <= now.getTime()
          ) {
            throw this.conflict('PICKING_STALE_CLAIM', 'Only the active picker may unpick this work item');
          }
        } else if (item.status === 'ready_to_pack') {
          if (item.pickerId !== input.actor.id && !privileged) {
            throw this.conflict('PICKING_UNPICK_FORBIDDEN', 'Only the previous picker or a manager may unpick');
          }
        } else {
          throw this.conflict('PICKING_NOT_UNPICKABLE', `Work item ${item.id} is ${item.status}`);
        }

        const balances = await trx
          .select({
            id: wmsTables.batchInventorySessionBalances.id,
            skuId: wmsTables.batchInventorySessionBalances.skuId,
            sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
            custodyType: wmsTables.batchInventorySessionBalances.custodyType,
            custodyRef: wmsTables.batchInventorySessionBalances.custodyRef,
            shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
            qty: wmsTables.batchInventorySessionBalances.qty,
          })
          .from(wmsTables.batchInventorySessionBalances)
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.id, wmsTables.batchInventorySessionBalances.shipmentLineId),
          )
          .where(
            and(
              eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
              eq(wmsTables.shipmentLines.shipmentId, input.shipmentId),
              gt(wmsTables.batchInventorySessionBalances.qty, 0),
            ),
          )
          .orderBy(asc(wmsTables.batchInventorySessionBalances.id));
        const allocationByGrain = new Map(
          allocations.map((allocation) => [`${allocation.shipmentLineId}|${allocation.sourceLocationId}`, allocation]),
        );
        const attributedByGrain = new Map<string, number>();
        for (const balance of balances) {
          const grain = `${balance.shipmentLineId ?? ''}|${balance.sourceLocationId ?? ''}`;
          const allocation = allocationByGrain.get(grain);
          if (!allocation || allocation.skuId !== balance.skuId) {
            throw this.conflict('PICKING_CUSTODY_GRAIN_MISMATCH', `Balance ${balance.id} is not a plan allocation`);
          }
          attributedByGrain.set(grain, (attributedByGrain.get(grain) ?? 0) + balance.qty);
          if ((attributedByGrain.get(grain) ?? 0) > allocation.qty) {
            throw this.conflict('PICKING_CUSTODY_OVERATTRIBUTED', `Balance grain ${grain} exceeds its allocation`);
          }
        }
        if (item.status === 'picking') {
          if (balances.some((balance) => balance.custodyType !== 'WORKER' || balance.custodyRef !== input.actor.id)) {
            throw this.conflict(
              'PICKING_CUSTODY_OWNER_MISMATCH',
              'Active pick custody must be held only by the current picker',
            );
          }
        } else {
          const packingRef = `${PACKING_REF_PREFIX}${input.workItemId}`;
          if (
            balances.length !== allocations.length ||
            balances.some((balance) => balance.custodyType !== 'PACKING' || balance.custodyRef !== packingRef) ||
            allocations.some((allocation) => {
              const grain = `${allocation.shipmentLineId}|${allocation.sourceLocationId}`;
              return attributedByGrain.get(grain) !== allocation.qty;
            })
          ) {
            throw this.conflict(
              'PICKING_PACKING_CUSTODY_INCOMPLETE',
              'Ready-to-pack custody must exactly match every plan allocation',
            );
          }
        }
        let returnedToSourceQty = 0;
        for (const balance of balances) {
          if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
            throw this.conflict('PICKING_CUSTODY_CORRUPT', `Assigned balance ${balance.id} is incomplete`);
          }
          await this.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `discrete-unpick:${commandRequestId}:${balance.id}`,
              actorId: input.actor.id,
              quantity: balance.qty,
              from: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: balance.custodyType,
                custodyRef: balance.custodyRef,
                shipmentLineId: balance.shipmentLineId,
              },
              to: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: 'AT_SOURCE',
              },
            },
            trx,
          );
          returnedToSourceQty += balance.qty;
        }
        const [requeued] = await trx
          .update(wmsTables.outboundBatchWorkItems)
          .set({
            status: 'queued',
            pickerReleasedAt: item.pickerReleasedAt ?? now,
            leaseExpiresAt: null,
            leaseVersion: item.leaseVersion + 1,
            updatedAt: now,
          })
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.id, item.id),
              eq(wmsTables.outboundBatchWorkItems.leaseVersion, item.leaseVersion),
              inArray(wmsTables.outboundBatchWorkItems.status, ['picking', 'ready_to_pack']),
            ),
          )
          .returning({ id: wmsTables.outboundBatchWorkItems.id });
        if (!requeued) throw this.conflict('PICKING_STALE_CLAIM', 'Work item changed while unpicking');
        const response: UnpickShipmentResult = {
          operationId: commandRequestId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          status: 'queued',
          returnedToSourceQty,
        };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: input.workItemId };
      },
      tx,
    );
  }

  private async lockAggregate(batchId: string, requestedShipmentIds: string[], tx: DbTx): Promise<LockedAggregate> {
    const initialLines = await tx
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
    await this.invariant.assertFulfillmentOrders(fulfillmentOrderIds, tx);

    // The invariant owns the recursive FOI -> shipment -> line -> reservation -> invoice/work/session locks.
    // The following rows are re-read for strategy-specific identity and then batch -> plan -> source follows.
    const shipments = await tx
      .select()
      .from(wmsTables.shipments)
      .where(inArray(wmsTables.shipments.id, requestedShipmentIds))
      .orderBy(asc(wmsTables.shipments.id))
      .for('update');
    const requestedLines = await tx
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
    const [batch] = await tx
      .select()
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, batchId))
      .limit(1)
      .for('update');
    if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
    const workItems = await tx
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
      await tx
        .select({ id: wmsTables.deliveryProfiles.id })
        .from(wmsTables.deliveryProfiles)
        .where(inArray(wmsTables.deliveryProfiles.id, profileIds))
        .orderBy(asc(wmsTables.deliveryProfiles.id))
        .for('update');
    }
    await tx
      .select({ id: wmsTables.skus.id })
      .from(wmsTables.skus)
      .where(inArray(wmsTables.skus.id, skuIds))
      .orderBy(asc(wmsTables.skus.id))
      .for('update');

    const finalIdentity = await tx
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
      throw this.conflict('PICKING_COMPONENT_CHANGED_RETRY', 'Shipment component changed while planning');
    }

    const enrichedLines = await tx
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

  private async assertPlanningEligibility(
    aggregate: LockedAggregate,
    requestedShipmentIds: string[],
    tx: DbTx,
  ): Promise<void> {
    const requested = requestedShipmentIds.join(',');
    const eligibleItems = aggregate.workItems.filter((item) =>
      (ACTIVE_WORK_ITEM_STATUSES as readonly string[]).includes(item.status),
    );
    if (uniqueSorted(eligibleItems.map((item) => item.shipmentId)).join(',') !== requested) {
      throw this.conflict(
        'PICKING_WORK_ITEM_MEMBERSHIP_MISMATCH',
        'Plan membership must exactly match queued/picking batch work items',
      );
    }
    if (
      aggregate.shipments.some(
        (shipment) => shipment.status !== 'planned' || shipment.warehouseId !== aggregate.batch.warehouseId,
      )
    ) {
      throw this.conflict('PICKING_SHIPMENT_NOT_ELIGIBLE', 'Every shipment must be planned in the batch warehouse');
    }
    if (!aggregate.lines.length) throw this.conflict('PICKING_PLAN_EMPTY', 'Picking plan has no shipment lines');
    for (const shipment of aggregate.shipments) {
      if (!shipment.shippingProfileId) {
        throw this.conflict('SHIPMENT_PROFILE_REQUIRED', `Shipment ${shipment.id} has no shipping profile`);
      }
      this.assertRecipientComplete(shipment.recipientSnapshot);
      const [profile] = await tx
        .select()
        .from(wmsTables.deliveryProfiles)
        .where(eq(wmsTables.deliveryProfiles.id, shipment.shippingProfileId))
        .limit(1);
      if (!profile) throw new NotFoundException(`Shipping profile ${shipment.shippingProfileId} not found`);
      this.assertProfileComplete(profile);
      const shipmentLines = aggregate.lines.filter((line) => line.shipmentId === shipment.id);
      const modes = uniqueSorted(shipmentLines.map((line) => line.fulfillmentMode ?? 'in_house'));
      if (
        !profile.supportedFulfillmentModes ||
        modes.some((mode) => !profile.supportedFulfillmentModes!.includes(mode as never))
      ) {
        throw this.conflict('SHIPMENT_PROFILE_INCOMPATIBLE', 'Shipping profile does not support fulfillment mode');
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
        throw this.conflict(
          'PICKING_SHIPMENT_NOT_ELIGIBLE',
          `Shipment ${shipment.id} must contain only uninspected, fully reserved physical lines`,
        );
      }
      await this.invoices.assertDispatchableInvoice(shipment.id, tx);
    }
    const lineIds = aggregate.lines.map((line) => line.id);
    const reservations = await tx
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
        throw this.conflict('PICKING_RESERVATION_MISMATCH', 'Reservation identity does not match shipment line');
      }
      reservedByLine.set(line.id, (reservedByLine.get(line.id) ?? 0) + reservation.qty);
    }
    if (aggregate.lines.some((line) => reservedByLine.get(line.id) !== line.qty)) {
      throw this.conflict('PICKING_RESERVATION_MISMATCH', 'Every shipment line must remain fully reserved');
    }
  }

  private async lockSourceCapacities(aggregate: LockedAggregate, tx: DbTx): Promise<SourceCapacity[]> {
    const skuIds = uniqueSorted(aggregate.lines.map((line) => line.skuId));
    for (const skuId of skuIds) {
      await acquireStockAvailabilityLock(tx, skuId, aggregate.batch.warehouseId);
    }
    const ledgers = await tx
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
      const availability = await this.controlledStock.getAvailability(
        {
          skuId: ledger.skuId,
          warehouseId: aggregate.batch.warehouseId,
          sourceLocationId: ledger.locationId,
        },
        tx,
      );
      if (availability.stockVersion !== ledger.version) {
        throw this.conflict('PICKING_SOURCE_STALE', 'Source stock changed while locking capacity');
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

  private async planStalenessReason(planId: string, aggregate: LockedAggregate, tx: DbTx): Promise<string | null> {
    const [plan] = await tx
      .select()
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.id, planId))
      .limit(1)
      .for('update');
    if (!plan || plan.batchId !== aggregate.batch.id || plan.strategy !== this.capabilities.name) {
      return 'Picking plan identity no longer matches the discrete batch';
    }
    if (plan.status !== 'draft') return `Picking plan is ${plan.status}`;
    const members = await tx
      .select()
      .from(wmsTables.pickingPlanMembers)
      .where(eq(wmsTables.pickingPlanMembers.planId, planId))
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

    const allocations = await tx
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
      await acquireStockAvailabilityLock(tx, skuId, aggregate.batch.warehouseId);
    }
    for (const source of sources) {
      const availability = await this.controlledStock.getAvailability(
        {
          skuId: source.skuId,
          warehouseId: aggregate.batch.warehouseId,
          sourceLocationId: source.sourceLocationId,
        },
        tx,
        { lock: true },
      );
      if (availability.stockVersion !== source.stockVersion || availability.generallyAvailableQty < source.qty) {
        return `Source ${source.skuId}/${source.sourceLocationId} changed after planning`;
      }
    }
    return null;
  }

  private async assertWarehouseConfiguration(warehouseId: string, tx: DbTx): Promise<void> {
    const [warehouse] = await tx
      .select({ supportedPickingStrategies: wmsTables.warehouses.supportedPickingStrategies })
      .from(wmsTables.warehouses)
      .where(eq(wmsTables.warehouses.id, warehouseId))
      .limit(1);
    if (!warehouse) throw new NotFoundException(`Warehouse ${warehouseId} not found`);
    if (!warehouse.supportedPickingStrategies?.includes(this.capabilities.name)) {
      throw this.conflict(
        'PICKING_STRATEGY_NOT_CONFIGURED',
        `Warehouse ${warehouseId} does not explicitly enable ${this.capabilities.name}`,
      );
    }
  }

  /** Active custody trusts its immutable allocation; source ledger versions are a pre-HAND_IN gate only. */
  private async assertActivePlanSession(planId: string, sessionId: string, batchId: string, tx: DbTx): Promise<void> {
    const [plan] = await tx
      .select({
        batchId: wmsTables.pickingPlans.batchId,
        strategy: wmsTables.pickingPlans.strategy,
        status: wmsTables.pickingPlans.status,
      })
      .from(wmsTables.pickingPlans)
      .where(eq(wmsTables.pickingPlans.id, planId))
      .limit(1)
      .for('update');
    if (!plan || plan.batchId !== batchId || plan.strategy !== this.capabilities.name || plan.status !== 'active') {
      throw this.conflict('PICKING_PLAN_NOT_ACTIVE', `Picking plan ${planId} is not an active discrete plan`);
    }
    const [session] = await tx
      .select({ batchId: wmsTables.batchInventorySessions.batchId, status: wmsTables.batchInventorySessions.status })
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId))
      .limit(1)
      .for('update');
    if (!session || session.batchId !== batchId || session.status !== 'active') {
      throw this.conflict('PICKING_SESSION_NOT_ACTIVE', `Inventory session ${sessionId} is not active for the batch`);
    }
    const [identity] = await tx
      .select({ id: wmsTables.batchInventorySessionEvents.id })
      .from(wmsTables.batchInventorySessionEvents)
      .where(
        and(
          eq(wmsTables.batchInventorySessionEvents.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionEvents.eventType, 'HAND_IN'),
          sql`${wmsTables.batchInventorySessionEvents.payload}->>'planId' = ${planId}`,
        ),
      )
      .limit(1);
    if (!identity) throw this.conflict('PICKING_SESSION_PLAN_MISMATCH', 'Inventory session belongs to another plan');
  }

  private async lockAndAssertPickerClaim(
    workItemId: string,
    batchId: string,
    shipmentId: string,
    actorId: string,
    expectedLeaseVersion: number,
    tx: DbTx,
  ): Promise<WorkItemRow> {
    if (!Number.isSafeInteger(expectedLeaseVersion) || expectedLeaseVersion < 0) {
      throw new BadRequestException('expectedLeaseVersion must be a non-negative integer');
    }
    const item = await this.loadWorkItem(workItemId, tx, true);
    this.assertWorkItemIdentity(item, batchId, shipmentId);
    const now = await this.databaseNow(tx);
    if (
      item.status !== 'picking' ||
      item.pickerId !== actorId ||
      item.pickerReleasedAt ||
      item.leaseVersion !== expectedLeaseVersion ||
      !item.leaseExpiresAt ||
      item.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw this.conflict('PICKING_STALE_CLAIM', `Worker ${actorId} does not own the active picker lease`);
    }
    return item;
  }

  private async loadWorkItem(workItemId: string, tx: DbTx, lock = false): Promise<WorkItemRow> {
    const query = tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, workItemId))
      .limit(1);
    const rows = lock ? await query.for('update') : await query;
    const item = rows[0];
    if (!item) throw new NotFoundException(`Outbound batch work item ${workItemId} not found`);
    return item;
  }

  private assertWorkItemIdentity(item: WorkItemRow, batchId: string, shipmentId: string): void {
    if (item.batchId !== batchId || item.shipmentId !== shipmentId) {
      throw this.conflict('PICKING_WORK_ITEM_MISMATCH', 'Work item does not belong to the requested batch/shipment');
    }
  }

  private async loadPositiveShipmentCustody(
    sessionId: string,
    shipmentId: string,
    tx: DbTx,
  ): Promise<ShipmentCustodyBalance[]> {
    return tx
      .select({
        id: wmsTables.batchInventorySessionBalances.id,
        skuId: wmsTables.batchInventorySessionBalances.skuId,
        sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
        custodyType: wmsTables.batchInventorySessionBalances.custodyType,
        custodyRef: wmsTables.batchInventorySessionBalances.custodyRef,
        shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
        qty: wmsTables.batchInventorySessionBalances.qty,
      })
      .from(wmsTables.batchInventorySessionBalances)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.batchInventorySessionBalances.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.shipmentLines.shipmentId, shipmentId),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id));
  }

  private assertExclusiveWorkerCustody(balances: ShipmentCustodyBalance[], workerId: string): void {
    if (balances.some((balance) => balance.custodyType !== 'WORKER' || balance.custodyRef !== workerId)) {
      throw this.conflict(
        'PICKING_CUSTODY_OWNER_MISMATCH',
        `Shipment attributed custody must be exclusively WORKER custody owned by ${workerId}`,
      );
    }
  }

  private async loadShipmentAllocations(planId: string, shipmentId: string, tx: DbTx) {
    const allocations = await tx
      .select({
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        skuId: wmsTables.shipmentLines.skuId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(eq(wmsTables.pickingSourceAllocations.planId, planId), eq(wmsTables.shipmentLines.shipmentId, shipmentId)),
      )
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );
    if (!allocations.length) {
      throw this.conflict('PICKING_SHIPMENT_NOT_IN_PLAN', `Shipment ${shipmentId} has no plan allocation`);
    }
    return allocations;
  }

  private assertRecipientComplete(value: unknown): void {
    const recipient = (value ?? {}) as Record<string, unknown>;
    const missing = ['recipientName', 'phone', 'postalCode', 'roadAddress', 'detailAddress'].filter(
      (key) => typeof recipient[key] !== 'string' || !recipient[key].trim(),
    );
    if (missing.length) {
      throw this.conflict('SHIPMENT_RECIPIENT_INCOMPLETE', `Missing recipient fields: ${missing.join(',')}`);
    }
  }

  private assertProfileComplete(profile: typeof wmsTables.deliveryProfiles.$inferSelect): void {
    const snapshots = [profile.senderSnapshot, profile.originAddressSnapshot, profile.returnAddressSnapshot];
    const sender = (profile.senderSnapshot ?? {}) as Record<string, unknown>;
    const senderName = sender.name ?? sender.senderName;
    const senderPhone = sender.phone ?? sender.senderPhone;
    if (
      snapshots.some(
        (snapshot) =>
          !snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.keys(snapshot).length === 0,
      ) ||
      typeof senderName !== 'string' ||
      !senderName.trim() ||
      typeof senderPhone !== 'string' ||
      !senderPhone.trim() ||
      !profile.carrierAccountRef?.trim()
    ) {
      throw this.conflict(
        'SHIPMENT_PROFILE_CONFIGURATION_INCOMPLETE',
        'Shipping profile execution snapshots and carrier account are required',
      );
    }
  }

  private requiredIds(name: string, values: readonly string[]): string[] {
    const ids = uniqueSorted(values.map((value) => value.trim()).filter(Boolean));
    if (!ids.length) throw new BadRequestException(`${name} must not be empty`);
    if (ids.length !== values.length) throw new BadRequestException(`${name} must contain unique non-empty IDs`);
    return ids;
  }

  private assertPositiveQuantity(quantity: number): void {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
  }

  private async databaseNow(tx: DbTx): Promise<Date> {
    const rows = await tx.execute<{ now: Date }>(sql`SELECT CURRENT_TIMESTAMP AS now`);
    const value = (rows as unknown as Array<{ now: Date }>)[0]?.now;
    if (!value) throw new Error('Database clock unavailable');
    return value instanceof Date ? value : new Date(value);
  }

  private isPlanValidationError(error: unknown): error is BadRequestException | ConflictException | NotFoundException {
    return (
      error instanceof BadRequestException || error instanceof ConflictException || error instanceof NotFoundException
    );
  }

  private async invalidateDraftPlan(
    planId: string,
    batchId: string,
    reason: string,
    operationId: string,
    tx: DbTx,
  ): Promise<PickingPlanResult> {
    const [invalidated] = await tx
      .update(wmsTables.pickingPlans)
      .set({
        status: 'invalidated',
        invalidatedAt: sql`now()`,
        invalidationReason: reason,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(wmsTables.pickingPlans.id, planId),
          eq(wmsTables.pickingPlans.batchId, batchId),
          eq(wmsTables.pickingPlans.status, 'draft'),
        ),
      )
      .returning({ id: wmsTables.pickingPlans.id });
    if (!invalidated) {
      throw this.conflict('PICKING_PLAN_STALE_VERSION', `Draft plan ${planId} changed while invalidating`);
    }
    return { state: 'invalidated', operationId, planId, batchId, reason };
  }

  private errorMessage(error: BadRequestException | ConflictException | NotFoundException): string {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const message = (response as { message?: string | string[] }).message;
    if (Array.isArray(message)) return message.join('; ');
    return message ?? error.message;
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
