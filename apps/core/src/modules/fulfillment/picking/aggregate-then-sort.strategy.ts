import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchInventorySessionService } from '../services/batch-inventory-session.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
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
  ScanPickingResult,
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
import { ShipmentAllocation, ShipmentCustodyBalance } from './plan/picking-plan.types';

const ASSIGNED_REF_PREFIX = 'work-item:';
const BULK_CART_REF_PREFIX = 'bulk-cart:';

interface GlobalCartBalance extends ShipmentCustodyBalance {
  sessionId: string;
  batchId: string;
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
    private readonly commands: FulfillmentCommandService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly sessions: BatchInventorySessionService,
    private readonly batches: OutboundBatchOrchestrator,
  ) {}

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
    assertPositiveQuantity(input.quantity);
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
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.actor.id, trx);

        const [allocated] = await trx
          .select({ qty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int` })
          .from(wmsTables.pickingSourceAllocations)
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
          )
          .innerJoin(
            wmsTables.pickingPlanMembers,
            and(
              eq(wmsTables.pickingPlanMembers.planId, wmsTables.pickingSourceAllocations.planId),
              eq(wmsTables.pickingPlanMembers.shipmentId, wmsTables.shipmentLines.shipmentId),
            ),
          )
          .where(
            and(
              eq(wmsTables.pickingSourceAllocations.planId, input.planId),
              eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
              eq(wmsTables.shipmentLines.skuId, input.skuId),
              isNull(wmsTables.pickingPlanMembers.retiredAt),
            ),
          );
        if (Number(allocated?.qty ?? 0) <= 0) {
          throw conflict('PICKING_WRONG_SOURCE', 'SKU/source is not allocated by this picking plan');
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
    assertPositiveQuantity(input.quantity);
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
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.actor.id, trx, true);
        const [line] = await trx
          .select({ shipmentId: wmsTables.shipmentLines.shipmentId, skuId: wmsTables.shipmentLines.skuId })
          .from(wmsTables.shipmentLines)
          .where(eq(wmsTables.shipmentLines.id, input.shipmentLineId))
          .limit(1);
        if (!line || line.shipmentId !== input.shipmentId) {
          throw conflict('PICKING_WRONG_SHIPMENT_LINE', 'Sort destination line does not belong to the work item');
        }
        if (line.skuId !== input.skuId) {
          throw conflict('PICKING_WRONG_SKU', 'Sorted SKU does not match the shipment line');
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
            throw conflict('PICKING_CUSTODY_OWNER_MISMATCH', 'Line custody belongs to another sort destination');
          }
          if (attributed > allocation.qty) {
            throw conflict('PICKING_CUSTODY_OVERATTRIBUTED', 'Sorted custody exceeds its plan allocation');
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
          throw conflict(
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
      throw conflict('AGGREGATE_CART_HANDOFF_FORBIDDEN', 'Cart handoff requires logistics_manager or master');
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
          throw conflict('AGGREGATE_CART_HANDOFF_FORBIDDEN', 'Cart handoff requires logistics_manager or master');
        }
        await this.acquireCartLock(cartId, trx);
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.expectedOwnerId, trx, true);
        const sourceCartRef = this.bulkCartRef(input.batchId, cartId, input.expectedOwnerId);
        const targetCartRef = this.bulkCartRef(input.batchId, cartId, input.targetWorkerId);
        const balances = await this.loadCartBalances(input.sessionId, input.batchId, cartId, trx);
        if (!balances.length) {
          throw conflict('AGGREGATE_CART_EMPTY', `Cart ${cartId} has no pooled custody to hand off`);
        }
        let movedQty = 0;
        for (const balance of balances) {
          if (!balance.sourceLocationId || balance.custodyRef !== sourceCartRef || balance.shipmentLineId) {
            throw conflict('AGGREGATE_CART_OWNER_MISMATCH', `Cart balance ${balance.id} has mixed ownership`);
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
        const item = await loadWorkItem(trx, input.workItemId);
        assertWorkItemIdentity(item, input.batchId, input.shipmentId);
        if (item.status !== 'picking' || !item.pickerId || item.leaseVersion !== input.expectedLeaseVersion) {
          throw conflict('PICKING_HANDOFF_NOT_ACTIVE', 'Work item has no active picker to hand off');
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
          throw conflict('PICKING_HANDOFF_STALE', 'Picker handoff returned an unexpected work item state');
        }
        await assertActivePlanSession(trx, input.planId, input.sessionId, input.batchId, this.capabilities.name);
        await assertPlanMembers(trx, input.planId, [input.shipmentId]);
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
            throw conflict('PICKING_CUSTODY_CORRUPT', `Sorting balance ${balance.id} is incomplete`);
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
            throw conflict(
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

        const balances = await loadPositiveShipmentCustody(trx, input.sessionId, input.shipmentId);
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
            throw conflict('PICKING_CUSTODY_GRAIN_MISMATCH', `Balance ${balance.id} is not a plan allocation`);
          }
          attributedByGrain.set(grain, (attributedByGrain.get(grain) ?? 0) + balance.qty);
          if ((attributedByGrain.get(grain) ?? 0) > allocation.qty) {
            throw conflict('PICKING_CUSTODY_OVERATTRIBUTED', `Balance grain ${grain} exceeds its allocation`);
          }
          if (
            (balance.custodyType !== 'SORTING' || balance.custodyRef !== expectedSortingRef) &&
            (balance.custodyType !== 'PACKING' || balance.custodyRef !== expectedPackingRef)
          ) {
            throw conflict('PICKING_CUSTODY_OWNER_MISMATCH', `Balance ${balance.id} has unexpected custody`);
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
          throw conflict(
            'PICKING_PACKING_CUSTODY_INCOMPLETE',
            'Ready-to-pack custody must exactly match every plan allocation',
          );
        }
        let returnedToSourceQty = 0;
        for (const balance of balances) {
          if (!balance.sourceLocationId || !balance.custodyRef || !balance.shipmentLineId) {
            throw conflict('PICKING_CUSTODY_CORRUPT', `Assigned balance ${balance.id} is incomplete`);
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
        if (!requeued) throw conflict('PICKING_STALE_CLAIM', 'Work item changed while unpicking');
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
      throw conflict('PICKING_SHIPMENT_LINE_NOT_IN_PLAN', `Shipment line ${shipmentLineId} has no allocation`);
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

  private async assertAggregateAssignedCustody(
    sessionId: string,
    shipmentId: string,
    workItemId: string,
    ownerId: string,
    tx: DbTx,
  ): Promise<ShipmentCustodyBalance[]> {
    const balances = await loadPositiveShipmentCustody(tx, sessionId, shipmentId);
    const sortingRef = this.sortingRef(workItemId, ownerId);
    const packingRef = this.packingRef(workItemId);
    if (
      balances.some(
        (balance) =>
          (balance.custodyType !== 'SORTING' || balance.custodyRef !== sortingRef) &&
          (balance.custodyType !== 'PACKING' || balance.custodyRef !== packingRef),
      )
    ) {
      throw conflict('PICKING_CUSTODY_OWNER_MISMATCH', `Shipment assigned custody is not owned by picker ${ownerId}`);
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
      throw conflict('AGGREGATE_CART_EMPTY', `Cart ${cartId} has no pooled custody`);
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
      throw conflict(
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

  private requiredCartId(value: string): string {
    const cartId = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(cartId)) {
      throw new BadRequestException('cartId must be 1-128 letters, digits, dots, underscores, or hyphens');
    }
    return cartId;
  }
}
