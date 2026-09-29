import { DbTx } from '../../inventory/schema/inventory.schema';
import type { BatchStartResult } from './allocation/allocation.types';
import type { StartBatchPickingInput } from './allocation/batch-start';

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

/** 배치 시작 입력. 계획 id 는 없다 — 배치가 곧 시작 단위다(ADR-0041). */
export type StartPickingInput = StartBatchPickingInput;

export interface DiscreteScanPickingInput {
  strategy?: 'discrete';
  stage?: 'source';
  batchId: string;
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
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export interface UnpickShipmentInput {
  batchId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  actor: PickingActor;
  expectedLeaseVersion: number;
  idempotencyKey: string;
}

export type PickingStartResult = BatchStartResult;

export interface PickingScanResult {
  operationId: string;
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
  sessionId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  cartRef: string;
  workerId: string;
}

export interface AggregateSortScanResult {
  operationId: string;
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

/**
 * A picking strategy owns only what differs per method: custody movement and its scans.
 * Batch start (allocation + hand-in) is strategy-agnostic and lives in `allocation/batch-start.ts` —
 * measured diff across the three strategies was 0~4 lines, all of them the strategy name (ADR-0030).
 */
export interface PickingStrategy {
  readonly capabilities: PickingStrategyCapabilities;

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
