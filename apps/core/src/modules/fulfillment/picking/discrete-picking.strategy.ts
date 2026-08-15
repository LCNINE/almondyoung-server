import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchInventorySessionService } from '../services/batch-inventory-session.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import {
  CompletePickInput,
  HandoffPickingInput,
  InspectionReadyOutput,
  PickingHandoffResult,
  PickingScanResult,
  PickingStrategy,
  ScanPickingInput,
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
import { ShipmentCustodyBalance } from './plan/picking-plan.types';

const PACKING_REF_PREFIX = 'work-item:';

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
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly sessions: BatchInventorySessionService,
    private readonly batches: OutboundBatchOrchestrator,
  ) {}

  async scan(input: ScanPickingInput, tx?: DbTx): Promise<PickingScanResult> {
    if (input.strategy === 'aggregate_then_sort' || input.strategy === 'pick_to_tote') {
      throw new BadRequestException('Discrete picking accepts only strategy=discrete, stage=source scans');
    }
    this.workflowGate.assertV2MutationAllowed('picking.discrete.scan');
    assertPositiveQuantity(input.quantity);
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
        const item = await loadWorkItem(trx, input.workItemId);
        assertWorkItemIdentity(item, input.batchId, input.shipmentId);
        if (item.status !== 'picking' || !item.pickerId || item.leaseVersion !== input.expectedLeaseVersion) {
          throw conflict('PICKING_HANDOFF_NOT_ACTIVE', 'Work item has no active picker to hand off');
        }
        const oldOwnerId = item.pickerId;
        const optimisticBalances = await loadPositiveShipmentCustody(trx, input.sessionId, input.shipmentId);
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
          throw conflict('PICKING_HANDOFF_STALE', 'Picker handoff returned an unexpected work item state');
        }
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
        const balances = await loadPositiveShipmentCustody(trx, input.sessionId, input.shipmentId);
        this.assertExclusiveWorkerCustody(balances, oldOwnerId);

        let movedQty = 0;
        for (const balance of balances) {
          if (oldOwnerId === input.targetWorkerId) continue;
          if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
            throw conflict('PICKING_CUSTODY_CORRUPT', `Worker balance ${balance.id} is incomplete`);
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
            throw conflict(
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
          if (balances.some((balance) => balance.custodyType !== 'WORKER' || balance.custodyRef !== input.actor.id)) {
            throw conflict(
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

  private assertExclusiveWorkerCustody(balances: ShipmentCustodyBalance[], workerId: string): void {
    if (balances.some((balance) => balance.custodyType !== 'WORKER' || balance.custodyRef !== workerId)) {
      throw conflict(
        'PICKING_CUSTODY_OWNER_MISMATCH',
        `Shipment attributed custody must be exclusively WORKER custody owned by ${workerId}`,
      );
    }
  }
}
