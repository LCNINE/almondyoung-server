// src/lib/types/dto/fulfillment.ts
// 풀필먼트(출고) 도메인 DTO 타입 — 통합 서버 컨트롤러 스키마와 1:1 대응

import type { LineCompositionView } from './line-composition';

// ===== Fulfillment Order =====

export type FulfillmentMode = 'in_house' | '3pl' | 'drop_ship';
export type FulfillmentOrderPriority = 'normal' | 'high' | 'urgent';
// 백엔드 fulfillmentStatusEnum 전체와 1:1 (inventory.schema.ts)
export type FulfillmentOrderStatus =
  | 'created'
  | 'partially_reserved'
  | 'ready'
  | 'processing'
  | 'partially_shipped'
  | 'shipped'
  | 'completed'
  | 'canceled'
  | 'recovery_required';

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
  /** FO 항목이 가리키는 판매주문 라인과 구성. 옛 core 는 이 칸을 안 준다 */
  lines?: LineCompositionView[];
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

export interface FulfillmentShippingAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  roadAddress: string;
  detailAddress: string;
  deliveryNote?: string;
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

// ===== Outbound Batches (D2) =====

export type OutboundBatchStatus =
  | 'created'
  | 'picking'
  | 'completed'
  | 'canceled';

// ===== Direct Ship — 입점사 상자 (K3) =====
// core `supplier-shipment-queue.dto.ts`·`supplier-sheet.dto.ts` 와 1:1. 날짜는 ISO 문자열.

/**
 * core `carrierEnum`(inventory.schema.ts) 전체 — 입점사가 시트에 적을 수 있는 택배사.
 * 아래 «Waybill» 의 `CarrierCode` 는 우리가 발급하는 택배사만이라 이름을 달리 둔다.
 */
export type SupplierSheetCarrier =
  | 'CJ'
  | 'HANJIN'
  | 'LOTTE'
  | 'LOGEN'
  | 'KDEXP'
  | 'CJGLS'
  | 'EPOST'
  | 'DAESIN'
  | 'ILYANG'
  | 'HDEXP'
  | 'CVSNET'
  | 'CUPOST'
  | 'CHUNIL'
  | 'KUNYOUNG';

export interface SupplierQueueSummary {
  supplierId: string;
  supplierCode: string | null;
  supplierName: string;
  /** 아직 입점사에게 안 넘긴 열린 상자 수 */
  pendingShipments: number;
  /** 넘겼지만 발송 전인 열린 상자 수 */
  forwardedShipments: number;
  /** 열린 상자에서 입점사가 «못 보냄»으로 알린 라인 수 */
  unfulfillableLines: number;
}

export type SupplierQueueStage = 'pending' | 'forwarded';

export interface SupplierQueueLine {
  shipmentLineId: string;
  skuId: string;
  skuName: string;
  /** 그 입점사와의 sku_suppliers.supplier_sku */
  supplierSku: string | null;
  qty: number;
  unfulfillableReason: string | null;
  unfulfillableReportedAt: string | null;
}

export interface SupplierQueueShipment {
  shipmentId: string;
  stage: SupplierQueueStage;
  salesOrderId: string;
  orderNo: string;
  openedAt: string;
  handoffId: string | null;
  handoffAt: string | null;
  lines: SupplierQueueLine[];
}

export interface SupplierSheetColumn {
  key: string;
  header: string;
}

export interface SupplierSheetRow {
  /** 행 키 = 발주 항목(FOI) id. 입점사가 지우면 안 된다 */
  rowKey: string;
  orderNo: string;
  productName: string;
  /** 없으면 빈 문자열 */
  supplierSku: string;
  qty: number;
  recipientName: string;
  recipientPhone: string;
  address: string;
  entrancePassword: string;
  deliveryMemo: string;
  carrier: string;
  trackingNo: string;
  unfulfillableReason: string;
  /** 개인정보 접속기록의 대상 식별자 — 시트 열이 아니다 */
  salesOrderId: string;
}

export interface SupplierSheetSkippedShipment {
  shipmentId: string;
  reason: 'RECIPIENT_INCOMPLETE';
}

export interface SupplierSheet {
  handoffId: string;
  supplierId: string;
  fileName: string;
  columns: SupplierSheetColumn[];
  rows: SupplierSheetRow[];
  /** 수령인 정보가 불완전해 싣지 못한 상자 */
  skippedShipments: SupplierSheetSkippedShipment[];
}

export type SupplierRowVerdictKind =
  | 'ship'
  | 'merge'
  | 'unfulfillable'
  | 'waiting'
  | 'correct'
  | 'unchanged'
  | 'error';

