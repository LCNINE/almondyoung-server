import { DbTx } from '../../inventory/schema/inventory.schema';

export type PickingStrategyName = 'discrete' | 'aggregate_then_sort' | 'pick_to_tote';

export interface PickingStrategyCapabilities {
  readonly name: PickingStrategyName;
  readonly requiresPhysicalTote: boolean;
  readonly supportsAggregateSourcePick: boolean;
  readonly inspectionReadyCustody: 'PACKING';
  readonly custodyFlow: readonly string[];
}

export interface PickingActor {
  id: string;
  roles: string[];
}

export interface PlanPickingInput {
  batchId: string;
  shipmentIds: string[];
  actorId: string;
  idempotencyKey: string;
}

export interface StartPickingInput {
  batchId: string;
  planId: string;
  actorId: string;
  idempotencyKey: string;
}

export interface ScanPickingInput {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export interface HandoffPickingInput {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  targetWorkerId: string;
  expectedLeaseVersion: number;
  reason: string;
  actor: PickingActor;
  idempotencyKey: string;
}

export interface CompletePickInput {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export interface UnpickShipmentInput {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export type PickingPlanResult =
  | {
      state: 'planned';
      operationId: string;
      planId: string;
      batchId: string;
      strategy: PickingStrategyName;
      version: number;
      shipmentIds: string[];
      allocationCount: number;
      totalQty: number;
    }
  | {
      state: 'invalidated';
      operationId: string;
      planId: string;
      batchId: string;
      reason: string;
    };

export type PickingStartResult =
  | {
      state: 'started';
      operationId: string;
      planId: string;
      sessionId: string;
      batchId: string;
      status: string;
    }
  | {
      state: 'invalidated';
      operationId: string;
      planId: string;
      batchId: string;
      reason: string;
    };

export interface PickingScanResult {
  operationId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  workerId: string;
}

export interface PickingHandoffResult {
  operationId: string;
  workItemId: string;
  shipmentId: string;
  workerId: string;
  leaseVersion: number;
  movedQty: number;
}

export interface InspectionReadyLine {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
}

export interface InspectionReadyOutput {
  operationId: string;
  workItemId: string;
  shipmentId: string;
  custodyType: 'PACKING';
  custodyRef: string;
  lines: InspectionReadyLine[];
  totalQty: number;
}

export interface UnpickShipmentResult {
  operationId: string;
  workItemId: string;
  shipmentId: string;
  status: 'queued';
  returnedToSourceQty: number;
}

export interface PickingStrategy {
  readonly capabilities: PickingStrategyCapabilities;

  plan(input: PlanPickingInput, tx?: DbTx): Promise<PickingPlanResult>;
  start(input: StartPickingInput, tx?: DbTx): Promise<PickingStartResult>;
  scan(input: ScanPickingInput, tx?: DbTx): Promise<PickingScanResult>;
  handoff(input: HandoffPickingInput, tx?: DbTx): Promise<PickingHandoffResult>;
  completePick(input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput>;
  unpickShipment(input: UnpickShipmentInput, tx?: DbTx): Promise<UnpickShipmentResult>;
}
