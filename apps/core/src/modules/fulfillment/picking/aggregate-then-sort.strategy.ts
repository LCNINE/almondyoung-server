import { BadRequestException, Injectable } from '@nestjs/common';
import { BoxAllocationManager } from '../services/box-allocation.manager';
import { BoxReturnService } from '../services/box-return.service';
import { BoxWithdrawalService } from '../services/box-withdrawal.service';
import { ReturnBinService } from '../services/return-bin.service';
import { LabelCurrencyGuard } from '../waybill/label-currency.guard';
import { and, asc, eq, gt, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchInventorySessionService } from '../services/batch-inventory-session.service';
import { FulfillmentCommandService } from '../services/fulfillment-command.service';
import { FulfillmentWorkflowGate } from '../services/fulfillment-workflow-gate.service';
import { OutboundBatchOrchestrator } from '../services/outbound-batch-orchestrator.service';
import {
  AggregateCartHandoffInput,
  AggregateCartHandoffResult,
  AggregateCartSurplusReturnInput,
  AggregateCartSurplusReturnResult,
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
import { conflict } from './allocation/allocation.errors';
import { assertActiveBatchSession, assertPositiveQuantity } from './allocation/allocation.queries';
import { ShipmentAllocation, ShipmentCustodyBalance } from './allocation/allocation.types';
import {
  advisoryXactLock,
  completeWorkItemPick,
  CustodyCommandDeps,
  handoffWorkItemPicker,
  PickingCustodyPolicy,
  runForwardWorkItemCommand,
  unpickWorkItemShipment,
  WorkItemCommandDeps,
} from './work-item-command';
import { packingRefOf, spotsOf } from './work-item-custody-judgement';

const BULK_CART_REF_PREFIX = 'bulk-cart:';

/**
 * 물리 카트 advisory 락 키. `sortScan`(커널 선행 락 `locksBefore`)과 나머지 카트 명령(`acquireCartLock`)이 이 함수 하나로
 * 키를 만든다 — 두 문자열이 갈리면 서로 막지 못한다.
 */
export function cartLockKey(cartId: string): string {
  return `aggregate-cart:${cartId}`;
}

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
    private readonly labels: LabelCurrencyGuard,
    private readonly boxes: BoxAllocationManager,
    private readonly withdrawals: BoxWithdrawalService,
    private readonly returnBins: ReturnBinService,
    private readonly returns: BoxReturnService,
  ) {}

  private forwardDeps(): WorkItemCommandDeps {
    return { commands: this.commands, workflowGate: this.workflowGate, labels: this.labels };
  }

  async scan(input: ScanPickingInput, tx?: DbTx): Promise<ScanPickingResult> {
    if (input.strategy !== this.capabilities.name) {
      throw new BadRequestException('Aggregate picking requires strategy=aggregate_then_sort');
    }
    if (input.stage === 'bulk_collect') return this.bulkCartScan(input, tx);
    if (input.stage === 'sort') return this.sortScan(input, tx);
    throw new BadRequestException('Aggregate picking requires stage=bulk_collect or stage=sort');
  }

  /**
   * 분류대에서 남는 상품 → 되돌림 바구니(S1 §5.4 D11, 스펙 §8 정한 것 1·2). 카트 규칙(잠금·ref·소유)이 이 전략에 있어
   * 되돌림 스캔 지점 중 카트 쪽은 여기다. 여분을 다 내린 박스는 같은 트랜잭션에서 나간다.
   */
  async returnCartSurplus(
    input: AggregateCartSurplusReturnInput,
    tx?: DbTx,
  ): Promise<AggregateCartSurplusReturnResult> {
    this.workflowGate.assertV2MutationAllowed('picking.aggregate_then_sort.cart_surplus_return');
    assertPositiveQuantity(input.quantity);
    const cartId = this.requiredCartId(input.cartId);
    const cartRef = this.bulkCartRef(input.batchId, cartId, input.actor.id);
    const response = await this.commands.execute<AggregateCartSurplusReturnResult>(
      {
        commandType: 'picking.aggregate_then_sort.cart_surplus_return',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          batchId: input.batchId,
          sessionId: input.sessionId,
          cartId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          returnBinBarcode: input.returnBinBarcode.trim(),
          actorId: input.actor.id,
        },
      },
      async (trx, commandRequestId) => {
        // 영향받는 박스 — 잠그지 않은 읽기로 고르고, 잠근 뒤 다시 거른다(작업 항목 FOR UPDATE 의 status 조건).
        const candidates = await trx
          .selectDistinct({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
          .from(wmsTables.pickingSourceAllocations)
          .innerJoin(
            wmsTables.outboundBatchWorkItems,
            eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
          )
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
          )
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
              eq(wmsTables.outboundBatchWorkItems.status, 'withdrawing'),
              eq(wmsTables.shipmentLines.skuId, input.skuId),
              eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
              gt(wmsTables.pickingSourceAllocations.qty, 0),
            ),
          );
        const shipmentIds = candidates.map((row) => row.shipmentId).sort();
        // 카트 잠금이 먼저다 — 구성요소 잠금(불변식 검사기)이 세션·보관까지 FOR UPDATE 로 잡으므로, 뒤에 두면
        // 카트 → 세션 순서인 분류·일괄 담기·인계와 교착한다(스펙 §13).
        await this.acquireCartLock(cartId, trx);
        await this.withdrawals.lockComponentsOf(shipmentIds, trx);
        const workItems = shipmentIds.length
          ? await trx
              .select()
              .from(wmsTables.outboundBatchWorkItems)
              .where(
                and(
                  eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
                  eq(wmsTables.outboundBatchWorkItems.status, 'withdrawing'),
                  inArray(wmsTables.outboundBatchWorkItems.shipmentId, shipmentIds),
                ),
              )
              .orderBy(asc(wmsTables.outboundBatchWorkItems.id))
              .for('update')
          : [];
        await assertActiveBatchSession(trx, input.sessionId, input.batchId, this.capabilities.name);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.actor.id, trx, true);
        const [batch] = await trx
          .select({ warehouseId: wmsTables.outboundBatches.warehouseId })
          .from(wmsTables.outboundBatches)
          .where(eq(wmsTables.outboundBatches.id, input.batchId))
          .limit(1);
        if (!batch) throw new Error(`Outbound batch ${input.batchId} not found under an active session`);
        const returnBin = await this.returnBins.requireActive(input.returnBinBarcode, batch.warehouseId, trx);
        const session = await this.boxes.lockOpenSession(input.batchId, trx);
        if (!session || session.id !== input.sessionId || session.status !== 'active') {
          throw conflict('PICKING_SESSION_NOT_ACTIVE', `Batch ${input.batchId} inventory session is not active`);
        }
        const moved = await this.boxes.removeCartShare(
          {
            session,
            workItemIds: workItems.map((item) => item.id),
            cartRef,
            skuId: input.skuId,
            sourceLocationId: input.sourceLocationId,
            quantity: input.quantity,
            returnBin,
            actorId: input.actor.id,
            operationId: commandRequestId,
          },
          trx,
        );
        const exited: AggregateCartSurplusReturnResult['exited'] = [];
        for (const item of workItems.filter((candidate) => moved.some((m) => m.workItemId === candidate.id))) {
          const exit = await this.withdrawals.exitIfDrained(item, { actorId: input.actor.id, operationId: commandRequestId }, trx);
          if (!exit.exited) continue;
          await this.returns.settleExit(exit.workItem, trx);
          exited.push({
            workItemId: item.id,
            shipmentId: item.shipmentId,
            exitTo: exit.workItem.exitTo,
            waitingOperationId: exit.workItem.waitingOperationId,
          });
        }
        const response: AggregateCartSurplusReturnResult = {
          operationId: commandRequestId,
          sessionId: input.sessionId,
          cartRef,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: input.quantity,
          exited,
        };
        return { response, resourceType: 'batch_inventory_session', resourceId: input.sessionId };
      },
      tx,
    );
    return response;
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
        await assertActiveBatchSession(trx, input.sessionId, input.batchId, this.capabilities.name);
        await this.assertCartOwnedBy(input.sessionId, input.batchId, cartId, input.actor.id, trx);

        const [allocated] = await trx
          .select({ qty: sql<number>`coalesce(sum(${wmsTables.pickingSourceAllocations.qty}), 0)::int` })
          .from(wmsTables.pickingSourceAllocations)
          .innerJoin(
            wmsTables.outboundBatchWorkItems,
            eq(wmsTables.outboundBatchWorkItems.id, wmsTables.pickingSourceAllocations.workItemId),
          )
          .innerJoin(
            wmsTables.shipmentLines,
            eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
          )
          .where(
            and(
              eq(wmsTables.outboundBatchWorkItems.batchId, input.batchId),
              notInArray(wmsTables.outboundBatchWorkItems.status, ['completed', 'excluded']),
              eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
              eq(wmsTables.shipmentLines.skuId, input.skuId),
            ),
          );
        if (Number(allocated?.qty ?? 0) <= 0) {
          throw conflict('PICKING_WRONG_SOURCE', 'SKU/source is not allocated in this batch');
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
    assertPositiveQuantity(input.quantity);
    const cartId = this.requiredCartId(input.cartId);
    if (input.destinationCustody !== 'SORTING' && input.destinationCustody !== 'PACKING') {
      throw new BadRequestException('destinationCustody must be SORTING or PACKING');
    }
    const cartRef = this.bulkCartRef(input.batchId, cartId, input.actor.id);
    return runForwardWorkItemCommand<AggregateSortScanResult>(
      this.forwardDeps(),
      {
        strategy: this.capabilities.name,
        commandType: 'picking.aggregate_then_sort.sort',
        canonicalRequest: {
          strategy: this.capabilities.name,
          stage: 'sort',
          batchId: input.batchId,
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
        target: {
          batchId: input.batchId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          actor: input.actor,
          expectedLeaseVersion: input.expectedLeaseVersion,
          idempotencyKey: input.idempotencyKey,
        },
        locksBefore: [cartLockKey(cartId)],
      },
      async (trx, commandRequestId) => {
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
        const allocations = await this.loadLineAllocations(input.workItemId, input.shipmentLineId, trx);
        const destinationRef =
          input.destinationCustody === 'SORTING'
            ? this.sortingRef(input.workItemId, input.actor.id)
            : packingRefOf(input.workItemId);
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
                (balance.custodyType === 'PACKING' && balance.custodyRef !== packingRefOf(input.workItemId)),
            )
          ) {
            throw conflict('PICKING_CUSTODY_OWNER_MISMATCH', 'Line custody belongs to another sort destination');
          }
          if (attributed > allocation.qty) {
            throw conflict('PICKING_CUSTODY_OVERATTRIBUTED', 'Sorted custody exceeds its work item allocation');
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
        await assertActiveBatchSession(trx, input.sessionId, input.batchId, this.capabilities.name);
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
    return handoffWorkItemPicker(this.custodyDeps(), this.custodyPolicy(), input, tx);
  }

  async completePick(input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput> {
    return completeWorkItemPick(this.custodyDeps(), this.custodyPolicy(), input, tx);
  }

  async unpickShipment(input: UnpickShipmentInput, tx?: DbTx): Promise<UnpickShipmentResult> {
    return unpickWorkItemShipment(this.custodyDeps(), this.custodyPolicy(), input, tx);
  }

  private custodyDeps(): CustodyCommandDeps {
    return { ...this.forwardDeps(), sessions: this.sessions, batches: this.batches };
  }

  private custodyPolicy(): PickingCustodyPolicy {
    return {
      strategy: this.capabilities.name,
      keys: {
        complete: 'aggregate-complete',
        unpick: 'aggregate-unpick',
        handoffClaim: 'aggregate-handoff-claim',
      },
      // DB 를 읽지 않는 조회 — discrete 와 같은 꼴(Promise.resolve)로 둔다.
      loadHeldSpots: (_trx, ctx) =>
        Promise.resolve(
          spotsOf([
            { custodyType: 'SORTING', refs: new Set([this.sortingRef(ctx.workItemId, ctx.pickerId)]) },
            { custodyType: 'PACKING', refs: new Set([packingRefOf(ctx.workItemId)]) },
          ]),
        ),
      completeMovesFrom: 'SORTING',
      handoffCustody: {
        custodyType: 'SORTING',
        refFor: (workItemId, workerId) => this.sortingRef(workItemId, workerId),
        key: 'aggregate-handoff',
        corruptMessage: (balanceId) => `Sorting balance ${balanceId} is incomplete`,
      },
      messages: {
        completeIncomplete: ({ shipmentLineId, sourceLocationId }) => ({
          code: 'PICKING_UNSORTED_REMAINDER',
          message: `Allocation ${shipmentLineId}/${sourceLocationId} is not fully sorted`,
        }),
        ownerMismatchWhilePicking: ({ balanceId }) => `Balance ${balanceId} has unexpected custody`,
        handoffOwnerMismatch: ({ pickerId }) => `Shipment assigned custody is not owned by picker ${pickerId}`,
      },
    };
  }

  private async loadLineAllocations(
    workItemId: string,
    shipmentLineId: string,
    tx: DbTx,
  ): Promise<ShipmentAllocation[]> {
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
          eq(wmsTables.pickingSourceAllocations.workItemId, workItemId),
          eq(wmsTables.pickingSourceAllocations.shipmentLineId, shipmentLineId),
        ),
      )
      .orderBy(asc(wmsTables.pickingSourceAllocations.sourceLocationId), asc(wmsTables.pickingSourceAllocations.id));
    if (!allocations.length) {
      throw conflict('PICKING_SHIPMENT_LINE_NOT_ALLOCATED', `Shipment line ${shipmentLineId} has no allocation`);
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

  private async acquireCartLock(cartId: string, tx: DbTx): Promise<void> {
    await advisoryXactLock(tx, cartLockKey(cartId));
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

  private requiredCartId(value: string): string {
    const cartId = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(cartId)) {
      throw new BadRequestException('cartId must be 1-128 letters, digits, dots, underscores, or hyphens');
    }
    return cartId;
  }
}