export type SupplierRowErrorCode =
  | 'UNKNOWN_ROW_KEY'
  | 'OTHER_SUPPLIER'
  | 'CANCELED'
  | 'NOT_HANDED_OFF'
  | 'IN_RECOVERY'
  | 'ROW_MISMATCH'
  | 'QTY_MISMATCH'
  | 'DUPLICATE_ROW'
  | 'UNKNOWN_CARRIER'
  | 'CARRIER_WITHOUT_TRACKING'
  | 'TRACKING_WITHOUT_CARRIER'
  | 'TRACKING_AND_REASON'
  | 'TRACKING_IN_USE'
  | 'MERGE_RECIPIENT_MISMATCH'
  | 'CORRECTION_PARTIAL'
  | 'REASON_ON_SHIPPED'
  | 'GROUP_HAS_ERROR';

/** 올린 시트 한 줄의 판정 — 개인정보 없음 */
export interface SupplierRowVerdict {
  /** 엑셀의 실제 행 번호(머리글이 1행) */
  rowNumber: number;
  rowKey: string;
  orderNo: string;
  verdict: SupplierRowVerdictKind;
  /** verdict 가 error 일 때만 */
  code?: SupplierRowErrorCode;
  carrier?: SupplierSheetCarrier;
  trackingNo?: string;
}

/** 판정 종류마다 줄 수 — 0 인 종류도 온다 */
export type SupplierSheetVerdictCounts = Record<SupplierRowVerdictKind, number>;

export interface SupplierSheetPreview {
  rows: SupplierRowVerdict[];
  counts: SupplierSheetVerdictCounts;
  /** 적용할 때 같은 파일과 함께 previewToken 으로 돌려준다 */
  token: string;
}

export interface SupplierSheetApplyResult {
  counts: SupplierSheetVerdictCounts;
  /** 이번에 발송한 상자(나누기·합포장 뒤의 최종 상자) */
  shippedShipmentIds: string[];
}

/** 넘김 묶음 한 줄 — 개인정보 없음 */
export interface SupplierHandoffSummary {
  handoffId: string;
  createdAt: string;
  createdBy: string;
  /** 그 묶음을 가리키는 열린 상자(draft·recovery_required) */
  openShipments: number;
  shippedShipments: number;
  /** 열린 상자에서 입점사가 못 보냄으로 알린 라인 */
  unfulfillableLines: number;
}

