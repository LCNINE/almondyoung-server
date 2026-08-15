import { wmsTables } from '../../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../../inventory/core/services/batch-controlled-stock.guard';
import { BatchInventorySessionService } from '../../services/batch-inventory-session.service';
import { FulfillmentCommandService } from '../../services/fulfillment-command.service';
import { FulfillmentInvariantService } from '../../services/fulfillment-invariant.service';
import { FulfillmentWorkflowGate } from '../../services/fulfillment-workflow-gate.service';
import { WaybillService } from '../../waybill/waybill.service';

export type BatchRow = typeof wmsTables.outboundBatches.$inferSelect;
export type ShipmentRow = typeof wmsTables.shipments.$inferSelect;
export type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;
export type CustodyType = (typeof wmsTables.batchInventorySessionBalances.$inferSelect)['custodyType'];

/** Work item statuses a plan may legally claim. Everything else is already downstream of picking. */
export const ACTIVE_WORK_ITEM_STATUSES = ['queued', 'picking'] as const;

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
 * Collaborators the plan layer needs. Measured: the extracted methods use exactly these six and
 * never `dbService` — every one of them receives an open `trx` instead (ADR-0030).
 */
export interface PickingPlanDeps {
  commands: FulfillmentCommandService;
  workflowGate: FulfillmentWorkflowGate;
  sessions: BatchInventorySessionService;
  invariant: FulfillmentInvariantService;
  controlledStock: BatchControlledStockGuard;
  waybills: WaybillService;
}

export function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
