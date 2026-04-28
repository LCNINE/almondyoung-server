// src/lib/types/dto/fulfillment.ts
// 풀필먼트(출고) 도메인 DTO 타입 — 통합 서버 컨트롤러 스키마와 1:1 대응

// ===== Fulfillment Order =====

export type FulfillmentMode = 'in_house' | '3pl' | 'drop_ship';
export type FulfillmentOrderPriority = 'normal' | 'high' | 'urgent';
export type FulfillmentOrderStatus =
  | 'created'
  | 'pending'
  | 'allocated'
  | 'picking'
  | 'picked'
  | 'invoiced'
  | 'shipped'
  | 'canceled';

export interface FulfillmentOrderItemInput {
  salesOrderId: string;
  salesOrderLineId: string;
  productId: string;
  variantId: string;
  qty: number;
}

export interface CreateFulfillmentOrderRequest {
  warehouseId: string;
  fulfillmentMode: FulfillmentMode;
  priority?: FulfillmentOrderPriority;
  items: FulfillmentOrderItemInput[];
}

export interface AllocateToBatchRequest {
  batchId: string;
}

export interface UpdateFulfillmentPriorityRequest {
  priority: FulfillmentOrderPriority;
}

// ===== Picking =====

export interface BatchPickRequest {
  batchId: string;
  skuId: string;
  pickedQty: number;
  locationCode?: string;
  pickerUserId?: string;
}

export interface PickIndividualItemRequest {
  pickedQty: number;
}

export interface ScanBarcodeRequest {
  barcode: string;
  batchId?: string;
  fulfillmentOrderId?: string;
  warehouseId: string;
  pickerUserId?: string;
}

export interface PickByBarcodeRequest {
  barcode: string;
  pickedQty: number;
  batchId?: string;
  fulfillmentOrderId?: string;
  warehouseId: string;
  pickerUserId?: string;
  locationCode?: string;
}

export interface GenerateBarcodeRequest {
  type: 'sku' | 'foi' | 'fo';
  id: string;
}

export interface PickingOperation {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  requiredQty: number;
  pickedQty: number;
  locationCode?: string;
  status: 'pending' | 'partial' | 'completed';
}

export interface PickingProgress {
  batchId: string;
  totalItems: number;
  pickedItems: number;
  progressPercent: number;
  status: string;
}

export interface PickingSession {
  fulfillmentOrderId: string;
  status: string;
  items: Array<{
    foiId: string;
    skuId: string;
    skuCode: string;
    skuName: string;
    requiredQty: number;
    pickedQty: number;
  }>;
}

export interface GenerateBarcodeResponse {
  barcode: string;
  uri?: string;
}

// ===== Inspection =====

export type InspectionType = 'individual' | 'batch';
export type IssueType = 'quantity_mismatch' | 'quality_issue' | 'damage' | 'wrong_item' | 'other';
export type IssueSeverity = 'minor' | 'major' | 'critical';

export interface StartInspectionRequest {
  fulfillmentOrderId: string;
  type: InspectionType;
  inspectorUserId: string;
}

export interface InspectionIssue {
  type: IssueType;
  severity: IssueSeverity;
  description: string;
  qty?: number;
  photos?: string[];
}

export interface InspectItemRequest {
  sessionId: string;
  foiId: string;
  inspectedQty: number;
  approvedQty: number;
  rejectedQty?: number;
  issues?: InspectionIssue[];
  inspectorUserId: string;
}

export interface ForceShipmentRequest {
  foiId: string;
  reason: string;
  authorizedBy: string;
  forceQty: number;
  note?: string;
}

export interface BulkApproveRequest {
  foiIds: string[];
  inspectorUserId: string;
}

export interface CompleteInspectionSessionRequest {
  sessionId: string;
  inspectorUserId: string;
}

export interface InspectionSession {
  id: string;
  fulfillmentOrderId: string;
  type: InspectionType;
  inspectorUserId: string;
  status: 'active' | 'completed';
  startedAt: string;
  completedAt?: string;
}

export interface InspectionSummary {
  fulfillmentOrderId: string;
  totalItems: number;
  inspectedItems: number;
  approvedItems: number;
  rejectedItems: number;
  forcedItems: number;
  status: string;
}

export interface InspectionHistoryItem {
  id: string;
  foiId: string;
  action: string;
  inspectedQty: number;
  approvedQty: number;
  rejectedQty: number;
  issues: InspectionIssue[];
  inspectorUserId: string;
  createdAt: string;
}

export interface QualityMetrics {
  totalInspected: number;
  approvalRate: number;
  rejectionRate: number;
  forceShipmentRate: number;
  issueBreakdown: Record<IssueType, number>;
}

export interface QualityMetricsQuery {
  warehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
  inspectorUserId?: string;
}

// ===== Invoice =====

export type InvoiceIssueMethod = 'goodsflow' | 'direct' | 'self';
export type InvoiceStatus = 'issued' | 'printed' | 'shipped' | 'canceled';

export interface IssueInvoiceRequest {
  fulfillmentOrderId: string;
  carrierCode: string;
  recipientName: string;
  recipientAddress: string;
  recipientPhone: string;
  senderName?: string;
  senderPhone?: string;
  deliveryMessage?: string;
  issueMethod?: InvoiceIssueMethod;
}

export interface IssueInvoiceResponse {
  invoiceId: string;
}

export interface PrintInvoicesRequest {
  invoiceIds: string[];
}

export interface PrintInvoicesResponse {
  printUri?: string;
  message?: string;
}

export interface InvoiceDetail {
  id: string;
  fulfillmentOrderId: string;
  carrierCode: string;
  trackingNumber?: string;
  issueMethod: InvoiceIssueMethod;
  status: InvoiceStatus;
  recipientName?: string;
  recipientAddress?: string;
  recipientPhone?: string;
  printUri?: string;
  issuedAt?: string;
  printedAt?: string;
  shippedAt?: string;
  canceledAt?: string;
  items: Array<{
    skuId: string;
    skuCode: string;
    skuName: string;
    quantity: number;
  }>;
}

export interface TrackInvoiceResponse {
  invoiceId: string;
  trackingNumber: string;
  carrierCode: string;
  trackingStatus: string;
  deliveryEvents: Array<{
    time: string;
    status: string;
    location?: string;
    description: string;
  }>;
}
