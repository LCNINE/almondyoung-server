import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { acquireStockAvailabilityLock } from '../../inventory/shared/locks/stock-availability-lock';
import { BatchInventorySessionService } from '../services/batch-inventory-session.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { InvoiceOrchestrator } from '../services/invoice-orchestrator.service';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import {
  AggregateCartHandoffInput,
  AggregateCartHandoffResult,
  AggregateSortScanInput,
  AggregateSortScanResult,
  AggregateSourceScanInput,
  AggregateSourceScanResult,
  AggregateThenSortStrategy,
  CompletePickInput,
  HandoffPickingInput,
  InspectionReadyOutput,
  PickingHandoffResult,
  PickingPlanResult,
  ScanPickingResult,
  PickingStartResult,
  PlanPickingInput,
  ScanPickingInput,
  StartPickingInput,
  UnpickShipmentInput,
  UnpickShipmentResult,
} from './picking-strategy.interface';

type BatchRow = typeof wmsTables.outboundBatches.$inferSelect;
type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;
type CustodyType = (typeof wmsTables.batchInventorySessionBalances.$inferSelect)['custodyType'];

const ACTIVE_WORK_ITEM_STATUSES = ['queued', 'picking'] as const;
const ASSIGNED_REF_PREFIX = 'work-item:';
const BULK_CART_REF_PREFIX = 'bulk-cart:';

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

interface ShipmentAllocation {
  id: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  qty: number;
}

interface ShipmentCustodyBalance {
  id: string;
  skuId: string;
  sourceLocationId: string | null;
  custodyType: CustodyType;
  custodyRef: string | null;
  shipmentLineId: string | null;
  qty: number;
}

