import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { acquireStockAvailabilityLock } from '../../inventory/shared/locks/stock-availability-lock';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { AuditService } from '../../inventory/shared/services/audit.service';
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
  PickingStartResult,
  PickToToteStrategy,
  PlanPickingInput,
  ScanPickingInput,
  StartPickingInput,
  ToteAssignmentInput,
  ToteAssignmentResult,
  ToteHandoffInput,
  ToteHandoffResult,
  ToteRegistrationInput,
  ToteRegistrationResult,
  ToteReleaseInput,
  ToteReleaseResult,
  ToteScanPickingInput,
  ToteScanResult,
  UnpickShipmentInput,
  UnpickShipmentResult,
} from './picking-strategy.interface';

type BatchRow = typeof wmsTables.outboundBatches.$inferSelect;
type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;
type ToteRow = typeof wmsTables.totes.$inferSelect;
type ToteAssignmentRow = typeof wmsTables.shipmentToteAssignments.$inferSelect;

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
export class PickToTotePickingStrategy implements PickToToteStrategy {
  readonly capabilities = Object.freeze({
    name: 'pick_to_tote' as const,
    requiresPhysicalTote: true,
    supportsAggregateSourcePick: false,
    inspectionReadyCustody: 'PACKING' as const,
    custodyFlow: Object.freeze(['AT_SOURCE', 'TOTE', 'PACKING']),
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
    private readonly audit: AuditService,
  ) {}

  async plan(input: PlanPickingInput, tx?: DbTx): Promise<PickingPlanResult> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.plan');
    const shipmentIds = this.requiredIds('shipmentIds', input.shipmentIds);
    return this.commands.execute<PickingPlanResult>(
      {
        commandType: 'picking.pick_to_tote.plan',
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
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.start');
    return this.commands.execute<PickingStartResult>(
      {
        commandType: 'picking.pick_to_tote.start',
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

  async registerTote(input: ToteRegistrationInput, tx?: DbTx): Promise<ToteRegistrationResult> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.register_tote');
    const toteBarcode = this.requiredToteBarcode(input.toteBarcode);
    return this.commands.execute<ToteRegistrationResult>(
      {
        commandType: 'picking.pick_to_tote.register_tote',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: { warehouseId: input.warehouseId, toteBarcode, actorId: input.actor.id },
      },
      async (trx, commandRequestId) => {
        await this.acquireToteLock(toteBarcode, trx);
        if (await this.loadToteByBarcode(toteBarcode, trx, true, false)) {
          throw this.conflict('TOTE_ALREADY_REGISTERED', `Tote ${toteBarcode} is already registered`);
        }
        const [warehouse] = await trx
          .select({ id: wmsTables.warehouses.id })
          .from(wmsTables.warehouses)
          .where(eq(wmsTables.warehouses.id, input.warehouseId))
          .limit(1);
        if (!warehouse) throw new NotFoundException(`Warehouse ${input.warehouseId} not found`);
        const [tote] = await trx
          .insert(wmsTables.totes)
          .values({ warehouseId: input.warehouseId, barcode: toteBarcode, status: 'available', version: 1 })
          .returning();
        if (!tote) throw new Error('Tote registration did not return a row');
        return {
          response: {
            operationId: commandRequestId,
            toteId: tote.id,
            warehouseId: tote.warehouseId,
            toteBarcode: tote.barcode,
            status: 'available',
            version: tote.version,
          },
          resourceType: 'tote',
          resourceId: tote.id,
        };
      },
      tx,
    );
  }

  async assignTote(input: ToteAssignmentInput, tx?: DbTx): Promise<ToteAssignmentResult> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.assign_tote');
    const toteBarcode = this.requiredToteBarcode(input.toteBarcode);
    return this.commands.execute<ToteAssignmentResult>(
      {
        commandType: 'picking.pick_to_tote.assign_tote',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          toteBarcode,
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
        await this.assertPlanMembers(input.planId, [input.shipmentId], trx);
        await this.acquireToteLock(toteBarcode, trx);
        const tote = await this.loadToteForBatch(toteBarcode, input.batchId, trx);
        const assignments = await this.loadActiveToteAssignments(tote.id, trx);
        if (assignments.length > 1) {
          throw this.conflict('TOTE_ASSIGNMENT_CORRUPT', `Tote ${toteBarcode} has multiple active assignments`);
        }
        const existing = assignments[0];
        if (existing && existing.shipmentId !== input.shipmentId) {
          throw this.conflict(
            'TOTE_ALREADY_ASSIGNED',
            `Tote ${toteBarcode} is actively assigned to shipment ${existing.shipmentId}`,
          );
        }
        if (existing) {
          this.assertToteInUse(tote);
          return {
            response: {
              operationId: commandRequestId,
              assignmentId: existing.id,
              toteId: tote.id,
              toteBarcode,
              shipmentId: input.shipmentId,
              status: 'assigned',
            },
            resourceType: 'shipment_tote_assignment',
            resourceId: existing.id,
          };
        }
        if (tote.status !== 'available') {
          throw this.conflict('TOTE_NOT_AVAILABLE', `Tote ${toteBarcode} is ${tote.status}`);
        }
        const [assignment] = await trx
          .insert(wmsTables.shipmentToteAssignments)
          .values({ shipmentId: input.shipmentId, toteId: tote.id, assignedBy: input.actor.id })
          .returning();
        if (!assignment) throw new Error('Tote assignment did not return a row');
        const [updatedTote] = await trx
          .update(wmsTables.totes)
          .set({ status: 'in_use', version: tote.version + 1, updatedAt: sql`now()` })
          .where(and(eq(wmsTables.totes.id, tote.id), eq(wmsTables.totes.version, tote.version)))
          .returning({ id: wmsTables.totes.id });
        if (!updatedTote) throw this.conflict('TOTE_STALE_VERSION', `Tote ${toteBarcode} changed while assigning`);
        return {
          response: {
            operationId: commandRequestId,
            assignmentId: assignment.id,
            toteId: tote.id,
            toteBarcode,
            shipmentId: input.shipmentId,
            status: 'assigned',
          },
          resourceType: 'shipment_tote_assignment',
          resourceId: assignment.id,
        };
      },
      tx,
    );
  }

  async scan(input: ScanPickingInput, tx?: DbTx): Promise<ToteScanResult> {
    if (input.strategy !== 'pick_to_tote' || input.stage !== 'source') {
      throw new BadRequestException('Pick-to-tote accepts only strategy=pick_to_tote, stage=source scans');
    }
    return this.toteScan(input, tx);
  }

  async toteScan(input: ToteScanPickingInput, tx?: DbTx): Promise<ToteScanResult> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.scan');
    this.assertPositiveQuantity(input.quantity);
    const toteBarcode = this.requiredToteBarcode(input.toteBarcode);
    return this.commands.execute<ToteScanResult>(
      {
        commandType: 'picking.pick_to_tote.scan',
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
          toteBarcode,
          actorId: input.actor.id,
          expectedLeaseVersion: input.expectedLeaseVersion,
          stage: 'AT_SOURCE_TO_TOTE',
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
        await this.assertPlanMembers(input.planId, [input.shipmentId], trx);
        await this.acquireToteLock(toteBarcode, trx);
        const tote = await this.loadToteForBatch(toteBarcode, input.batchId, trx);
        this.assertToteInUse(tote);
        const assignment = await this.requireActiveToteAssignment(tote.id, input.shipmentId, trx);
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
            idempotencyKey: `pick-to-tote-scan:${commandRequestId}`,
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
              custodyType: 'TOTE',
              custodyRef: this.toteRef(tote.id),
              shipmentLineId: input.shipmentLineId,
            },
            context: {
              kind: 'pick_to_tote_scan',
              commandRequestId,
              toteId: tote.id,
              toteBarcode,
              assignmentId: assignment.id,
            },
          },
          trx,
        );
        const response: ToteScanResult = {
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
          toteId: tote.id,
          toteBarcode,
          toteRef: this.toteRef(tote.id),
        };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: input.workItemId };
      },
      tx,
    );
  }

  async releaseTote(input: ToteReleaseInput, tx?: DbTx): Promise<ToteReleaseResult> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.release_tote');
    const toteBarcode = this.requiredToteBarcode(input.toteBarcode);
    const reason = this.requiredReason(input.reason);
    return this.commands.execute<ToteReleaseResult>(
      {
        commandType: 'picking.pick_to_tote.release_tote',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          toteBarcode,
          expectedLeaseVersion: input.expectedLeaseVersion,
          reason,
          actorId: input.actor.id,
          actorRoles: [...input.actor.roles].sort(),
        },
      },
      async (trx, commandRequestId) => {
        await this.assertToteMutationAuthority(input, trx);
        await this.assertReleasePlanSession(input.planId, input.sessionId, input.batchId, trx);
        await this.assertPlanMembers(input.planId, [input.shipmentId], trx);
        await this.acquireToteLock(toteBarcode, trx);
        const tote = await this.loadToteForBatch(toteBarcode, input.batchId, trx);
        this.assertToteInUse(tote);
        const assignment = await this.requireActiveToteAssignment(tote.id, input.shipmentId, trx);
        await this.assertToteEmpty(tote.id, trx);
        const [released] = await trx
          .update(wmsTables.shipmentToteAssignments)
          .set({ releasedAt: sql`now()` })
          .where(
            and(
              eq(wmsTables.shipmentToteAssignments.id, assignment.id),
              isNull(wmsTables.shipmentToteAssignments.releasedAt),
            ),
          )
          .returning({ id: wmsTables.shipmentToteAssignments.id });
        if (!released) throw this.conflict('TOTE_ASSIGNMENT_STALE', 'Tote assignment changed while releasing');
        const [updatedTote] = await trx
          .update(wmsTables.totes)
          .set({ status: 'available', version: tote.version + 1, updatedAt: sql`now()` })
          .where(and(eq(wmsTables.totes.id, tote.id), eq(wmsTables.totes.version, tote.version)))
          .returning({ id: wmsTables.totes.id });
        if (!updatedTote) throw this.conflict('TOTE_STALE_VERSION', `Tote ${toteBarcode} changed while releasing`);
        await this.audit.logUserActionRequired(
          'picking.tote.release',
          'fulfillment',
          `Released tote ${toteBarcode} from shipment ${input.shipmentId}`,
          { userId: input.actor.id },
          {
            commandRequestId,
            toteId: tote.id,
            toteBarcode,
            sourceAssignmentId: assignment.id,
            sourceShipmentId: input.shipmentId,
            sourceWorkItemId: input.workItemId,
            sessionId: input.sessionId,
            reason,
            before: { status: tote.status, version: tote.version },
            after: { status: 'available', version: tote.version + 1 },
          },
          trx,
        );
        return {
          response: {
            operationId: commandRequestId,
            assignmentId: assignment.id,
            toteId: tote.id,
            toteBarcode,
            shipmentId: input.shipmentId,
            status: 'released',
          },
          resourceType: 'shipment_tote_assignment',
          resourceId: assignment.id,
        };
      },
      tx,
    );
  }

  async toteHandoff(input: ToteHandoffInput, tx?: DbTx): Promise<ToteHandoffResult> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.tote_handoff');
    const toteBarcode = this.requiredToteBarcode(input.toteBarcode);
    const reason = this.requiredReason(input.reason);
    if (!input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master')) {
      throw this.conflict('TOTE_HANDOFF_FORBIDDEN', 'Cross-shipment tote handoff requires logistics_manager or master');
    }
    if (input.shipmentId === input.targetShipmentId) {
      throw new BadRequestException('Target shipment must differ from source shipment');
    }
    return this.commands.execute<ToteHandoffResult>(
      {
        commandType: 'picking.pick_to_tote.tote_handoff',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          batchId: input.batchId,
          planId: input.planId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          targetWorkItemId: input.targetWorkItemId,
          targetShipmentId: input.targetShipmentId,
          toteBarcode,
          expectedLeaseVersion: input.expectedLeaseVersion,
          targetExpectedLeaseVersion: input.targetExpectedLeaseVersion,
          reason,
          actorId: input.actor.id,
          actorRoles: [...input.actor.roles].sort(),
        },
      },
      async (trx, commandRequestId) => {
        if (!input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master')) {
          throw this.conflict(
            'TOTE_HANDOFF_FORBIDDEN',
            'Cross-shipment tote handoff requires logistics_manager or master',
          );
        }
        const lockedItems = await this.loadWorkItemsForUpdate([input.workItemId, input.targetWorkItemId], trx);
        const source = lockedItems.get(input.workItemId);
        const target = lockedItems.get(input.targetWorkItemId);
        if (!source || !target) throw new NotFoundException('Source or target work item not found');
        await this.assertActiveWorkItemLease(source, input.batchId, input.shipmentId, input.expectedLeaseVersion, trx);
        await this.assertActiveWorkItemLease(
          target,
          input.batchId,
          input.targetShipmentId,
          input.targetExpectedLeaseVersion,
          trx,
        );
        await this.assertActivePlanSession(input.planId, input.sessionId, input.batchId, trx);
        await this.assertPlanMembers(input.planId, [input.shipmentId, input.targetShipmentId], trx);
        await this.acquireToteLock(toteBarcode, trx);
        const tote = await this.loadToteForBatch(toteBarcode, input.batchId, trx);
        this.assertToteInUse(tote);
        const sourceAssignment = await this.requireActiveToteAssignment(tote.id, input.shipmentId, trx);
        await this.assertToteEmpty(tote.id, trx);
        const [released] = await trx
          .update(wmsTables.shipmentToteAssignments)
          .set({ releasedAt: sql`now()` })
          .where(
            and(
              eq(wmsTables.shipmentToteAssignments.id, sourceAssignment.id),
              isNull(wmsTables.shipmentToteAssignments.releasedAt),
            ),
          )
          .returning({ id: wmsTables.shipmentToteAssignments.id });
        if (!released) throw this.conflict('TOTE_ASSIGNMENT_STALE', 'Tote assignment changed during handoff');
        const [targetAssignment] = await trx
          .insert(wmsTables.shipmentToteAssignments)
          .values({ shipmentId: input.targetShipmentId, toteId: tote.id, assignedBy: input.actor.id })
          .returning();
        if (!targetAssignment) throw new Error('Target tote assignment did not return a row');
        const [updatedTote] = await trx
          .update(wmsTables.totes)
          .set({ version: tote.version + 1, updatedAt: sql`now()` })
          .where(and(eq(wmsTables.totes.id, tote.id), eq(wmsTables.totes.version, tote.version)))
          .returning({ id: wmsTables.totes.id });
        if (!updatedTote) throw this.conflict('TOTE_STALE_VERSION', `Tote ${toteBarcode} changed during handoff`);
        await this.audit.logUserActionRequired(
          'picking.tote.handoff',
          'fulfillment',
          `Handed tote ${toteBarcode} from shipment ${input.shipmentId} to ${input.targetShipmentId}`,
          { userId: input.actor.id },
          {
            commandRequestId,
            toteId: tote.id,
            toteBarcode,
            sourceAssignmentId: sourceAssignment.id,
            sourceShipmentId: input.shipmentId,
            sourceWorkItemId: input.workItemId,
            targetAssignmentId: targetAssignment.id,
            targetShipmentId: input.targetShipmentId,
            targetWorkItemId: input.targetWorkItemId,
            sessionId: input.sessionId,
            reason,
            before: { status: tote.status, version: tote.version },
            after: { status: tote.status, version: tote.version + 1 },
          },
          trx,
        );
        return {
          response: {
            operationId: commandRequestId,
            toteId: tote.id,
            toteBarcode,
            sourceAssignmentId: sourceAssignment.id,
            targetAssignmentId: targetAssignment.id,
            sourceShipmentId: input.shipmentId,
            targetShipmentId: input.targetShipmentId,
            status: 'assigned',
          },
          resourceType: 'shipment_tote_assignment',
          resourceId: targetAssignment.id,
        };
      },
      tx,
    );
  }

  async handoff(input: HandoffPickingInput, tx?: DbTx): Promise<PickingHandoffResult> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.handoff');
    return this.commands.execute(
      {
        commandType: 'picking.pick_to_tote.handoff',
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
        const optimisticBalances = await this.loadPositiveShipmentCustody(input.sessionId, input.shipmentId, trx);
        await this.assertExclusiveToteCustody(optimisticBalances, input.shipmentId, trx);
        const handedOff = await this.batches.handoff(
          input.workItemId,
          {
            claimType: 'picker',
            targetWorkerId: input.targetWorkerId,
            expectedLeaseVersion: input.expectedLeaseVersion,
            reason: input.reason,
          },
          `pick_to_tote-handoff-claim:${commandRequestId}`,
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
        await this.assertPlanMembers(input.planId, [input.shipmentId], trx);
        const balances = await this.loadPositiveShipmentCustody(input.sessionId, input.shipmentId, trx);
        await this.assertExclusiveToteCustody(balances, input.shipmentId, trx);
        const response: PickingHandoffResult = {
          operationId: commandRequestId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          workerId: input.targetWorkerId,
          leaseVersion: handedOff.workItem.leaseVersion,
          movedQty: 0,
        };
        return { response, resourceType: 'outbound_batch_work_item', resourceId: input.workItemId };
      },
      tx,
    );
  }

  async completePick(input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput> {
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.complete');
    return this.commands.execute(
      {
        commandType: 'picking.pick_to_tote.complete',
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
        await this.assertPlanMembers(input.planId, [input.shipmentId], trx);
        const allocations = await this.loadShipmentAllocations(input.planId, input.shipmentId, trx);
        const packingRef = `${PACKING_REF_PREFIX}${input.workItemId}`;
        const activeToteRefs = await this.loadActiveShipmentToteRefs(input.shipmentId, trx);
        if (!activeToteRefs.size) {
          throw this.conflict('TOTE_ASSIGNMENT_REQUIRED', 'Shipment has no active tote assignment');
        }
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
          if (
            total !== allocation.qty ||
            balances.length === 0 ||
            balances.some(
              (balance) =>
                balance.custodyType !== 'TOTE' || !balance.custodyRef || !activeToteRefs.has(balance.custodyRef),
            )
          ) {
            throw this.conflict(
              'PICKING_INCOMPLETE',
              `Allocation ${allocation.shipmentLineId}/${allocation.sourceLocationId} is not fully held in assigned totes`,
            );
          }
          for (const balance of balances) {
            await this.sessions.moveCustody(
              {
                sessionId: input.sessionId,
                idempotencyKey: `pick-to-tote-complete:${commandRequestId}:${balance.id}`,
                actorId: input.actor.id,
                quantity: balance.qty,
                from: {
                  skuId: allocation.skuId,
                  sourceLocationId: allocation.sourceLocationId,
                  custodyType: 'TOTE',
                  custodyRef: balance.custodyRef!,
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
    this.workflowGate.assertV2MutationAllowed('picking.pick_to_tote.unpick');
    return this.commands.execute(
      {
        commandType: 'picking.pick_to_tote.unpick',
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
        await this.assertPlanMembers(input.planId, [input.shipmentId], trx);
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
          const activeToteRefs = await this.loadActiveShipmentToteRefs(input.shipmentId, trx);
          if (
            balances.some(
              (balance) =>
                balance.custodyType !== 'TOTE' || !balance.custodyRef || !activeToteRefs.has(balance.custodyRef),
            )
          ) {
            throw this.conflict(
              'PICKING_CUSTODY_OWNER_MISMATCH',
              'Active pick custody must be held only by totes assigned to the shipment',
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
              idempotencyKey: `pick_to_tote-unpick:${commandRequestId}:${balance.id}`,
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
        await this.releaseEmptyShipmentTotes(input.shipmentId, trx);
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
      return 'Picking plan identity no longer matches the pick_to_tote batch';
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
      throw this.conflict('PICKING_PLAN_NOT_ACTIVE', `Picking plan ${planId} is not an active pick_to_tote plan`);
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

  private async assertReleasePlanSession(planId: string, sessionId: string, batchId: string, tx: DbTx): Promise<void> {
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
    if (!plan || plan.batchId !== batchId || plan.strategy !== this.capabilities.name) {
      throw this.conflict('PICKING_PLAN_IDENTITY_MISMATCH', `Picking plan ${planId} is not a pick-to-tote batch plan`);
    }
    const [session] = await tx
      .select({ batchId: wmsTables.batchInventorySessions.batchId, status: wmsTables.batchInventorySessions.status })
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId))
      .limit(1)
      .for('update');
    if (!session || session.batchId !== batchId) {
      throw this.conflict(
        'PICKING_SESSION_IDENTITY_MISMATCH',
        `Inventory session ${sessionId} belongs to another batch`,
      );
    }
    const validLifecycle =
      (plan.status === 'active' && session.status === 'active') ||
      (plan.status === 'completed' && session.status === 'settled');
    if (!validLifecycle) {
      throw this.conflict(
        'TOTE_RELEASE_LIFECYCLE_MISMATCH',
        `Tote release requires active/active or completed/settled plan/session, got ${plan.status}/${session.status}`,
      );
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

  private async assertPlanMembers(planId: string, shipmentIds: string[], tx: DbTx): Promise<void> {
    const ids = uniqueSorted(shipmentIds);
    if (!ids.length || ids.length !== shipmentIds.length) {
      throw new BadRequestException('Plan member shipments must be unique and non-empty');
    }
    const rows = await tx
      .select({ shipmentId: wmsTables.pickingPlanMembers.shipmentId })
      .from(wmsTables.pickingPlanMembers)
      .where(
        and(eq(wmsTables.pickingPlanMembers.planId, planId), inArray(wmsTables.pickingPlanMembers.shipmentId, ids)),
      )
      .orderBy(asc(wmsTables.pickingPlanMembers.shipmentId))
      .for('update');
    if (rows.length !== ids.length || rows.some((row, index) => row.shipmentId !== ids[index])) {
      throw this.conflict('PICKING_SHIPMENT_NOT_IN_PLAN', 'Every requested shipment must belong to the active plan');
    }
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

  private async loadWorkItemsForUpdate(workItemIds: string[], tx: DbTx): Promise<Map<string, WorkItemRow>> {
    const ids = uniqueSorted(workItemIds);
    if (ids.length !== workItemIds.length) {
      throw new BadRequestException('Source and target work items must differ');
    }
    const rows = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(inArray(wmsTables.outboundBatchWorkItems.id, ids))
      .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
      .for('update');
    return new Map(rows.map((row) => [row.id, row]));
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

  private async assertExclusiveToteCustody(
    balances: ShipmentCustodyBalance[],
    shipmentId: string,
    tx: DbTx,
  ): Promise<void> {
    const activeToteRefs = await this.loadActiveShipmentToteRefs(shipmentId, tx);
    if (
      balances.some(
        (balance) => balance.custodyType !== 'TOTE' || !balance.custodyRef || !activeToteRefs.has(balance.custodyRef),
      )
    ) {
      throw this.conflict(
        'PICKING_CUSTODY_OWNER_MISMATCH',
        `Shipment attributed custody must be held only in totes actively assigned to ${shipmentId}`,
      );
    }
  }

  private toteRef(toteId: string): string {
    return `tote:${toteId}`;
  }

  private requiredToteBarcode(value: string): string {
    const barcode = value.trim();
    if (!barcode) throw new BadRequestException('toteBarcode is required');
    if (barcode.length > 128) throw new BadRequestException('toteBarcode must be at most 128 characters');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(barcode)) {
      throw new BadRequestException('toteBarcode contains unsupported characters');
    }
    return barcode;
  }

  private requiredReason(value: string): string {
    const reason = value.trim();
    if (!reason) throw new BadRequestException('reason is required');
    if (reason.length > 500) throw new BadRequestException('reason must be at most 500 characters');
    return reason;
  }

  private async acquireToteLock(toteBarcode: string, tx: DbTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${'physical-tote:' + toteBarcode}, 0))`);
  }

  private async loadToteByBarcode(
    toteBarcode: string,
    tx: DbTx,
    lock = true,
    required = true,
  ): Promise<ToteRow | undefined> {
    const query = tx.select().from(wmsTables.totes).where(eq(wmsTables.totes.barcode, toteBarcode)).limit(1);
    const rows = lock ? await query.for('update') : await query;
    const tote = rows[0];
    if (!tote && required) throw new NotFoundException(`Tote ${toteBarcode} is not registered`);
    return tote;
  }

  private async loadToteForBatch(toteBarcode: string, batchId: string, tx: DbTx): Promise<ToteRow> {
    const [batch] = await tx
      .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, batchId))
      .limit(1);
    if (!batch) throw new NotFoundException(`Outbound batch ${batchId} not found`);
    const tote = await this.loadToteByBarcode(toteBarcode, tx, true, true);
    if (!tote) throw new NotFoundException(`Tote ${toteBarcode} is not registered`);
    if (tote.warehouseId !== batch.warehouseId) {
      throw this.conflict('TOTE_WRONG_WAREHOUSE', `Tote ${toteBarcode} belongs to another warehouse`);
    }
    if (tote.status === 'damaged' || tote.status === 'retired') {
      throw this.conflict('TOTE_NOT_USABLE', `Tote ${toteBarcode} is ${tote.status}`);
    }
    return tote;
  }

  private assertToteInUse(tote: ToteRow): void {
    if (tote.status !== 'in_use') {
      throw this.conflict('TOTE_ASSIGNMENT_STATE_MISMATCH', `Assigned tote ${tote.barcode} is ${tote.status}`);
    }
  }

  private async loadActiveToteAssignments(toteId: string, tx: DbTx): Promise<ToteAssignmentRow[]> {
    return tx
      .select()
      .from(wmsTables.shipmentToteAssignments)
      .where(
        and(eq(wmsTables.shipmentToteAssignments.toteId, toteId), isNull(wmsTables.shipmentToteAssignments.releasedAt)),
      )
      .orderBy(asc(wmsTables.shipmentToteAssignments.id))
      .for('update');
  }

  private async requireActiveToteAssignment(toteId: string, shipmentId: string, tx: DbTx): Promise<ToteAssignmentRow> {
    const assignments = await this.loadActiveToteAssignments(toteId, tx);
    if (assignments.length > 1) {
      throw this.conflict('TOTE_ASSIGNMENT_CORRUPT', `Tote ${toteId} has multiple active assignments`);
    }
    const assignment = assignments[0];
    if (!assignment) throw this.conflict('TOTE_NOT_ASSIGNED', `Tote ${toteId} has no active assignment`);
    if (assignment.shipmentId !== shipmentId) {
      throw this.conflict(
        'TOTE_WRONG_SHIPMENT',
        `Tote ${toteId} is assigned to shipment ${assignment.shipmentId}, not ${shipmentId}`,
      );
    }
    return assignment;
  }

  private async loadActiveShipmentToteRefs(shipmentId: string, tx: DbTx): Promise<Set<string>> {
    const candidates = await tx
      .select({ toteBarcode: wmsTables.totes.barcode, toteStatus: wmsTables.totes.status })
      .from(wmsTables.shipmentToteAssignments)
      .innerJoin(wmsTables.totes, eq(wmsTables.totes.id, wmsTables.shipmentToteAssignments.toteId))
      .where(
        and(
          eq(wmsTables.shipmentToteAssignments.shipmentId, shipmentId),
          isNull(wmsTables.shipmentToteAssignments.releasedAt),
        ),
      )
      .orderBy(asc(wmsTables.totes.barcode));
    for (const candidate of candidates) {
      if (candidate.toteStatus !== 'in_use') {
        throw this.conflict(
          'TOTE_ASSIGNMENT_STATE_MISMATCH',
          `Assigned tote ${candidate.toteBarcode} is ${candidate.toteStatus}`,
        );
      }
      await this.acquireToteLock(candidate.toteBarcode, tx);
    }
    const rows = await tx
      .select({ toteId: wmsTables.shipmentToteAssignments.toteId })
      .from(wmsTables.shipmentToteAssignments)
      .where(
        and(
          eq(wmsTables.shipmentToteAssignments.shipmentId, shipmentId),
          isNull(wmsTables.shipmentToteAssignments.releasedAt),
        ),
      )
      .orderBy(asc(wmsTables.shipmentToteAssignments.toteId))
      .for('update');
    return new Set(rows.map((row) => this.toteRef(row.toteId)));
  }

  private async assertToteEmpty(toteId: string, tx: DbTx): Promise<void> {
    const balances = await tx
      .select({ id: wmsTables.batchInventorySessionBalances.id })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.custodyType, 'TOTE'),
          eq(wmsTables.batchInventorySessionBalances.custodyRef, this.toteRef(toteId)),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .limit(1)
      .for('update');
    if (balances.length) {
      throw this.conflict('TOTE_NOT_EMPTY', `Tote ${toteId} still contains active custody`);
    }
  }

  private async assertToteMutationAuthority(input: ToteAssignmentInput, tx: DbTx): Promise<void> {
    const item = await this.loadWorkItem(input.workItemId, tx, true);
    this.assertWorkItemIdentity(item, input.batchId, input.shipmentId);
    if (item.leaseVersion !== input.expectedLeaseVersion) {
      throw this.conflict('PICKING_STALE_CLAIM', `Work item ${item.id} lease version changed`);
    }
    const privileged = input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master');
    const now = await this.databaseNow(tx);
    if (item.status === 'picking') {
      if (
        item.pickerId !== input.actor.id ||
        item.pickerReleasedAt ||
        !item.leaseExpiresAt ||
        item.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        throw this.conflict('PICKING_STALE_CLAIM', 'Only the active picker may release this tote');
      }
      return;
    }
    if (item.status === 'ready_to_pack') {
      if (item.pickerId !== input.actor.id && !privileged) {
        throw this.conflict('TOTE_RELEASE_FORBIDDEN', 'Only the previous picker or a manager may release this tote');
      }
      return;
    }
    if (item.status === 'packing') {
      if (!privileged && item.packerId !== input.actor.id) {
        throw this.conflict('TOTE_RELEASE_FORBIDDEN', 'Only the active packer or a manager may release this tote');
      }
      if (
        !privileged &&
        (item.packerReleasedAt || !item.leaseExpiresAt || item.leaseExpiresAt.getTime() <= now.getTime())
      ) {
        throw this.conflict('PICKING_STALE_CLAIM', 'Packer lease is no longer active');
      }
      return;
    }
    if (item.status === 'completed' && privileged) return;
    throw this.conflict(
      'TOTE_RELEASE_FORBIDDEN',
      'Completed work requires a manager; other states cannot release totes',
    );
  }

  private async assertActiveWorkItemLease(
    item: WorkItemRow,
    batchId: string,
    shipmentId: string,
    expectedLeaseVersion: number,
    tx: DbTx,
  ): Promise<void> {
    this.assertWorkItemIdentity(item, batchId, shipmentId);
    const now = await this.databaseNow(tx);
    if (
      item.status !== 'picking' ||
      !item.pickerId ||
      item.pickerReleasedAt ||
      item.leaseVersion !== expectedLeaseVersion ||
      !item.leaseExpiresAt ||
      item.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw this.conflict('PICKING_STALE_CLAIM', `Work item ${item.id} has no active picker lease`);
    }
  }

  private async releaseEmptyShipmentTotes(shipmentId: string, tx: DbTx): Promise<void> {
    const rows = await tx
      .select({
        assignmentId: wmsTables.shipmentToteAssignments.id,
        toteId: wmsTables.totes.id,
        toteBarcode: wmsTables.totes.barcode,
        toteVersion: wmsTables.totes.version,
      })
      .from(wmsTables.shipmentToteAssignments)
      .innerJoin(wmsTables.totes, eq(wmsTables.totes.id, wmsTables.shipmentToteAssignments.toteId))
      .where(
        and(
          eq(wmsTables.shipmentToteAssignments.shipmentId, shipmentId),
          isNull(wmsTables.shipmentToteAssignments.releasedAt),
        ),
      )
      .orderBy(asc(wmsTables.totes.barcode));
    for (const row of rows) {
      await this.acquireToteLock(row.toteBarcode, tx);
      await this.requireActiveToteAssignment(row.toteId, shipmentId, tx);
      await this.assertToteEmpty(row.toteId, tx);
      await tx
        .update(wmsTables.shipmentToteAssignments)
        .set({ releasedAt: sql`now()` })
        .where(
          and(
            eq(wmsTables.shipmentToteAssignments.id, row.assignmentId),
            isNull(wmsTables.shipmentToteAssignments.releasedAt),
          ),
        );
      const [updated] = await tx
        .update(wmsTables.totes)
        .set({ status: 'available', version: row.toteVersion + 1, updatedAt: sql`now()` })
        .where(and(eq(wmsTables.totes.id, row.toteId), eq(wmsTables.totes.version, row.toteVersion)))
        .returning({ id: wmsTables.totes.id });
      if (!updated) throw this.conflict('TOTE_STALE_VERSION', `Tote ${row.toteBarcode} changed while releasing`);
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
