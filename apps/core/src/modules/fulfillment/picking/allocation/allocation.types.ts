import { DbTx, wmsTables } from '../../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { FulfillmentCommandService } from '../../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { WaybillService } from '../../waybill/waybill.service';

export type BatchRow = typeof wmsTables.outboundBatches.$inferSelect;
export type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
export type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;
export type CustodyType = (typeof wmsTables.batchInventorySessionBalances.$inferSelect)['custodyType'];

export interface LockedLine {
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

export interface LockedAggregate {
  batch: BatchRow;
  shipments: ShipmentRow[];
  lines: LockedLine[];
  workItems: WorkItemRow[];
}

export interface SourceCapacity {
  skuId: string;
  sourceLocationId: string;
  stockVersion: number;
  remainingQty: number;
}

export interface ShipmentAllocation {
  id: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  qty: number;
}

export interface ShipmentCustodyBalance {
  id: string;
  skuId: string;
  sourceLocationId: string | null;
  custodyType: CustodyType;
  custodyRef: string | null;
  shipmentLineId: string | null;
  qty: number;
}

/**
 * 세션 인계가 받는 배정 한 줄. `batch-start.ts` 가 만들고
 * Task 3 의 `BatchInventorySessionService.startSession` 이 그대로 소비한다.
 */
export interface SessionStartAllocation {
  id: string;
  workItemId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  sourceStockVersion: number;
}

/**
 * Task 3 에서 `BatchInventorySessionService` 가 구현할 포트. 이 Task 에서는 단위 테스트가
 * 가짜로 채운다 — 배치 시작 진입점이 세션 계층 구현을 기다리지 않고 먼저 자리를 잡기 위해서다.
 */
export interface BatchStartSessionPort {
  startSession(
    input: { batchId: string; actorId: string; allocations: SessionStartAllocation[] },
    tx: DbTx,
  ): Promise<{ id: string; status: string }>;
}

/**
 * Collaborators the batch-start entry point needs. Measured: the extracted methods use exactly
 * these six and never `dbService` — every one of them receives an open `trx` instead (ADR-0030).
 */
export interface BatchStartDeps {
  commands: FulfillmentCommandService;
  workflowGate: FulfillmentWorkflowGate;
  sessions: BatchStartSessionPort;
  invariant: FulfillmentInvariantService;
  controlledStock: BatchControlledStockGuard;
  waybills: WaybillService;
}

export interface BatchStartResult {
  state: 'started';
  operationId: string;
  batchId: string;
  sessionId: string;
  status: string;
}

/**
 * 시작 전 배치에서 배치 시작이 배정·인계하는 작업 항목 상태. 인계(HAND_IN) 전에는 커스터디가 있을 수 없으므로
 * 단독 picker-claim 으로 `picking` 이 된 항목도 그대로 배정할 수 있다. 이 밖의 상태는 시작 전 배치의 손상이다.
 */
export const UNSTARTED_BATCH_WORK_ITEM_STATUSES = ['queued', 'picking'] as const;

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