interface GlobalCartBalance extends ShipmentCustodyBalance {
  sessionId: string;
  batchId: string;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

@Injectable()
export class AggregateThenSortPickingStrategy implements AggregateThenSortStrategy {
  readonly capabilities = Object.freeze({
    name: 'aggregate_then_sort' as const,
    requiresPhysicalTote: false,
    supportsAggregateSourcePick: true,
    inspectionReadyCustody: 'PACKING' as const,
    custodyFlow: Object.freeze(['AT_SOURCE', 'BULK_CART', 'SORTING', 'PACKING']),
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
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.plan');
    const shipmentIds = this.requiredIds('shipmentIds', input.shipmentIds);
    return this.commands.execute<PickingPlanResult>(
      {
        commandType: 'picking.aggregate_then_sort.plan',
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
            return {
              response: await this.plannedResult(openPlan, input.batchId, storedShipmentIds, commandRequestId, trx),
              resourceType: 'picking_plan',
              resourceId: openPlan.id,
            };
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
          .values({ batchId: input.batchId, strategy: this.capabilities.name, version, createdBy: input.actorId })
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
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.start');
    return this.commands.execute<PickingStartResult>(
      {
        commandType: 'picking.aggregate_then_sort.start',
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
          return {
            response: {
              state: 'started',
              operationId: commandRequestId,
              planId: input.planId,
              sessionId: session.id,
              batchId: input.batchId,
              status: session.status,
            },
            resourceType: 'batch_inventory_session',
            resourceId: session.id,
          };
        }
        if (identity.status !== 'draft') {
          throw this.conflict('PICKING_PLAN_NOT_STARTABLE', `Picking plan ${input.planId} is ${identity.status}`);
        }
        const members = await trx
          .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
          .from(wmsTables.pickingPlanMembers)
          .where(eq(wmsTables.pickingPlanMembers.planId, input.planId));
        const shipmentIds = uniqueSorted(members.map((member) => member.shipmentId));
        let invalidationReason: string | null = null;
        try {
          const aggregate = await this.lockAggregate(input.batchId, shipmentIds, trx);
          await this.assertWarehouseConfiguration(aggregate.batch.warehouseId, trx);
          await this.assertPlanningEligibility(aggregate, shipmentIds, trx);
          invalidationReason = await this.planStalenessReason(input.planId, aggregate, trx);
        } catch (error) {
          if (!this.isPlanValidationError(error)) throw error;
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
          return {
            response: {
              state: 'invalidated',
              operationId: commandRequestId,
              planId: input.planId,
              batchId: input.batchId,
              reason: invalidationReason,
            },
            resourceType: 'picking_plan',
            resourceId: input.planId,
          };
        }
        const session = await this.sessions.startSession(input.batchId, input.planId, trx, input.actorId);
        return {
          response: {
            state: 'started',
            operationId: commandRequestId,
            planId: input.planId,
            sessionId: session.id,
            batchId: input.batchId,
            status: session.status,
          },
          resourceType: 'batch_inventory_session',
          resourceId: session.id,
        };
      },
      tx,
    );
  }

  async scan(input: ScanPickingInput, tx?: DbTx): Promise<ScanPickingResult> {
    if (input.strategy !== this.capabilities.name) {
      throw new BadRequestException('Aggregate picking requires strategy=aggregate_then_sort');
    }
    if (input.stage === 'bulk_collect') return this.bulkCartScan(input, tx);
    if (input.stage === 'sort') return this.sortScan(input, tx);
    throw new BadRequestException('Aggregate picking requires stage=bulk_collect or stage=sort');
  }

  async bulkCartScan(input: AggregateSourceScanInput, tx?: DbTx): Promise<AggregateSourceScanResult> {
    if (input.strategy !== this.capabilities.name || input.stage !== 'bulk_collect') {
      throw new BadRequestException('Bulk collection requires strategy=aggregate_then_sort, stage=bulk_collect');
    }
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.bulk_collect');
    this.assertPositiveQuantity(input.quantity);
    const cartId = this.requiredCartId(input.cartId);
    const cartRef = this.bulkCartRef(input.batchId, cartId, input.actor.id);
    return this.commands.execute<AggregateSourceScanResult>(
      {
        commandType: 'picking.aggregate_then_sort.bulk_collect',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
          stage: 'bulk_collect',
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          cartId,
          actorId: input.actor.id,
        },
      },
      async (trx, commandRequestId) => {
        await this.acquireCartLock(cartId, trx);
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.actor.id, trx);

        const [allocated] = await trx
          .select({ qty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int` })
          .from(wmsTables.pickingSourceAllocations)
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
          )
          .where(
            and(
              eq(wmsTables.pickingSourceAllocations.planId, input.planId),
              eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
              eq(wmsTables.shipmentLines.skuId, input.skuId),
            ),
          );
        if (Number(allocated?.qty ?? 0) <= 0) {
          throw this.conflict('PICKING_WRONG_SOURCE', 'SKU/source is not allocated by this picking plan');
        }

        await this.sessions.moveCustody(
          {
            sessionId: input.sessionId,
            idempotencyKey: `aggregate-collect:${commandRequestId}`,
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
              custodyType: 'BULK_CART',
              custodyRef: cartRef,
            },
          },
          trx,
        );
        const response: AggregateSourceScanResult = {
          operationId: commandRequestId,
          planId: input.planId,
          sessionId: input.sessionId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          cartRef,
          workerId: input.actor.id,
        };
        return { response, resourceType: 'batch_inventory_session', resourceId: input.sessionId };
      },
      tx,
    );
  }

  async sortScan(input: AggregateSortScanInput, tx?: DbTx): Promise<AggregateSortScanResult> {
    if (input.strategy !== this.capabilities.name || input.stage !== 'sort') {
      throw new BadRequestException('Sort scan requires strategy=aggregate_then_sort, stage=sort');
    }
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.sort');
    this.assertPositiveQuantity(input.quantity);
    const cartId = this.requiredCartId(input.cartId);
    if (input.destinationCustody !== 'SORTING' && input.destinationCustody !== 'PACKING') {
      throw new BadRequestException('destinationCustody must be SORTING or PACKING');
    }
    const cartRef = this.bulkCartRef(input.batchId, cartId, input.actor.id);
    return this.commands.execute<AggregateSortScanResult>(
      {
        commandType: 'picking.aggregate_then_sort.sort',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
          stage: 'sort',
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          shipmentLineId: input.shipmentLineId,
          skuId: input.skuId,
          quantity: input.quantity,
          cartId,
          destinationCustody: input.destinationCustody,
          actorId: input.actor.id,
          expectedLeaseVersion: input.expectedLeaseVersion,
        },
      },
      async (trx, commandRequestId) => {
        await this.acquireCartLock(cartId, trx);
        await this.lockAndAssertPickerClaim(
          input.workItemId,
          input.batchId,
          input.shipmentId,
          input.actor.id,
          input.expectedLeaseVersion,
          trx,
        );
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.actor.id, trx, true);
        const [line] = await trx
          .select({ shipmentId: wmsTables.shipmentLines.shipmentId, skuId: wmsTables.shipmentLines.skuId })
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.id, input.shipmentLineId))
          .limit(1);
        if (!line || line.shipmentId !== input.shipmentId) {
          throw this.conflict('PICKING_WRONG_SHIPMENT_LINE', 'Sort destination line does not belong to the work item');
        }
        if (line.skuId !== input.skuId) {
          throw this.conflict('PICKING_WRONG_SKU', 'Sorted SKU does not match the shipment line');
        }
        const allocations = await this.loadLineAllocations(input.planId, input.shipmentLineId, trx);
        const destinationRef =
          input.destinationCustody === 'SORTING'
            ? this.sortingRef(input.workItemId, input.actor.id)
            : this.packingRef(input.workItemId);
        const moves: Array<{ allocation: ShipmentAllocation; quantity: number; sourceBalanceId: string }> = [];
        let remaining = input.quantity;
        for (const allocation of allocations) {
          const balances = await this.loadPositiveAllocationCustody(input.sessionId, allocation, trx);
          const attributed = balances.reduce((sum, balance) => sum + balance.qty, 0);
          if (
            balances.some(
              (balance) =>
                !['SORTING', 'PACKING'].includes(balance.custodyType) ||
                (balance.custodyType === 'SORTING' &&
                  balance.custodyRef !== this.sortingRef(input.workItemId, input.actor.id)) ||
                (balance.custodyType === 'PACKING' && balance.custodyRef !== this.packingRef(input.workItemId)),
            )
          ) {
            throw this.conflict('PICKING_CUSTODY_OWNER_MISMATCH', 'Line custody belongs to another sort destination');
          }
          if (attributed > allocation.qty) {
            throw this.conflict('PICKING_CUSTODY_OVERATTRIBUTED', 'Sorted custody exceeds its plan allocation');
          }
          const capacity = allocation.qty - attributed;
          if (remaining === 0 || capacity === 0) continue;
          const [bulk] = await trx
            .select({
              id: wmsTables.batchInventorySessionBalances.id,
              qty: wmsTables.batchInventorySessionBalances.qty,
            })
            .from(wmsTables.batchInventorySessionBalances)
            .where(
              and(
                eq(wmsTables.batchInventorySessionBalances.sessionId, input.sessionId),
                eq(wmsTables.batchInventorySessionBalances.skuId, input.skuId),
                eq(wmsTables.batchInventorySessionBalances.sourceLocationId, allocation.sourceLocationId),
                eq(wmsTables.batchInventorySessionBalances.custodyType, 'BULK_CART'),
                eq(wmsTables.batchInventorySessionBalances.custodyRef, cartRef),
                isNull(wmsTables.batchInventorySessionBalances.shipmentLineId),
                gt(wmsTables.batchInventorySessionBalances.qty, 0),
              ),
            )
            .limit(1)
            .for('update');
          const quantity = Math.min(remaining, capacity, bulk?.qty ?? 0);
          if (quantity > 0) {
            moves.push({ allocation, quantity, sourceBalanceId: bulk.id });
            remaining -= quantity;
          }
        }
        if (remaining > 0) {
          throw this.conflict(
            'PICKING_SORT_SHORT',
            `Cart custody or line allocation is short by ${remaining} for shipment line ${input.shipmentLineId}`,
          );
        }
        for (const move of moves) {
          await this.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `aggregate-sort:${commandRequestId}:${move.sourceBalanceId}:${move.allocation.id}`,
              actorId: input.actor.id,
              quantity: move.quantity,
              from: {
                skuId: input.skuId,
                sourceLocationId: move.allocation.sourceLocationId,
                custodyType: 'BULK_CART',
                custodyRef: cartRef,
              },
              to: {
                skuId: input.skuId,
                sourceLocationId: move.allocation.sourceLocationId,
                custodyType: input.destinationCustody,
                custodyRef: destinationRef,
                shipmentLineId: input.shipmentLineId,
              },
            },
            trx,
          );
        }
        const response: AggregateSortScanResult = {
          operationId: commandRequestId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          shipmentLineId: input.shipmentLineId,
          skuId: input.skuId,
          quantity: input.quantity,
          cartRef,
          destinationCustody: input.destinationCustody,
          destinationRef,
          sourceMoves: moves.map((move) => ({
            sourceLocationId: move.allocation.sourceLocationId,
            quantity: move.quantity,
          })),
        };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: input.workItemId };
      },
      tx,
    );
  }

  async cartHandoff(input: AggregateCartHandoffInput, tx?: DbTx): Promise<AggregateCartHandoffResult> {
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.cart_handoff');
    const cartId = this.requiredCartId(input.cartId);
    const reason = input.reason.trim();
    if (!reason) throw new BadRequestException('reason is required');
    if (reason.length > 500) throw new BadRequestException('reason must be at most 500 characters');
    if (!input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master')) {
      throw this.conflict('AGGREGATE_CART_HANDOFF_FORBIDDEN', 'Cart handoff requires logistics_manager or master');
    }
    if (input.expectedOwnerId === input.targetWorkerId) {
      throw new BadRequestException('Cart target worker must differ from its expected owner');
    }
    return this.commands.execute<AggregateCartHandoffResult>(
      {
        commandType: 'picking.aggregate_then_sort.cart_handoff',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          strategy: this.capabilities.name,
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          cartId,
          expectedOwnerId: input.expectedOwnerId,
          targetWorkerId: input.targetWorkerId,
          reason,
          actorId: input.actor.id,
          actorRoles: [...input.actor.roles].sort(),
        },
      },
      async (trx, commandRequestId) => {
        if (!input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master')) {
          throw this.conflict('AGGREGATE_CART_HANDOFF_FORBIDDEN', 'Cart handoff requires logistics_manager or master');
        }
        await this.acquireCartLock(cartId, trx);
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.expectedOwnerId, trx, true);
        const sourceCartRef = this.bulkCartRef(input.batchId, cartId, input.expectedOwnerId);
        const targetCartRef = this.bulkCartRef(input.batchId, cartId, input.targetWorkerId);
        const balances = await this.loadCartBalances(input.sessionId, input.batchId, cartId, trx);
        if (!balances.length) {
          throw this.conflict('AGGREGATE_CART_EMPTY', `Cart ${cartId} has no pooled custody to hand off`);
        }
        let movedQty = 0;
        for (const balance of balances) {
          if (!balance.sourceLocationId || balance.custodyRef !== sourceCartRef || balance.shipmentLineId) {
            throw this.conflict('AGGREGATE_CART_OWNER_MISMATCH', `Cart balance ${balance.id} has mixed ownership`);
          }
          await this.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `aggregate-cart-handoff:${commandRequestId}:${balance.id}`,
              actorId: input.actor.id,
              quantity: balance.qty,
              from: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: 'BULK_CART',
                custodyRef: sourceCartRef,
              },
              to: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: 'BULK_CART',
                custodyRef: targetCartRef,
              },
              context: {
                kind: 'aggregate_cart_handoff',
                commandRequestId,
                cartId,
                fromWorkerId: input.expectedOwnerId,
                targetWorkerId: input.targetWorkerId,
                reason,
              },
            },
            trx,
          );
          movedQty += balance.qty;
        }
        return {
          response: {
            operationId: commandRequestId,
            sessionId: input.sessionId,
            sourceCartRef,
            targetCartRef,
            movedQty,
          },
          resourceType: 'batch_inventory_session',
          resourceId: input.sessionId,
        };
      },
      tx,
    );
  }

  async handoff(input: HandoffPickingInput, tx?: DbTx): Promise<PickingHandoffResult> {
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.handoff');
    return this.commands.execute<PickingHandoffResult>(
      {
        commandType: 'picking.aggregate_then_sort.handoff',
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
        await this.assertAggregateAssignedCustody(input.sessionId, input.shipmentId, input.workItemId, oldOwnerId, trx);
        const handedOff = await this.batches.handoff(
          input.workItemId,
          {
            claimType: 'picker',
            targetWorkerId: input.targetWorkerId,
            expectedLeaseVersion: input.expectedLeaseVersion,
            reason: input.reason,
          },
          `aggregate-handoff-claim:${commandRequestId}`,
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
        const balances = await this.assertAggregateAssignedCustody(
          input.sessionId,
          input.shipmentId,
          input.workItemId,
          oldOwnerId,
          trx,
        );
        let movedQty = 0;
        for (const balance of balances.filter((row) => row.custodyType === 'SORTING')) {
          if (!balance.sourceLocationId || !balance.shipmentLineId) {
            throw this.conflict('PICKING_CUSTODY_CORRUPT', `Sorting balance ${balance.id} is incomplete`);
          }
          await this.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `aggregate-handoff:${commandRequestId}:${balance.id}`,
              actorId: input.actor.id,
              quantity: balance.qty,
              from: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: 'SORTING',
                custodyRef: this.sortingRef(input.workItemId, oldOwnerId),
                shipmentLineId: balance.shipmentLineId,
              },
              to: {
                skuId: balance.skuId,
                sourceLocationId: balance.sourceLocationId,
                custodyType: 'SORTING',
                custodyRef: this.sortingRef(input.workItemId, input.targetWorkerId),
                shipmentLineId: balance.shipmentLineId,
              },
            },
            trx,
          );
          movedQty += balance.qty;
        }
        return {
          response: {
            operationId: commandRequestId,
            workItemId: input.workItemId,
            shipmentId: input.shipmentId,
            workerId: input.targetWorkerId,
            leaseVersion: handedOff.workItem.leaseVersion,
            movedQty,
          },
          resourceType: 'outbound_batch_work_item',
          resourceId: input.workItemId,
        };
      },
      tx,
    );
  }

  async completePick(input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput> {
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.complete');
    return this.commands.execute<InspectionReadyOutput>(
      {
        commandType: 'picking.aggregate_then_sort.complete',
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
        const sortingRef = this.sortingRef(input.workItemId, input.actor.id);
        const packingRef = this.packingRef(input.workItemId);
        for (const allocation of allocations) {
          const balances = await this.loadPositiveAllocationCustody(input.sessionId, allocation, trx);
          const total = balances.reduce((sum, balance) => sum + balance.qty, 0);
          if (
            total !== allocation.qty ||
            balances.some(
              (balance) =>
                (balance.custodyType !== 'SORTING' || balance.custodyRef !== sortingRef) &&
                (balance.custodyType !== 'PACKING' || balance.custodyRef !== packingRef),
            )
          ) {
            throw this.conflict(
              'PICKING_UNSORTED_REMAINDER',
              `Allocation ${allocation.shipmentLineId}/${allocation.sourceLocationId} is not fully sorted`,
            );
          }
          for (const balance of balances.filter((row) => row.custodyType === 'SORTING')) {
            await this.sessions.moveCustody(
              {
                sessionId: input.sessionId,
                idempotencyKey: `aggregate-complete:${commandRequestId}:${balance.id}`,
                actorId: input.actor.id,
                quantity: balance.qty,
                from: {
                  skuId: allocation.skuId,
                  sourceLocationId: allocation.sourceLocationId,
                  custodyType: 'SORTING',
                  custodyRef: sortingRef,
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
        return {
          response: {
            operationId: commandRequestId,
            workItemId: input.workItemId,
            shipmentId: input.shipmentId,
            custodyType: 'PACKING',
            custodyRef: packingRef,
            lines,
            totalQty: lines.reduce((total, line) => total + line.quantity, 0),
          },
          resourceType: 'outbound_batch_work_item',
          resourceId: input.workItemId,
        };
      },
      tx,
    );
  }

  async unpickShipment(input: UnpickShipmentInput, tx?: DbTx): Promise<UnpickShipmentResult> {
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.unpick');
    return this.commands.execute<UnpickShipmentResult>(
      {
        commandType: 'picking.aggregate_then_sort.unpick',
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

        const balances = await this.loadPositiveShipmentCustody(input.sessionId, input.shipmentId, trx);
        const allocationByGrain = new Map(
          allocations.map((allocation) => [`${allocation.shipmentLineId}|${allocation.sourceLocationId}`, allocation]),
        );
        const attributedByGrain = new Map<string, number>();
        const expectedSortingRef = this.sortingRef(input.workItemId, item.pickerId ?? input.actor.id);
        const expectedPackingRef = this.packingRef(input.workItemId);
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
          if (
            (balance.custodyType !== 'SORTING' || balance.custodyRef !== expectedSortingRef) &&
            (balance.custodyType !== 'PACKING' || balance.custodyRef !== expectedPackingRef)
          ) {
            throw this.conflict('PICKING_CUSTODY_OWNER_MISMATCH', `Balance ${balance.id} has unexpected custody`);
          }
        }
        if (
          item.status === 'ready_to_pack' &&
          (balances.length === 0 ||
            balances.some((balance) => balance.custodyType !== 'PACKING') ||
            allocations.some((allocation) => {
              const grain = `${allocation.shipmentLineId}|${allocation.sourceLocationId}`;
              return attributedByGrain.get(grain) !== allocation.qty;
            }))
        ) {
          throw this.conflict(
            'PICKING_PACKING_CUSTODY_INCOMPLETE',
            'Ready-to-pack custody must exactly match every plan allocation',
          );
        }
        let returnedToSourceQty = 0;
        for (const balance of balances) {
          if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
            throw this.conflict('PICKING_CUSTODY_CORRUPT', `Assigned balance ${balance.id} is incomplete`);
          }
          await this.sessions.moveCustody(
            {
              sessionId: input.sessionId,
              idempotencyKey: `aggregate-unpick:${commandRequestId}:${balance.id}`,
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
        return {
          response: {
            operationId: commandRequestId,
            workItemId: input.workItemId,
            shipmentId: input.shipmentId,
            status: 'queued',
            returnedToSourceQty,
          },
          resourceType: 'outbound_batch_work_item',
          resourceId: input.workItemId,
        };
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
    await this.invariant.assertFulfillmentOrders(uniqueSorted(initialLines.map((line) => line.fulfillmentOrderId)), tx);

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
    for (const skuId of skuIds) await acquireStockAvailabilityLock(tx, skuId, aggregate.batch.warehouseId);
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
      return 'Picking plan identity no longer matches the aggregate-then-sort batch';
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
      throw this.conflict(
        'PICKING_PLAN_NOT_ACTIVE',
        `Picking plan ${planId} is not an active aggregate-then-sort plan`,
      );
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

  private async loadLineAllocations(planId: string, shipmentLineId: string, tx: DbTx): Promise<ShipmentAllocation[]> {
    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
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
        and(
          eq(wmsTables.pickingSourceAllocations.planId, planId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, shipmentLineId),
        ),
      )
      .orderBy(asc(wmsTables.pickingSourceAllocations.sourceLocationId), asc(wmsTables.pickingSourceAllocations.id));
    if (!allocations.length) {
      throw this.conflict('PICKING_SHIPMENT_LINE_NOT_IN_PLAN', `Shipment line ${shipmentLineId} has no allocation`);
    }
    return allocations;
  }

  private async loadShipmentAllocations(planId: string, shipmentId: string, tx: DbTx): Promise<ShipmentAllocation[]> {
    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
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
        asc(wmsTables.pickingSourceAllocations.id),
      );
    if (!allocations.length) {
      throw this.conflict('PICKING_SHIPMENT_NOT_IN_PLAN', `Shipment ${shipmentId} has no plan allocation`);
    }
    return allocations;
  }

  private async loadPositiveAllocationCustody(
    sessionId: string,
    allocation: ShipmentAllocation,
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
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.skuId, allocation.skuId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, allocation.sourceLocationId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, allocation.shipmentLineId),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id));
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

  private async assertAggregateAssignedCustody(
    sessionId: string,
    shipmentId: string,
    workItemId: string,
    ownerId: string,
    tx: DbTx,
  ): Promise<ShipmentCustodyBalance[]> {
    const balances = await this.loadPositiveShipmentCustody(sessionId, shipmentId, tx);
    const sortingRef = this.sortingRef(workItemId, ownerId);
    const packingRef = this.packingRef(workItemId);
    if (
      balances.some(
        (balance) =>
          (balance.custodyType !== 'SORTING' || balance.custodyRef !== sortingRef) &&
          (balance.custodyType !== 'PACKING' || balance.custodyRef !== packingRef),
      )
    ) {
      throw this.conflict(
        'PICKING_CUSTODY_OWNER_MISMATCH',
        `Shipment assigned custody is not owned by picker ${ownerId}`,
      );
    }
    return balances;
  }

  private async acquireCartLock(cartId: string, tx: DbTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`aggregate-cart:${cartId}`}, 0))`);
  }

  private async loadGlobalCartBalances(cartId: string, tx: DbTx): Promise<GlobalCartBalance[]> {
    return tx
      .select({
        id: wmsTables.batchInventorySessionBalances.id,
        sessionId: wmsTables.batchInventorySessionBalances.sessionId,
        batchId: wmsTables.batchInventorySessions.batchId,
        skuId: wmsTables.batchInventorySessionBalances.skuId,
        sourceLocationId: wmsTables.batchInventorySessionBalances.sourceLocationId,
        custodyType: wmsTables.batchInventorySessionBalances.custodyType,
        custodyRef: wmsTables.batchInventorySessionBalances.custodyRef,
        shipmentLineId: wmsTables.batchInventorySessionBalances.shipmentLineId,
        qty: wmsTables.batchInventorySessionBalances.qty,
      })
      .from(wmsTables.batchInventorySessionBalances)
      .innerJoin(
        wmsTables.batchInventorySessions,
        eq(wmsTables.batchInventorySessions.id, wmsTables.batchInventorySessionBalances.sessionId),
      )
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'BULK_CART'),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
          sql`split_part(${wmsTables.batchInventorySessionBalances.custodyRef}, ':', 3) = ${cartId}`,
        ),
      )
      .orderBy(
        asc(wmsTables.batchInventorySessionBalances.sessionId),
        asc(wmsTables.batchInventorySessionBalances.skuId),
        asc(wmsTables.batchInventorySessionBalances.sourceLocationId),
        asc(wmsTables.batchInventorySessionBalances.id),
      )
      .for('update');
  }

