export interface SimpleOutboundLineProgress {
  shipmentLineId: string;
  skuId: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export interface SimpleOutboundState {
  shipmentId: string;
  workItemStatus: string;
  status: 'in_progress' | 'shipped';
  dispatchAttemptId: string | null;
  lines: SimpleOutboundLineProgress[];
}

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export interface ShipmentByWaybill {
  warehouseId?: string;
  outboundContract?: 'legacy' | 'location';
  shipmentId: string;
  trackingNo: string;
  carrier: string;
  waybillStatus: string;
  shipmentStatus: string;
  batchId: string | null;
  workItemId: string | null;
  workItemStatus: string | null;
  recipientMasked: string;
  lines: ShipmentByWaybillLine[];
}

export interface OutboundBatchSummary {
  id: string;
  batchNumber: string;
  name: string;
  status: string;
  totalItems: number;
  totalQty: number;
}

export interface SimpleOutboundScanInput {
  shipmentId: string;
  barcode: string;
  quantity: number;
  idempotencyKey: string;
}

export interface ForceSimpleOutboundInput {
  shipmentId: string;
  reason: string;
  idempotencyKey: string;
}

export interface OutboundSourceLine {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  sourceLocationCode: string;
  allocatedQty: number;
  pickedQty: number;
  remainingQty: number;
}
export interface LocationOutboundState extends SimpleOutboundState {
  warehouseId: string;
  sources: OutboundSourceLine[];
}
