// src/lib/types/dto/fulfillment.ts
// 풀필먼트(출고) 도메인 DTO 타입 — 통합 서버 컨트롤러 스키마와 1:1 대응

// ===== Fulfillment Order =====

export type FulfillmentMode = 'in_house' | '3pl' | 'drop_ship';
export type FulfillmentOrderPriority = 'normal' | 'high' | 'urgent';
// 백엔드 fulfillmentStatusEnum 전체와 1:1 (inventory.schema.ts)
export type FulfillmentOrderStatus =
  | 'created'
  | 'reserving'
  | 'ready'
  | 'unfulfillable'
  | 'labeled'
  | 'pending'
  | 'allocated'
  | 'picking'
  | 'picked'
  | 'inspecting'
  | 'inspected'
  | 'invoiced'
  | 'forwarded'
  | 'shipped'
  | 'completed'
  | 'canceled';

export type DirectShipStatus =
  | 'pending'
  | 'forwarded'
  | 'completed'
  | 'canceled';

// ===== FO summary types (Core DTO 1:1 대응) =====

export interface FulfillmentOrderItem {
  id: string;
  fulfillmentOrderId?: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  variantId: string | null;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  reservedQty: number;
  pickedQty: number;
  shippedQty: number;
  canceledQty?: number;
  status: string;
}

export type FulfillmentOrderItemSummary = FulfillmentOrderItem;

export interface ReservationSummary {
  id: string;
  fulfillmentOrderItemId: string | null;
  skuId: string;
  warehouseId: string;
  quantity: number;
  status: string;
  shipmentLineId?: string | null;
  requestedAt?: string | null;
}

export interface InvoiceSummary {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  carrierCode: string | null;
  issueMethod: InvoiceIssueMethod;
}

export type FulfillmentInvoiceSummary = InvoiceSummary;

export interface ShipmentSummary {
  id: string;
  trackingNo: string;
  carrier: string;
  status: string;
  eta: string | null;
  invoiceUrl: string | null;
}

export interface BatchSummary {
  id: string;
  batchNumber: string;
}

/** GET /fulfillments 목록 / 상세 응답 (Core FulfillmentOrderResponseDto) */
export interface FulfillmentOrder {
  id: string;
  salesOrderId: string | null;
  warehouseId: string | null;
  ownerId: string | null;
  status: FulfillmentOrderStatus;
  batchId: string | null;
  fulfillmentMode: FulfillmentMode | null;
  directShipStatus: DirectShipStatus | null;
  priority: FulfillmentOrderPriority;
  totalItems: number;
  totalQty: number;
  totalReservedQty: number;
  reservationFailureReason: string | null;
  reservationFailureDetails?: unknown;
  allocatedAt: string | null;
  shippedAt: string | null;
  canceledAt: string | null;
  shippingAddress?: unknown;
  labelNo: string | null;
  createdAt: string;
  updatedAt: string;
  invoice: InvoiceSummary | null;
  shipment?: ShipmentSummary | null;
  batch?: BatchSummary | null;
}

/** GET /fulfillments/:id 상세 응답 (items, reservations, adminAvailableActions 포함) */
export interface FulfillmentOrderDetail extends FulfillmentOrder {
  items: FulfillmentOrderItem[];
  reservations: ReservationSummary[];
  adminAvailableActions: string[];
  blockedReasons: string[];
  progress?: FulfillmentV2Progress;
  /** V2는 하나의 FO에 여러 shipment가 존재하므로 이 목록을 기준으로 렌더한다. */
  shipments?: FulfillmentShipmentSummary[];
}

/** GET /fulfillments 쿼리 파라미터 */
export interface ListFulfillmentsQuery {
  status?: string;
  warehouseId?: string;
  fulfillmentMode?: FulfillmentMode;
  salesOrderId?: string;
  priority?: FulfillmentOrderPriority;
  limit?: number;
  offset?: number;
  page?: number;
}

export type FulfillmentOrdersQuery = ListFulfillmentsQuery & {
  status?: FulfillmentOrderStatus;
};

/** POST /fulfillments/:id/reserve body */
export interface ReserveRequest {
  fulfillmentOrderItemId: string;
  quantity: number;
}

/** POST /fulfillments/:id/unreserve body */
export interface UnreserveRequest {
  fulfillmentOrderItemId: string;
  quantity: number;
}

/** POST /fulfillments/:id/transfer-reservation body */
export interface TransferReservationRequest {
  fromFulfillmentOrderItemId: string;
  toFulfillmentOrderItemId: string;
  quantity: number;
  reason?: string;
  csCaseId?: string;
  note?: string;
}