export interface DirectShipCancelNotice {
  id: string;
  supplierId: string;
  companyName: string;
  salesOrderId: string;
  channelOrderId: string | null;
  salesOrderLineId: string | null;
  fulfillmentOrderId: string;
  skuName: string;
  supplierSku: string | null;
  canceledQty: number;
  cancellationScope: 'full' | 'partial';
  cancelledAt: string;
  createdAt: string;
  notifiedAt: string | null;
  notifiedBy: string | null;
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

// core 의 picking-method.contract.ts 와 1:1 대응(배치의 pickingMethod). admin-web 은
// core 모듈을 import 할 수 없어 값을 복제하는 것은 승인된 설계 결정이나, admin-web
// 내부에서는 이 타입 하나로만 참조한다 — 값이 바뀌면 여기 한 곳만 고친다.
export type PickingMethod = 'individual' | 'total_picking' | 'multi_order';

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
  warehouseId: string | null;
  supplierId: string | null;
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

export interface ShipmentWaybillHistory {
  id: string;
  status: string;
  trackingNo: string | null;
  carrier: string;
  manifestVersion: number;
  issuedAt: string | null;
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
  waybillId?: string | null;
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
  warehouseId: string | null;
  supplierId: string | null;
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
  waybills: ShipmentWaybillHistory[];
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

export interface SplitUnreservedShipmentRequest extends ShipmentCommandReason {
  expectedManifestVersion: number;
}

export interface ReviseShipmentRecipientRequest extends ShipmentCommandReason {
  expectedManifestVersion: number;
  /**
   * 배송지를 실제로 고칠 때만 보낸다. 이 폼이 아는 6개 키가 스냅샷 전부가 아니기 때문에
   * (sales-order 는 `personalCustomsCode` 까지 넣는다) 안 바뀐 주소를 되보내면 통관부호가
   * 지워지고 manifestVersion 이 올라간다. 생략하면 core 가 스냅샷을 그대로 둔다.
   */
  recipientSnapshot?: FulfillmentShippingAddress;
  /**
   * 공동현관 출입 비밀번호. recipientSnapshot 밖의 크리덴셜이라 이것만 바뀌면 core 는
   * 스냅샷도 manifestVersion 도 건드리지 않는다. 생략하면 기존 값을 그대로 둔다.
   */
  entrancePassword?: string;
}

export interface PlanShipmentRequest {
  shippingProfileId: string;
  expectedManifestVersion: number;
  expectedReservationVersion: number;
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
  sessionId: string;
  expectedSessionVersion: number;
  expectedManifestVersion: number;
  lines: ShipmentShortPickLineRequest[];
  reason: ShipmentShortPickReason;
  csCaseId?: string;
  note?: string;
}

export interface ShortPickRefill {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface ShortPickShortage {
  shipmentLineId: string | null;
  skuId: string | null;
  skuCode: string | null;
  skuName: string | null;
  requiredQty: number | null;
  shortQty: number | null;
  reason: 'INBOUND_PENDING' | 'STOCK_SHORT';
}

export interface ShipmentShortPickOperation {
  operationId: string;
  shipmentId: string;
  workItemId: string;
  operationStatus: 'pending' | 'recovery_required' | 'completed';
  invoiceOperationId: string | null;
  /** 옛 서버 응답(배포 겹침) 호환으로 선택 */
  outcome?: 'refilled' | 'withdrawing' | 'exited';
  refills?: ShortPickRefill[];
  shortages?: ShortPickShortage[];
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
  pickingMethod: PickingMethod;
  cartCapacity?: number;
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
  waybillId: string;
  trackingNo: string;
}

export interface PickingStrategyCapabilities {
  name: PickingStrategyName;
  requiresPhysicalTote: boolean;
  supportsAggregateSourcePick: boolean;
  inspectionReadyCustody: 'PACKING';
  custodyFlow: string[];
}

export interface BatchPickingAllocation {
  id: string;
  workItemId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  qty: number;
  sourceStockVersion: number;
  createdAt: string;
}

export interface BatchPickingSnapshot {
  strategy: PickingStrategyName;
  startedAt: string;
  allocations: BatchPickingAllocation[];
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
  pickingMethod: PickingMethod;
  cartCapacity: number | null;
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
  picking: BatchPickingSnapshot | null;
  inventorySession: InventorySessionSnapshot | null;
  toteAssignments: ToteAssignmentSnapshot[];
}

export interface OutboundBatchV2ListItem {
  id: string;
  batchNumber: string;
  name: string;
  warehouseId: string;
  status: OutboundBatchStatus;
  pickingMethod: PickingMethod;
  cartCapacity: number | null;
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

export interface StartPickingV2Request {
  batchId: string;
}

export interface DiscretePickingScanRequest {
  batchId: string;
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
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  targetWorkerId: string;
  expectedLeaseVersion: number;
  reason: string;
}

export interface CompletePickingRequest {
  batchId: string;
  sessionId: string;
  workItemId: string;
  shipmentId: string;
  expectedLeaseVersion: number;
}

export interface PickingStartResult {
  state: 'started';
  operationId: string;
  batchId: string;
  sessionId: string;
  status: string;
}

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
  sessionId: string;
  skuId: string;
  sourceLocationId: string;
  cartId: string;
  quantity: number;
}

export interface AggregateSortScanRequest {
  batchId: string;
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
  sessionId: string;
  expectedOwnerId: string;
  targetWorkerId: string;
  cartId: string;
  reason: string;
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

// ===== Waybill (운송장) =====

export type CarrierCode =
  | 'CJ'
  | 'HANJIN'
  | 'LOTTE'
  | 'LOGEN'
  | 'KDEXP'
  | 'CJGLS';

export interface WaybillResponse {
  id: string;
  shipmentId: string;
  source: 'carrier' | 'manual' | string;
  carrier: string;
  status: string;
  trackingNo: string | null;
  custOrdNo: string | null;
  manifestVersion: number;
  issuedAt: string | null;
  voidedAt: string | null;
  lastError: string | null;
  // 일시적 거절(한진 일일한도·지역통제)로 대기 중이면 다음 재시도 시각. 없으면 대기 중이 아니다.
  nextAttemptAt: string | null;
  transientAttempts: number;
}

export interface AbandonWaybillRequest {
  reason: string;
}

export interface IssueWaybillRequest {
  carrier: CarrierCode;
  expectedManifestVersion: number;
}

export interface RegisterManualWaybillRequest {
  carrier: CarrierCode;
  expectedManifestVersion: number;
  trackingNo: string;
  reason?: string;
}

export interface IssueBatchWaybillRequest {
  shipmentIds: string[];
  carrier: CarrierCode;
}

export interface VoidWaybillRequest {
  reason: string;
}

export interface BatchResultItem {
  shipmentId: string;
  status: string; // registered | failed | pending | allocated
  trackingNo: string | null;
  reason: string | null;
  // pending 이 «시간예산 초과»인지 «일시적 거절로 대기»인지 가른다.
  nextAttemptAt: string | null;
}
