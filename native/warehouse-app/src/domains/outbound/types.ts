import type { LabelItemChange, LabelState } from './waybillLabel';

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

/** 줄의 배정 위치 하나 — 송장 품목 줄과 같은 순서(로케이션 코드 순, core A5) */
export interface ShipmentLineAllocation {
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

export interface ShipmentByWaybillLine {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
  /** core A5(스테이션 UI PR A)부터 싣는다 — 옛 core 면 없다. 결품 보고의 줄 버전 */
  lineVersion?: number;
  /** core A5 부터. 시작 안 된 배치·작업 항목 없음이면 [] */
  allocations?: ShipmentLineAllocation[];
}

/** 결품 보고(POST shipments/:id/short-picks)에 보낼 버전들(core A5). 스캔마다 낡으므로 보내기 직전에 다시 조회한다 */
export interface ShortPickContext {
  workItemLeaseVersion: number;
  sessionId: string;
  sessionVersion: number;
  manifestVersion: number;
}

export interface WithdrawalRemoval {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  boxQty: number;
  cartQty: number;
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
  labelState: LabelState | null;
  labelChanges: LabelItemChange[];
  labelIssue: string | null;
  removals: WithdrawalRemoval[];
  exitTo: 'draft' | 'canceled' | null;
  /** 배송메모(core A5). 없으면 null, 옛 core 면 필드가 없다 */
  deliveryNote?: string | null;
  /** 결품 보고 버전(core A5). 활성 작업 항목과 active 세션이 둘 다 있을 때만 값이 있다 */
  shortPickContext?: ShortPickContext | null;
}

export interface OutboundBatchSummary {
  id: string;
  batchNumber: string;
  name: string;
  status: string;
  totalItems: number;
  totalQty: number;
  /** 「작업 시작」을 누른 시각. null 이면 아직 시작 전이다. */
  startedAt: string | null;
  /** 이 배치에서 빼는 중인 박스 수 — 배치 카드의 «빠지는 중 N». */
  withdrawingItems: number;
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