  private async loadCartBalances(
    sessionId: string,
    batchId: string,
    cartId: string,
    tx: DbTx,
  ): Promise<ShipmentCustodyBalance[]> {
    const prefix = this.bulkCartPrefix(batchId, cartId);
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
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'BULK_CART'),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
          sql`left(${wmsTables.batchInventorySessionBalances.custodyRef}, ${prefix.length}) = ${prefix}`,
        ),
      )
      .orderBy(
        asc(wmsTables.batchInventorySessionBalances.skuId),
        asc(wmsTables.batchInventorySessionBalances.sourceLocationId),
        asc(wmsTables.batchInventorySessionBalances.id),
      )
      .for('update');
  }

  private async assertCartOwnedBy(
    sessionId: string,
    batchId: string,
    cartId: string,
    expectedOwnerId: string,
    tx: DbTx,
    requireNonEmpty = false,
  ): Promise<void> {
    const balances = await this.loadGlobalCartBalances(cartId, tx);
    if (requireNonEmpty && !balances.length) {
      throw this.conflict('AGGREGATE_CART_EMPTY', `Cart ${cartId} has no pooled custody`);
    }
    const expectedRef = this.bulkCartRef(batchId, cartId, expectedOwnerId);
    if (
      balances.some(
        (balance) =>
          balance.sessionId !== sessionId ||
          balance.batchId !== batchId ||
          balance.custodyRef !== expectedRef ||
          balance.shipmentLineId !== null,
      )
    ) {
      throw this.conflict(
        'AGGREGATE_CART_IN_USE',
        `Physical cart ${cartId} has positive custody in another session, batch, or owner scope`,
      );
    }
  }

  private bulkCartPrefix(batchId: string, cartId: string): string {
    return `${BULK_CART_REF_PREFIX}${encodeURIComponent(batchId)}:${encodeURIComponent(cartId)}:`;
  }

  private bulkCartRef(batchId: string, cartId: string, workerId: string): string {
    if (!workerId.trim()) throw new BadRequestException('workerId is required');
    return `${this.bulkCartPrefix(batchId, cartId)}${encodeURIComponent(workerId)}`;
  }

  private sortingRef(workItemId: string, workerId: string): string {
    return `sorting:${workItemId}:${workerId}`;
  }

  private packingRef(workItemId: string): string {
    return `${ASSIGNED_REF_PREFIX}${workItemId}`;
  }

  private async plannedResult(
    plan: typeof wmsTables.pickingPlans.$inferSelect,
    batchId: string,
    shipmentIds: string[],
    operationId: string,
    tx: DbTx,
  ): Promise<PickingPlanResult> {
    const [summary] = await tx
      .select({
        count: sql<number>`count(*)::int`,
        totalQty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int`,
      })
      .from(wmsTables.pickingSourceAllocations)
      .where(eq(wmsTables.pickingSourceAllocations.planId, plan.id));
    return {
      state: 'planned',
      operationId,
      planId: plan.id,
      batchId,
      strategy: this.capabilities.name,
      version: plan.version,
      shipmentIds,
      allocationCount: Number(summary?.count ?? 0),
      totalQty: Number(summary?.totalQty ?? 0),
    };
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
      .set({ status: 'invalidated', invalidatedAt: sql`now()`, invalidationReason: reason, updatedAt: sql`now()` })
      .where(
        and(
          eq(wmsTables.pickingPlans.id, planId),
          eq(wmsTables.pickingPlans.batchId, batchId),
          eq(wmsTables.pickingPlans.status, 'draft'),
        ),
      )
      .returning({ id: wmsTables.pickingPlans.id });
    if (!invalidated) {
      throw this.conflict('PICKING_PLAN_STALE_VERSION', `Picking plan ${planId} changed while invalidating`);
    }
    return { state: 'invalidated', operationId, planId, batchId, reason };
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

  private requiredCartId(value: string): string {
    const cartId = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(cartId)) {
      throw new BadRequestException('cartId must be 1-128 letters, digits, dots, underscores, or hyphens');
    }
    return cartId;
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

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return 'Picking plan validation failed';
  }

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, message });
  }
}
