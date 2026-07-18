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

export interface DiscreteScanPickingInput {
  strategy?: 'discrete';
  stage?: 'source';
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

export interface AggregateSourceScanInput {
  strategy: 'aggregate_then_sort';
  stage: 'bulk_collect';
  batchId: string;
  planId: string;
  sessionId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  cartId: string;
  actor: PickingActor;
  idempotencyKey: string;
}

export interface AggregateSortScanInput {
  strategy: 'aggregate_then_sort';
  stage: 'sort';
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  skuId: string;
  cartId: string;
  quantity: number;
  destinationCustody: 'SORTING' | 'PACKING';
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export interface AggregateCartHandoffInput {
  batchId: string;
  planId: string;
  sessionId: string;
  cartId: string;
  expectedOwnerId: string;
  targetWorkerId: string;
  reason: string;
  actor: PickingActor;
  idempotencyKey: string;
}

export interface ToteRegistrationInput {
  warehouseId: string;
  toteBarcode: string;
  actor: PickingActor;
  idempotencyKey: string;
}

export interface ToteAssignmentInput {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  toteBarcode: string;
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export interface ToteScanPickingInput extends ToteAssignmentInput {
  strategy: 'pick_to_tote';
  stage: 'source';
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
}

export interface ToteReleaseInput extends ToteAssignmentInput {
  reason: string;
}

export interface ToteHandoffInput extends ToteAssignmentInput {
  targetWorkItemId: string;
  targetShipmentId: string;
  targetExpectedLeaseVersion: number;
  reason: string;
}

export type ScanPickingInput =
  | DiscreteScanPickingInput
  | AggregateSourceScanInput
  | AggregateSortScanInput
  | ToteScanPickingInput;

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

export interface AggregateSourceScanResult {
  operationId: string;
  planId: string;
  sessionId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  cartRef: string;
  workerId: string;
}

export interface AggregateSortScanResult {
  operationId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  skuId: string;
  quantity: number;
  cartRef: string;
  destinationCustody: 'SORTING' | 'PACKING';
  destinationRef: string;
  sourceMoves: Array<{ sourceLocationId: string; quantity: number }>;
}

export interface ToteRegistrationResult {
  operationId: string;
  toteId: string;
  warehouseId: string;
  toteBarcode: string;
  status: 'available';
  version: number;
}

export interface ToteAssignmentResult {
  operationId: string;
  assignmentId: string;
  toteId: string;
  toteBarcode: string;
  shipmentId: string;
  status: 'assigned';
}

export interface ToteReleaseResult {
  operationId: string;
  assignmentId: string;
  toteId: string;
  toteBarcode: string;
  shipmentId: string;
  status: 'released';
}

export interface ToteHandoffResult {
  operationId: string;
  toteId: string;
  toteBarcode: string;
  sourceAssignmentId: string;
  targetAssignmentId: string;
  sourceShipmentId: string;
  targetShipmentId: string;
  status: 'assigned';
}

export interface ToteScanResult extends PickingScanResult {
  toteId: string;
  toteBarcode: string;
  toteRef: string;
}

export type ScanPickingResult =
  | PickingScanResult
  | AggregateSourceScanResult
  | AggregateSortScanResult
  | ToteScanResult;

export interface AggregateCartHandoffResult {
  operationId: string;
  sessionId: string;
  sourceCartRef: string;
  targetCartRef: string;
  movedQty: number;
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
  scan(input: ScanPickingInput, tx?: DbTx): Promise<ScanPickingResult>;
  handoff(input: HandoffPickingInput, tx?: DbTx): Promise<PickingHandoffResult>;
  completePick(input: CompletePickInput, tx?: DbTx): Promise<InspectionReadyOutput>;
  unpickShipment(input: UnpickShipmentInput, tx?: DbTx): Promise<UnpickShipmentResult>;
}

export interface PickToToteStrategy extends PickingStrategy {
  registerTote(input: ToteRegistrationInput, tx?: DbTx): Promise<ToteRegistrationResult>;
  assignTote(input: ToteAssignmentInput, tx?: DbTx): Promise<ToteAssignmentResult>;
  toteScan(input: ToteScanPickingInput, tx?: DbTx): Promise<ToteScanResult>;
  toteHandoff(input: ToteHandoffInput, tx?: DbTx): Promise<ToteHandoffResult>;
  releaseTote(input: ToteReleaseInput, tx?: DbTx): Promise<ToteReleaseResult>;
}

export interface AggregateThenSortStrategy extends PickingStrategy {
  bulkCartScan(input: AggregateSourceScanInput, tx?: DbTx): Promise<AggregateSourceScanResult>;
  sortScan(input: AggregateSortScanInput, tx?: DbTx): Promise<AggregateSortScanResult>;
  cartHandoff(input: AggregateCartHandoffInput, tx?: DbTx): Promise<AggregateCartHandoffResult>;
}