/** GET /fulfillments/:id/transfer-candidates 응답 항목 */
export interface TransferCandidate {
  id: string;
  fulfillmentOrderId: string;
  fulfillmentOrderStatus: string;
  salesOrderId: string | null;
  skuId: string;
  qty: number;
  reservedQty: number;
  shortage: number;
  sameFulfillmentOrder: boolean;
}

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

// 수동 standalone FO 생성 (POST /fulfillments — 백엔드 CreateFulfillmentOrderDto, salesOrderId 미사용)
export interface FulfillmentShippingAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote?: string;
}

export interface CreateStandaloneFulfillmentItem {
  skuId: string;
  quantity: number;
  variantId?: string;
}

export interface CreateStandaloneFulfillmentRequest {
  warehouseId?: string;
  fulfillmentMode?: FulfillmentMode;
  priority?: FulfillmentOrderPriority;
  ownerId?: string;
  shippingAddress?: FulfillmentShippingAddress;
  items: CreateStandaloneFulfillmentItem[];
}

export interface AllocateToBatchRequest {
  batchId: string;
}

export interface UpdateFulfillmentPriorityRequest {
  priority: FulfillmentOrderPriority;
}

export interface FulfillmentOutboxEvent {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// 목록 아이템 — 목록 응답엔 items 없음(상세에서만). 구조 자체는 상세와 동일.
export type FulfillmentOrderListItem = FulfillmentOrderDetail;

// GET /fulfillments 페이지네이션 응답 (백엔드 FulfillmentOrderListResponseDto)
export interface FulfillmentOrdersListResponse {
  data: FulfillmentOrderListItem[];
  total: number;
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

// 백엔드 picking-process.service.ts 의 PickingOperation/PickingProgress/IndividualPickingSession 과 1:1
export interface PickingOperationFoiDetail {
  foiId: string;
  fulfillmentOrderId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  requiredQty: number;
  pickedQty: number;
  remainingQty: number;
}

// SKU 단위로 집계된 배치 피킹 작업 (skuCode/skuName 은 백엔드 skus 조인으로 제공)
export interface PickingOperation {
  batchId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  locationCode?: string; // ⚠️ 현재 백엔드 미구현 — 항상 undefined
  totalQty: number;
  pickedQty: number;
  remainingQty: number;
  foiDetails: PickingOperationFoiDetail[];
}

export interface PickingProgress {
  batchId: string;
  totalSkus: number;
  completedSkus: number;
  totalItems: number;
  pickedItems: number;
  remainingItems: number;
  completionPercentage: number;
}

export interface PickingSessionItem {
  foiId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  requiredQty: number;
  pickedQty: number;
  locationCode?: string; // ⚠️ 현재 백엔드 미구현 — 항상 undefined
  isCompleted: boolean;
}

// 개별 FO 피킹 세션 (POST /picking/fulfillment-orders/:id/start, GET .../session)
export interface PickingSession {
  fulfillmentOrderId: string;
  items: PickingSessionItem[];
  totalItems: number;
  completedItems: number;
  completionPercentage: number;
}

export interface GenerateBarcodeResponse {
  barcode: string;
  uri?: string;
}

// ===== Inspection =====

export type InspectionType = 'individual' | 'batch';
export type IssueType =
  | 'quantity_mismatch'
  | 'quality_issue'
  | 'damage'
  | 'wrong_item'
  | 'other';
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
  sessionId: string;
  foiId: string;
  reason: string;
  authorizedBy: string;
  forceQty: number;
  note?: string;
}

export interface BulkApproveRequest {
  sessionId: string;
  foiIds: string[];
  inspectorUserId: string;
}

// sessionId 는 URL path 로 전달 (body 중복 제거)
export interface CompleteInspectionSessionRequest {
  inspectorUserId: string;
}

// 검수 바코드 스캔 (3-C)
export interface ScanInspectionRequest {
  barcode: string;
  sessionId: string;
  fulfillmentOrderId?: string;
}

export interface InspectByScanRequest {
  barcode: string;
  sessionId: string;
  inspectorUserId: string;
  quantity?: number;
}

// 영속화된 검수 이슈 레코드 (백엔드 inspection_issues)
export interface InspectionIssueRecord {
  id: string;
  foiId: string;
  type: IssueType;
  severity: IssueSeverity;
  description: string;
  qty?: number;
  inspectorUserId: string;
  reportedAt: string;
  resolvedAt?: string;
  resolution?: string;
  photos?: string[];
}

// 검수 아이템 (세션 × FOI) — 백엔드 InspectionItem
export interface InspectionItem {
  foiId: string;
  salesOrderId: string | null;
  salesOrderLineId: string | null;
  skuId: string;
  skuName: string;
  requiredQty: number;
  pickedQty: number;
  inspectedQty: number;
  approvedQty: number;
  rejectedQty: number;
  status: 'pending' | 'inspecting' | 'approved' | 'rejected' | 'partial';
  issues: InspectionIssueRecord[];
  lastInspectedAt?: string;
}

// 백엔드 InspectionSession (영속화)
export interface InspectionSession {
  id: string;
  fulfillmentOrderId: string;
  type: InspectionType;
  status: 'active' | 'completed' | 'paused';
  inspectorUserId: string;
  totalItems: number;
  inspectedItems: number;
  completedItems: number;
  issues: number;
  startedAt: string;
  completedAt?: string;
  items: InspectionItem[];
}

// 백엔드 getInspectionSummary 응답
export interface InspectionSummary {
  totalItems: number;
  pendingItems: number;
  inspectedItems: number;
  approvedItems: number;
  rejectedItems: number;
  partialItems: number;
  totalIssues: number;
  canComplete: boolean;
}

// 백엔드 getInspectionHistory 응답 (FOI 단위)
export interface InspectionHistoryItem {
  inspectorUserId: string;
  inspectedQty: number;
  approvedQty: number;
  rejectedQty: number;
  issues: number;
  timestamp: string;
}

// 백엔드 getQualityMetrics 응답
export interface QualityMetrics {
  totalInspections: number;
  approvalRate: number;
  rejectionRate: number;
  avgInspectionTime: number;
  commonIssues: Array<{ type: string; count: number; percentage: number }>;
  inspectorPerformance: Array<{
    inspectorUserId: string;
    inspections: number;
    approvalRate: number;
    avgTime: number;
  }>;
}

export interface QualityMetricsQuery {
  warehouseId?: string;
  dateFrom?: string;
  dateTo?: string;
  inspectorUserId?: string;
}

// ===== Invoice =====

export type InvoiceIssueMethod = 'goodsflow' | 'hanjin' | 'direct' | 'self';
export type InvoiceStatus = 'issued' | 'printed' | 'shipped' | 'canceled';

export interface IssueInvoiceRequest {
  fulfillmentOrderId: string;
  carrierCode: string;
  /** direct(직접 입력) 발행 시 필수 — 택배사 발급 실제 운송장 번호 */
  invoiceNumber?: string;
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

// ===== Outbound Batches (D2) =====

export type OutboundBatchStatus =
  | 'created'
  | 'picking'
  | 'completed'
  | 'canceled';
export type PickingMethod = 'individual' | 'total_picking';

export interface CreateOutboundBatchRequest {
  warehouseId?: string;
  pickingMethod: PickingMethod;
  name?: string;
  scheduledPickingAt?: string;
  salesOrderIds?: string[];
}

export interface CreateOutboundBatchResponse {
  batchId: string;
  linkedFoCount: number;
}

export interface AddFOsToBatchRequest {
  fulfillmentOrderIds: string[];
}

export interface OutboundBatch {
  id: string;
  name?: string;
  warehouseId: string;
  pickingMethod: PickingMethod;
  status: OutboundBatchStatus;
  totalItems: number;
  totalQty: number;
  scheduledPickingAt?: string;
  createdAt: string;
}

export interface OutboundBatchFOItem {
  id: string;
  salesOrderId: string;
  salesOrderLineId: string;
  skuId: string;
  qty: number;
  pickedQty: number;
}

export interface OutboundBatchFO {
  id: string;
  status: FulfillmentOrderStatus;
  priority: FulfillmentOrderPriority;
  totalItems: number;
  totalQty: number;
  items: OutboundBatchFOItem[];
}

export interface OutboundBatchDetail extends OutboundBatch {
  startedAt?: string;
  completedAt?: string;
  fulfillmentOrders: OutboundBatchFO[];
}

export interface PickingListAggregateItem {
  skuId: string;
  skuName: string;
  locationCode?: string; // ⚠️ 항상 undefined — 서버 미구현
  totalQty: number;
  fulfillmentOrderItems: Array<{
    foiId: string;
    fulfillmentOrderId: string;
    salesOrderId: string;
    salesOrderLineId: string;
    qty: number;
    pickedQty: number;
  }>;
}

export interface AvailableFulfillmentOrder {
  id: string;
  priority: FulfillmentOrderPriority;
  fulfillmentMode: FulfillmentMode;
  totalItems: number;
  totalQty: number;
  createdAt: string;
}

// ===== Direct Ship (D2) =====

export type DirectShipOrderStatus =
  | 'pending'
  | 'forwarded'
  | 'completed'
  | 'canceled';

export interface DirectShipOrderItem {
  foiId: string;
  salesOrderLineId: string;
  skuId: string;
  skuName: string;
  qty: number;
  supplierSku?: string; // ⚠️ 항상 undefined — 서버 미구현
}

export interface DirectShipOrder {
  fulfillmentOrderId: string;
  salesOrderId?: string;
  companyName: string;
  supplierCode?: string; // ⚠️ 항상 undefined — 서버 미구현
  status: DirectShipOrderStatus;
  priority: FulfillmentOrderPriority;
  totalItems: number;
  totalQty: number;
  createdAt: string;
  forwardedAt?: string;
  completedAt?: string;
  items: DirectShipOrderItem[];
}

export interface DirectShipCompanySummary {
  companyName: string;
  pendingCount: number;
  forwardedCount: number;
  completedCount: number;
  lastOrderDate?: string;
}

export interface DirectShipDashboard {
  pendingOrders: number;
  forwardedOrders: number;
  completedOrders: number;
  totalOrders: number;
  companySummary: DirectShipCompanySummary[];
  recentActivity: Array<{
    fulfillmentOrderId: string;
    salesOrderId?: string;
    companyName: string;
    action: 'created' | 'forwarded' | 'completed';
    timestamp: string;
  }>;
}

export interface ForwardDirectShipOrdersRequest {
  fulfillmentOrderIds: string[];
  companyName: string;
}

export interface CompleteDirectShipOrdersRequest {
  fulfillmentOrderIds: string[];
  completedBy: string;
}

export interface ExportDirectShipFileRequest {
  companyName: string;
  format?: 'csv'; // ⚠️ xlsx 미구현 — csv만 허용
}

// ===== Consolidation (D2) =====
// ⚠️ 후보·그룹·리포트 데이터가 Math.random() 기반 mock — 호출마다 결과가 다름
// ⚠️ autoConsolidate는 stub — 실제 FO 머지 안 함

export interface ConsolidationCandidate {
  salesOrderId?: string;
  customerId: string;
  customerName: string;
  shippingAddress: {
    recipientName: string;
    address: string;
    city: string;
    postalCode: string;
    phone: string;
  };
  deliveryService: string;
  priority: FulfillmentOrderPriority;
  slaDeadline: string;
  totalItems: number;
  totalWeight?: number;
  totalValue?: number;
  items: Array<{
    salesOrderLineId: string;
    productId: string;
    variantId: string;
    qty: number;
    weight?: number;
    dimensions?: { l: number; w: number; h: number };
  }>;
  warehouseId: string;
  createdAt: string;
}

export interface ConsolidationGroupSavings {
  shippingCost: number;
  packagingReduction: number;
  efficiencyGain: number;
}

export interface ConsolidationGroup {
  groupId: string;
  consolidationKey: string;
  reason:
    | 'same_address'
    | 'same_customer_nearby'
    | 'same_service_zone'
    | 'manual';
  confidence: number;
  salesOrders: ConsolidationCandidate[];
  estimatedSavings: ConsolidationGroupSavings;
  constraints: {
    maxWeight: number;
    maxVolume: number;
    maxItems: number;
    slaDeadline: string;
  };
  recommendation: 'auto_consolidate' | 'manual_review' | 'skip';
}

export interface ConsolidationAnalysisResult {
  warehouseId: string;
  analyzedAt: string;
  summary: {
    totalCandidates: number;
    groupsFound: number;
    autoConsolidateRecommended: number;
    manualReviewRequired: number;
    estimatedTotalSavings: number;
  };
  groups: ConsolidationGroup[];
}

export interface ConsolidationLiveOpportunities {
  warehouseId: string;
  timestamp: string;
  opportunities: {
    immediate: {
      count: number;
      potentialSavings: number;
      groups: ConsolidationGroup[];
    };
    reviewRequired: {
      count: number;
      potentialSavings: number;
      groups: ConsolidationGroup[];
    };
  };
  recommendations: string[];
}

export interface ConsolidationSavingsProjection {
  warehouseId: string;
  projectionPeriod: { days: number };
  currentOpportunities: {
    candidateOrders: number;
    consolidationGroups: number;
    consolidationRate: number;
    dailySavings: number;
  };
  projection: {
    totalSavings: number;
    shippingCostSavings: number;
    packagingSavings: number;
    efficiencyGains: number;
    carbonFootprintReduction: number;
  };
  breakdown: {
    autoConsolidation: number;
    manualReview: number;
  };
}

export interface ConsolidationRule {
  id: string;
  name: string;
  priority: number;
  autoConsolidate: boolean;
  criteria: Record<string, unknown>;
  constraints: Record<string, unknown>;
}

// ===== Location Optimization (D2) =====
// ⚠️ routes/optimize, routes/batches/:id, statistics/warehouses/:id 모두 pending_development
// UI는 zones/configuration만 렌더

export interface LocationOptimizationZone {
  zoneCode: string;
  name: string;
  type: string;
  priority: number;
  description: string;
}

// ===== Fulfillment V2 admin reads and commands =====

export type FulfillmentOperationStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'succeeded'
  | 'failed'
  | 'recovery_required';

export type PickingStrategyName =
  | 'discrete'
  | 'aggregate_then_sort'
  | 'pick_to_tote';

export interface FulfillmentV2ProgressItem {
  id: string;
  qty: number;
  shippedQty: number;
  canceledQty: number;
  outstandingQty: number;
  confirmedReservedQty: number;
  activeLineQty: number;
  processing: boolean;
  recoveryRequired: boolean;
  status: string;
}

export interface FulfillmentV2Progress {
  status: string;
  totalQty: number;
  shippedQty: number;
  canceledQty: number;
  outstandingQty: number;
  confirmedReservedQty: number;
  items: FulfillmentV2ProgressItem[];
}

export interface FulfillmentShipmentSummary {
  id: string;
  status: string;
  manifestVersion: number;
  reservationVersion: number;
  shippingProfileId: string | null;
  qty: number;
  reservedQty: number;
}

export interface ShipmentAdminSummary {
  id: string;
  status: string;
  warehouseId: string;
  manifestVersion: number;
  reservationVersion: number;
  totalQty: number;
  reservedQty: number;
  inspectedQty: number;
  recoveryCode: string | null;
}

export interface ShipmentLineOrigin {
  salesOrderLineId: string;
  salesOrderId: string;
  salesChannel: string;
  channelOrderId: string;
  channelOrderItemId: string | null;
  channelProductId: string | null;
}

export interface ShipmentLineReservation {
  id: string;
  shipmentLineId: string | null;
  quantity: number;
  status: string;
}

export interface ShipmentAdminLine {
  id: string;
  fulfillmentOrderId: string;
  fulfillmentOrderItemId: string;
  skuId: string;
  qty: number;
  reservedQty: number;
  inspectedQty: number;
  lineVersion: number;
  origin: ShipmentLineOrigin | null;
  reservations: ShipmentLineReservation[];
}

export interface ShipmentInvoiceHistory {
  id: string;
  status: string;
  trackingNo: string;
  carrier: string | null;
  manifestVersion: number | null;
  issuedAt: string;
  voidedAt: string | null;
}

export interface ShipmentTrackingEvent {
  id: string;
  status: string;
  timestamp: string;
  providerEventId: string | null;
  location: string | null;
}

export interface ShipmentDispatchSource {
  id: string;
  shipmentLineId: string;
  sourceLocationId: string;
  quantity: number;
  stockEventId: string | null;
}

export interface ShipmentDispatchAttemptHistory {
  id: string;
  attemptNo: number;
  status: string;
  invoiceId?: string | null;
  dispatchedAt: string | null;
  recalledAt: string | null;
  recoveryCode: string | null;
  sources: ShipmentDispatchSource[];
  trackingEvents: ShipmentTrackingEvent[];
}

export interface ShipmentOperationHistory {
  /** @deprecated use operationId; retained during the V2 UI rollout. */
  id?: string;
  operationId: string;
  type: string;
  status: FulfillmentOperationStatus;
  reason?: string | null;
  lastError?: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ShipmentWorkItemHistory {
  id: string;
  status: string;
  batchId?: string;
  leaseVersion?: number;
}

export interface ShipmentAdminDetail {
  id: string;
  status: string;
  warehouseId: string;
  manifestVersion: number;
  reservationVersion: number;
  shippingProfileId?: string | null;
  recipientSnapshot:
    | FulfillmentShippingAddress
    | Record<string, unknown>
    | null;
  recoveryCode?: string | null;
  channelProjectionStatus?: string | null;
  manualAdjustmentRequired?: boolean;
  lines: ShipmentAdminLine[];
  invoices: ShipmentInvoiceHistory[];
  workItems: ShipmentWorkItemHistory[];
  dispatchAttempts: ShipmentDispatchAttemptHistory[];
  operations: ShipmentOperationHistory[];
}

export interface FulfillmentOperation<TSnapshot = unknown> {
  operationId: string;
  type: string;
  status: FulfillmentOperationStatus;
  resourceType: string | null;
  resourceId: string | null;
  lastError: string | null;
  createdAt: string;
  completedAt: string | null;
  responseSnapshot?: TSnapshot | null;
}

export interface ShipmentCommandReason {
  reason: string;
  csCaseId?: string;
  note?: string;
}

export interface ShipmentSplitMove {
  shipmentLineId: string;
  expectedLineVersion: number;
  qty: number;
  targetReservedQty?: number;
}

export interface SplitShipmentRequest extends ShipmentCommandReason {
  expectedManifestVersion: number;
  moves: ShipmentSplitMove[];
}

export interface ReviseShipmentRecipientRequest extends ShipmentCommandReason {
  expectedManifestVersion: number;
  recipientSnapshot: FulfillmentShippingAddress;
}

export interface PlanShipmentRequest {
  shippingProfileId: string;
  expectedManifestVersion: number;
  expectedReservationVersion: number;
}

export interface CancelShipmentLineRequest {
  shipmentLineId: string;
  expectedLineVersion: number;
  qty: number;
}

export interface CancelShipmentOutstandingRequest extends ShipmentCommandReason {
  expectedManifestVersion: number;
  lines: CancelShipmentLineRequest[];
}

export interface ShipmentPlanningCommandResponse {
  operationId: string;
  operationStatus?: 'pending' | 'completed';
  shipment?: ShipmentAdminDetail | ShipmentAdminSummary;
  source?: ShipmentAdminDetail | ShipmentAdminSummary;
  target?: ShipmentAdminDetail | ShipmentAdminSummary;
  shipmentId?: string;
  manifestVersion?: number;
}

export interface ShipmentConsolidationCandidate {
  shipmentId: string;
  manifestVersion: number;
  reservationVersion: number;
  salesOrderIds: string[];
  salesChannels: string[];
  lineCount: number;
  totalQty: number;
}

export interface ShipmentConsolidationCandidateGroup {
  compatibilityKey: string;
  warehouseId: string;
  shippingProfileId: string;
  recipientSnapshot: unknown;
  shipments: ShipmentConsolidationCandidate[];
}

export interface ShipmentConsolidationCandidateQuery {
  warehouseId: string;
  sourceShipmentId?: string;
}

export interface ShipmentConsolidationSource {
  shipmentId: string;
  expectedManifestVersion: number;
  expectedReservationVersion: number;
}

export interface CreateShipmentConsolidationRequest extends ShipmentCommandReason {
  sources: ShipmentConsolidationSource[];
  recipientSourceShipmentId?: string;
  recipientSnapshot?: FulfillmentShippingAddress;
}

export interface ShipmentConsolidationResponse {
  operationId: string;
  operationStatus: 'pending' | 'completed';
  sourceShipmentIds: string[];
  targetShipmentId: string | null;
  blockers?: Array<{ shipmentId: string; codes: string[] }>;
  sources?: ShipmentAdminSummary[];
  target?: ShipmentAdminSummary;
  lineLineage?: Array<{
    targetLineId: string;
    fulfillmentOrderItemId: string;
    sourceLineIds: string[];
  }>;
}

export interface IssueShipmentInvoiceRequest extends ShipmentCommandReason {
  expectedManifestVersion: number;
  provider: 'goodsflow' | 'hanjin';
  carrierCode: string;
}

export interface VoidShipmentInvoiceRequest extends ShipmentCommandReason {
  resumeOperationId?: string;
}

export interface InvoiceOperation {
  operationId: string;
  shipmentId: string;
  invoiceId: string | null;
  operation: 'issue' | 'void';
  status:
    | 'pending'
    | 'in_progress'
    | 'succeeded'
    | 'failed'
    | 'recovery_required';
  attempts: number;
  resumeOperationId: string | null;
  nextRetryAt: string | null;
  lastError: string | null;
}

export type ShipmentRecallReason =
  | 'carrier_handoff_failed'
  | 'dispatch_mistake'
  | 'address_correction'
  | 'package_recovered';

export interface RecallShipmentRequest {
  dispatchAttemptId: string;
  expectedManifestVersion: number;
  physicalRecoveryConfirmed: true;
  reason: ShipmentRecallReason;
  csCaseId?: string;
  note?: string;
}

export interface ShipmentRecallOperation {
  operationId: string;
  shipmentId: string;
  dispatchAttemptId: string;
  operationStatus: 'pending' | 'recovery_required' | 'completed';
  invoiceOperationId: string | null;
}

export type ShipmentShortPickReason =
  | 'inventory_shortage'
  | 'item_damaged'
  | 'quality_defect'
  | 'expired_stock';

export interface ShipmentShortPickLineRequest {
  shipmentLineId: string;
  sourceLocationId: string;
  expectedLineVersion: number;
  shortQty: number;
}

export interface ReportShipmentShortPickRequest {
  workItemId: string;
  expectedWorkItemLeaseVersion: number;
  planId: string;
  expectedPlanVersion: number;
  sessionId: string;
  expectedSessionVersion: number;
  expectedManifestVersion: number;
  lines: ShipmentShortPickLineRequest[];
  reason: ShipmentShortPickReason;
  csCaseId?: string;
  note?: string;
}

export interface ShipmentShortPickOperation {
  operationId: string;
  shipmentId: string;
  operationStatus: 'pending' | 'recovery_required' | 'completed';
  invoiceOperationId: string | null;
  workItemId: string;
}

export interface ShipmentInspectionScanRequest {
  barcode: string;
  quantity: number;
}

export type ForceShipmentDispatchRequest = ShipmentCommandReason;

export interface OutboundBatchV2ListQuery {
  warehouseId?: string;
  status?: OutboundBatchStatus;
}

export interface CreateOutboundBatchV2Request {
  warehouseId: string;
  pickingMethod: 'individual';
  name?: string;
  scheduledPickingAt?: string;
}

export interface BatchClaimState {
  state: 'unclaimed' | 'active' | 'expired' | 'released';
  workerId: string | null;
  claimedAt: string | null;
  releasedAt: string | null;
  leaseExpiresAt: string | null;
}

export interface OutboundBatchWorkItemV2 {
  id: string;
  batchId: string;
  shipmentId: string;
  status: string;
  leaseVersion: number;
  pickerId: string | null;
  pickerClaimedAt: string | null;
  pickerReleasedAt: string | null;
  packerId: string | null;
  packerClaimedAt: string | null;
  packerReleasedAt: string | null;
  handedOffAt: string | null;
  completedAt: string | null;
  leaseExpiresAt: string | null;
  exclusionReason: string | null;
  recoveryReason: string | null;
  waitingOperationId: string | null;
  pickerClaim: BatchClaimState;
  packerClaim: BatchClaimState;
}

export interface EligibleShipmentV2 {
  shipmentId: string;
  warehouseId: string;
  shippingProfileId: string;
  manifestVersion: number;
  reservationVersion: number;
  recipientHash: string;
  totalItems: number;
  totalQty: number;
  invoiceId: string;
  trackingNo: string;
}

export interface PickingStrategyCapabilities {
  name: PickingStrategyName;
  requiresPhysicalTote: boolean;
  supportsAggregateSourcePick: boolean;
  inspectionReadyCustody: 'PACKING';
  custodyFlow: string[];
}

export interface PickingPlanMember {
  id: string;
  shipmentId: string;
  workItemId?: string;
  status: string;
}

export interface PickingPlanAllocation {
  id: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
}

export interface PickingPlanSnapshot {
  id: string;
  batchId: string;
  strategy: PickingStrategyName;
  status: string;
  version: number;
  members: PickingPlanMember[];
  allocations: PickingPlanAllocation[];
}

export interface InventorySessionBalance {
  id: string;
  shipmentLineId: string | null;
  skuId: string;
  sourceLocationId: string | null;
  custodyType: string;
  custodyRef: string | null;
  quantity: number;
}

export interface InventorySessionSnapshot {
  id: string;
  status: string;
  version: number;
  handedInQty: number;
  settledQty: number;
  returnedQty: number;
  shortageQty: number;
  recoveryReason: string | null;
  balances: InventorySessionBalance[];
}

export interface ToteAssignmentSnapshot {
  id: string;
  toteId: string;
  toteBarcode: string;
  shipmentId: string;
  workItemId?: string;
  toteStatus: string;
  assignedBy: string;
  assignedAt: string;
  releasedAt: string | null;
}

export interface OutboundBatchV2 {
  id: string;
  batchNumber: string;
  name: string;
  warehouseId: string;
  pickingMethod: string;
  status: OutboundBatchStatus;
  totalItems: number;
  totalQty: number;
  scheduledPickingAt?: string;
  startedAt?: string;
  completedAt?: string;
  warehouse?: {
    id: string;
    name?: string;
    supportedPickingStrategies: PickingStrategyName[];
  };
  workItems: OutboundBatchWorkItemV2[];
  pickingPlan: PickingPlanSnapshot | null;
  inventorySession: InventorySessionSnapshot | null;
  toteAssignments: ToteAssignmentSnapshot[];
}

export interface OutboundBatchV2ListItem {
  id: string;
  batchNumber: string;
  name: string;
  warehouseId: string;
  status: OutboundBatchStatus;
  pickingMethod: string;
  totalItems: number;
  totalQty: number;
  scheduledPickingAt: string | null;
  createdAt: string;
}

export interface ClaimBatchWorkItemRequest {
  expectedLeaseVersion: number;
}

export interface HandoffBatchWorkItemRequest extends ClaimBatchWorkItemRequest {
  claimType: 'picker' | 'packer';
  targetWorkerId: string;
  reason: string;
}

export interface OutboundBatchCommandResponse {
  operationId: string;
  workItem: OutboundBatchWorkItemV2;
}

export interface CreatePickingPlanRequest {
  strategy: PickingStrategyName;
  batchId: string;
  shipmentIds: string[];
}

export interface StartPickingV2Request {
  batchId: string;
  planId: string;
}

export interface DiscretePickingScanRequest {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
  expectedLeaseVersion: number;
}

export interface PickingHandoffRequest {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  targetWorkerId: string;
  expectedLeaseVersion: number;
  reason: string;
}

export interface CompletePickingRequest {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  expectedLeaseVersion: number;
}

export interface PickingPlanResult {
  state: 'planned' | 'invalidated';
  operationId: string;
  planId: string;
  batchId: string;
  strategy?: PickingStrategyName;
  version?: number;
  shipmentIds?: string[];
  allocationCount?: number;
  totalQty?: number;
  reason?: string;
}

export interface PickingStartResult {
  state: 'started' | 'invalidated';
  operationId: string;
  planId: string;
  batchId: string;
  sessionId?: string;
  status?: string;
  reason?: string;
}

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

export interface InspectionReadyOutput {
  operationId: string;
  workItemId: string;
  shipmentId: string;
  custodyType: 'PACKING';
  custodyRef: string;
  lines: Array<{
    shipmentLineId: string;
    skuId: string;
    sourceLocationId: string;
    quantity: number;
  }>;
  totalQty: number;
}

export interface AggregateBulkCartScanRequest {
  batchId: string;
  planId: string;
  sessionId: string;
  skuId: string;
  sourceLocationId: string;
  cartId: string;
  quantity: number;
}

export interface AggregateSortScanRequest {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  shipmentLineId: string;
  skuId: string;
  cartId: string;
  quantity: number;
  expectedLeaseVersion: number;
  destinationCustody: 'SORTING' | 'PACKING';
}

export interface AggregateCartHandoffRequest {
  batchId: string;
  planId: string;
  sessionId: string;
  expectedOwnerId: string;
  targetWorkerId: string;
  cartId: string;
  reason: string;
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

export interface AggregateCartHandoffResult {
  operationId: string;
  sessionId: string;
  sourceCartRef: string;
  targetCartRef: string;
  movedQty: number;
}

export interface RegisterToteRequest {
  warehouseId: string;
  toteBarcode: string;
}

export interface AssignToteRequest {
  batchId: string;
  planId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  toteBarcode: string;
  expectedLeaseVersion: number;
}

export interface ToteScanRequest extends AssignToteRequest {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  quantity: number;
}

export interface ToteHandoffRequest extends AssignToteRequest {
  targetWorkItemId: string;
  targetShipmentId: string;
  targetExpectedLeaseVersion: number;
  reason: string;
}

export interface ReleaseToteRequest extends AssignToteRequest {
  reason: string;
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

export interface ToteScanResult extends PickingScanResult {
  toteId: string;
  toteBarcode: string;
  toteRef: string;
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

export interface ToteReleaseResult {
  operationId: string;
  assignmentId: string;
  toteId: string;
  toteBarcode: string;
  shipmentId: string;
  status: 'released';
}

export interface ReturnEligibilityItem {
  salesOrderLineId: string;
  shipmentId: string;
  shipmentLineId: string;
  dispatchAttemptId: string;
  deliveredAt: string;
  shippedQty: number;
  claimedQty: number;
  remainingEligibleQty: number;
  salesOrderLineRemainingEligibleQty: number;
}

export interface ReturnEligibilityResponse {
  orderId: string;
  items: ReturnEligibilityItem[];
}
