import { BadRequestException, Injectable } from '@nestjs/common';
import { LabelCurrencyGuard } from '../waybill/label-currency.guard';
import { and, eq, ne, sql } from 'drizzle-orm';
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
import { conflict } from './allocation/allocation.errors';
import { assertPositiveQuantity } from './allocation/allocation.queries';
import {
  completeWorkItemPick,
  CustodyCommandDeps,
  handoffWorkItemPicker,
  PickingCustodyPolicy,
  runForwardWorkItemCommand,
  unpickWorkItemShipment,
  WorkItemCommandDeps,
} from './work-item-command';
import { spotsOf } from './work-item-custody-judgement';

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
    private readonly labels: LabelCurrencyGuard,
  ) {}

  private forwardDeps(): WorkItemCommandDeps {
    return { commands: this.commands, workflowGate: this.workflowGate, labels: this.labels };
  }

  async scan(input: ScanPickingInput, tx?: DbTx): Promise<PickingScanResult> {
    if (input.strategy === 'aggregate_then_sort' || input.strategy === 'pick_to_tote') {
      throw new BadRequestException('Discrete picking accepts only strategy=discrete, stage=source scans');
    }
    assertPositiveQuantity(input.quantity);
    return runForwardWorkItemCommand(
      this.forwardDeps(),
      {
        strategy: this.capabilities.name,
        commandType: 'picking.discrete.scan',
        canonicalRequest: {
          strategy: this.capabilities.name,
          batchId: input.batchId,
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
        target: {
          batchId: input.batchId,
          sessionId: input.sessionId,
          workItemId: input.workItemId,
          shipmentId: input.shipmentId,
          actor: input.actor,
          expectedLeaseVersion: input.expectedLeaseVersion,
          idempotencyKey: input.idempotencyKey,
        },
      },
      async (trx, commandRequestId) => {
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
              eq(wmsTables.pickingSourceAllocations.workItemId, input.workItemId),
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
        complete: 'discrete-complete',
        unpick: 'discrete-unpick',
        handoffClaim: 'discrete-handoff-claim',
        handoff: 'discrete-handoff',
      },
      loadHeldSpots: async (_trx, ctx) => spotsOf([{ custodyType: 'WORKER', refs: new Set([ctx.pickerId]) }]),
      completeMovesFrom: 'WORKER',
      handoffCustody: { custodyType: 'WORKER', refFor: (_workItemId, workerId) => workerId },
      messages: {
        completeIncomplete: ({ shipmentLineId, sourceLocationId }) => ({
          code: 'PICKING_INCOMPLETE',
          message: `Allocation ${shipmentLineId}/${sourceLocationId} is not fully held by the picker`,
        }),
        ownerMismatchWhilePicking: () => 'Active pick custody must be held only by the current picker',
        handoffOwnerMismatch: ({ pickerId }) =>
          `Shipment attributed custody must be exclusively WORKER custody owned by ${pickerId}`,
        handoffCorrupt: (balanceId) => `Worker balance ${balanceId} is incomplete`,
      },
    };
  }
}
