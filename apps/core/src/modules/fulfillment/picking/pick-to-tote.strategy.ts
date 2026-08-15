import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { BatchInventorySessionService } from '../services/batch-inventory-session.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import {
  CompletePickInput,
  HandoffPickingInput,
  InspectionReadyOutput,
  PickingHandoffResult,
  PickToToteStrategy,
  ScanPickingInput,
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
import { conflict } from './plan/picking-plan.errors';
import {
  assertActivePlanSession,
  assertPlanMembers,
  assertPositiveQuantity,
  assertWorkItemIdentity,
  databaseNow,
  loadPositiveShipmentCustody,
  loadShipmentAllocations,
  loadWorkItem,
  lockAndAssertPickerClaim,
} from './plan/picking-plan.queries';
import { ShipmentCustodyBalance, WorkItemRow, uniqueSorted } from './plan/picking-plan.types';

type ToteRow = typeof wmsTables.totes.$inferSelect;
type ToteAssignmentRow = typeof wmsTables.shipmentToteAssignments.$inferSelect;

const PACKING_REF_PREFIX = 'work-item:';

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
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly sessions: BatchInventorySessionService,
    private readonly batches: OutboundBatchOrchestrator,
    private readonly audit: AuditService,
  ) {}

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
          throw conflict('TOTE_ALREADY_REGISTERED', `Tote ${toteBarcode} is already registered`);
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
        await lockAndAssertPickerClaim(
          trx,
          input.workItemId,
          input.batchId,
          input.shipmentId,
          input.actor.id,
          input.expectedLeaseVersion,
        );
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
        await this.acquireToteLock(toteBarcode, trx);
        const tote = await this.loadToteForBatch(toteBarcode, input.batchId, trx);
        const assignments = await this.loadActiveToteAssignments(tote.id, trx);
        if (assignments.length > 1) {
          throw conflict('TOTE_ASSIGNMENT_CORRUPT', `Tote ${toteBarcode} has multiple active assignments`);
        }
        const existing = assignments[0];
        if (existing && existing.shipmentId !== input.shipmentId) {
          throw conflict(
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
          throw conflict('TOTE_NOT_AVAILABLE', `Tote ${toteBarcode} is ${tote.status}`);
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
        if (!updatedTote) throw conflict('TOTE_STALE_VERSION', `Tote ${toteBarcode} changed while assigning`);
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
    assertPositiveQuantity(input.quantity);
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
        await lockAndAssertPickerClaim(
          trx,
          input.workItemId,
          input.batchId,
          input.shipmentId,
          input.actor.id,
          input.expectedLeaseVersion,
        );
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
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
          throw conflict('PICKING_WRONG_SHIPMENT_LINE', 'Scanned shipment line does not belong to the work item');
        }
        if (line.skuId !== input.skuId) {
          throw conflict('PICKING_WRONG_SKU', 'Scanned SKU does not match the shipment line');
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
          throw conflict('PICKING_WRONG_SOURCE', 'Shipment line is not allocated from the scanned source');
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
          throw conflict(
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
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
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
        if (!released) throw conflict('TOTE_ASSIGNMENT_STALE', 'Tote assignment changed while releasing');
        const [updatedTote] = await trx
          .update(wmsTables.totes)
          .set({ status: 'available', version: tote.version + 1, updatedAt: sql`now()` })
          .where(and(eq(wmsTables.totes.id, tote.id), eq(wmsTables.totes.version, tote.version)))
          .returning({ id: wmsTables.totes.id });
        if (!updatedTote) throw conflict('TOTE_STALE_VERSION', `Tote ${toteBarcode} changed while releasing`);
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
      throw conflict('TOTE_HANDOFF_FORBIDDEN', 'Cross-shipment tote handoff requires logistics_manager or master');
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
          throw conflict('TOTE_HANDOFF_FORBIDDEN', 'Cross-shipment tote handoff requires logistics_manager or master');
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
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId, input.targetShipmentId]);
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
        if (!released) throw conflict('TOTE_ASSIGNMENT_STALE', 'Tote assignment changed during handoff');
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
        if (!updatedTote) throw conflict('TOTE_STALE_VERSION', `Tote ${toteBarcode} changed during handoff`);
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
        const item = await loadWorkItem(trx, input.workItemId);
        assertWorkItemIdentity(item, input.batchId, input.shipmentId);
        if (item.status !== 'picking' || !item.pickerId || item.leaseVersion !== input.expectedLeaseVersion) {
          throw conflict('PICKING_HANDOFF_NOT_ACTIVE', 'Work item has no active picker to hand off');
        }
        const optimisticBalances = await loadPositiveShipmentCustody(trx, input.sessionId, input.shipmentId);
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
          throw conflict('PICKING_HANDOFF_STALE', 'Picker handoff returned an unexpected work item state');
        }
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
        const balances = await loadPositiveShipmentCustody(trx, input.sessionId, input.shipmentId);
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
        await lockAndAssertPickerClaim(
          trx,
          input.workItemId,
          input.batchId,
          input.shipmentId,
          input.actor.id,
          input.expectedLeaseVersion,
        );
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
        const allocations = await loadShipmentAllocations(trx, input.planId, input.shipmentId);
        const packingRef = `${PACKING_REF_PREFIX}${input.workItemId}`;
        const activeToteRefs = await this.loadActiveShipmentToteRefs(input.shipmentId, trx);
        if (!activeToteRefs.size) {
          throw conflict('TOTE_ASSIGNMENT_REQUIRED', 'Shipment has no active tote assignment');
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
            throw conflict(
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

        const now = await databaseNow(trx);
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
        if (!completed) throw conflict('PICKING_STALE_CLAIM', 'Picker claim changed while completing pick');

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
        const item = await loadWorkItem(trx, input.workItemId, true);
        assertWorkItemIdentity(item, input.batchId, input.shipmentId);
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
        if (item.leaseVersion !== input.expectedLeaseVersion) {
          throw conflict('PICKING_STALE_CLAIM', `Work item ${item.id} lease version changed`);
        }
        const allocations = await loadShipmentAllocations(trx, input.planId, input.shipmentId);
        const privileged = input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master');
        const now = await databaseNow(trx);
        if (item.status === 'picking') {
          if (
            item.pickerId !== input.actor.id ||
            item.pickerReleasedAt ||
            !item.leaseExpiresAt ||
            item.leaseExpiresAt.getTime() <= now.getTime()
          ) {
            throw conflict('PICKING_STALE_CLAIM', 'Only the active picker may unpick this work item');
          }
        } else if (item.status === 'ready_to_pack') {
          if (item.pickerId !== input.actor.id && !privileged) {
            throw conflict('PICKING_UNPICK_FORBIDDEN', 'Only the previous picker or a manager may unpick');
          }
        } else {
          throw conflict('PICKING_NOT_UNPICKABLE', `Work item ${item.id} is ${item.status}`);
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
            throw conflict('PICKING_CUSTODY_GRAIN_MISMATCH', `Balance ${balance.id} is not a plan allocation`);
          }
          attributedByGrain.set(grain, (attributedByGrain.get(grain) ?? 0) + balance.qty);
          if ((attributedByGrain.get(grain) ?? 0) > allocation.qty) {
            throw conflict('PICKING_CUSTODY_OVERATTRIBUTED', `Balance grain ${grain} exceeds its allocation`);
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
            throw conflict(
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
            throw conflict(
              'PICKING_PACKING_CUSTODY_INCOMPLETE',
              'Ready-to-pack custody must exactly match every plan allocation',
            );
          }
        }
        let returnedToSourceQty = 0;
        for (const balance of balances) {
          if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
            throw conflict('PICKING_CUSTODY_CORRUPT', `Assigned balance ${balance.id} is incomplete`);
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
        if (!requeued) throw conflict('PICKING_STALE_CLAIM', 'Work item changed while unpicking');
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
      throw conflict('PICKING_PLAN_IDENTITY_MISMATCH', `Picking plan ${planId} is not a pick-to-tote batch plan`);
    }
    const [session] = await tx
      .select({ batchId: wmsTables.batchInventorySessions.batchId, status: wmsTables.batchInventorySessions.status })
      .from(wmsTables.batchInventorySessions)
      .where(eq(wmsTables.batchInventorySessions.id, sessionId))
      .limit(1)
      .for('update');
    if (!session || session.batchId !== batchId) {
      throw conflict('PICKING_SESSION_IDENTITY_MISMATCH', `Inventory session ${sessionId} belongs to another batch`);
    }
    const validLifecycle =
      (plan.status === 'active' && session.status === 'active') ||
      (plan.status === 'completed' && session.status === 'settled');
    if (!validLifecycle) {
      throw conflict(
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
    if (!identity) throw conflict('PICKING_SESSION_PLAN_MISMATCH', 'Inventory session belongs to another plan');
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
      throw conflict(
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
      throw conflict('TOTE_WRONG_WAREHOUSE', `Tote ${toteBarcode} belongs to another warehouse`);
    }
    if (tote.status === 'damaged' || tote.status === 'retired') {
      throw conflict('TOTE_NOT_USABLE', `Tote ${toteBarcode} is ${tote.status}`);
    }
    return tote;
  }

  private assertToteInUse(tote: ToteRow): void {
    if (tote.status !== 'in_use') {
      throw conflict('TOTE_ASSIGNMENT_STATE_MISMATCH', `Assigned tote ${tote.barcode} is ${tote.status}`);
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
      throw conflict('TOTE_ASSIGNMENT_CORRUPT', `Tote ${toteId} has multiple active assignments`);
    }
    const assignment = assignments[0];
    if (!assignment) throw conflict('TOTE_NOT_ASSIGNED', `Tote ${toteId} has no active assignment`);
    if (assignment.shipmentId !== shipmentId) {
      throw conflict(
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
        throw conflict(
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
      throw conflict('TOTE_NOT_EMPTY', `Tote ${toteId} still contains active custody`);
    }
  }

  private async assertToteMutationAuthority(input: ToteAssignmentInput, tx: DbTx): Promise<void> {
    const item = await loadWorkItem(tx, input.workItemId, true);
    assertWorkItemIdentity(item, input.batchId, input.shipmentId);
    if (item.leaseVersion !== input.expectedLeaseVersion) {
      throw conflict('PICKING_STALE_CLAIM', `Work item ${item.id} lease version changed`);
    }
    const privileged = input.actor.roles.some((role) => role === 'logistics_manager' || role === 'master');
    const now = await databaseNow(tx);
    if (item.status === 'picking') {
      if (
        item.pickerId !== input.actor.id ||
        item.pickerReleasedAt ||
        !item.leaseExpiresAt ||
        item.leaseExpiresAt.getTime() <= now.getTime()
      ) {
        throw conflict('PICKING_STALE_CLAIM', 'Only the active picker may release this tote');
      }
      return;
    }
    if (item.status === 'ready_to_pack') {
      if (item.pickerId !== input.actor.id && !privileged) {
        throw conflict('TOTE_RELEASE_FORBIDDEN', 'Only the previous picker or a manager may release this tote');
      }
      return;
    }
    if (item.status === 'packing') {
      if (!privileged && item.packerId !== input.actor.id) {
        throw conflict('TOTE_RELEASE_FORBIDDEN', 'Only the active packer or a manager may release this tote');
      }
      if (
        !privileged &&
        (item.packerReleasedAt || !item.leaseExpiresAt || item.leaseExpiresAt.getTime() <= now.getTime())
      ) {
        throw conflict('PICKING_STALE_CLAIM', 'Packer lease is no longer active');
      }
      return;
    }
    if (item.status === 'completed' && privileged) return;
    throw conflict('TOTE_RELEASE_FORBIDDEN', 'Completed work requires a manager; other states cannot release totes');
  }

  private async assertActiveWorkItemLease(
    item: WorkItemRow,
    batchId: string,
    shipmentId: string,
    expectedLeaseVersion: number,
    tx: DbTx,
  ): Promise<void> {
    assertWorkItemIdentity(item, batchId, shipmentId);
    const now = await databaseNow(tx);
    if (
      item.status !== 'picking' ||
      !item.pickerId ||
      item.pickerReleasedAt ||
      item.leaseVersion !== expectedLeaseVersion ||
      !item.leaseExpiresAt ||
      item.leaseExpiresAt.getTime() <= now.getTime()
    ) {
      throw conflict('PICKING_STALE_CLAIM', `Work item ${item.id} has no active picker lease`);
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
      if (!updated) throw conflict('TOTE_STALE_VERSION', `Tote ${row.toteBarcode} changed while releasing`);
    }
  }
}
