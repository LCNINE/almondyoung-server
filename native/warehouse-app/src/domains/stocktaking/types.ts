export type StocktakingStatus =
  'draft' | 'in_progress' | 'completed' | 'cancelled';

export interface StocktakingSession {
  id: string;
  sessionRevision?: number;
  warehouseId: string;
  sessionName: string;
  status: StocktakingStatus;
  notes: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StocktakingLine {
  lineRevision?: number;
  countBaselineVersion?: number | null;
  lineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  locationId: string | null;
  locationCode: string | null;
  expectedQuantity: number;
  /** 미카운트면 null. */
  countedQuantity: number | null;
  variance: number | null;
  scannedBarcode: string | null;
  status: string;
  notes: string | null;
}

export interface StocktakingSessionDetail extends StocktakingSession {
  progress: { total: number; counted: number };
  lines: StocktakingLine[];
}

/** POST /stocktaking/scan-location 의 expectedItems[] (Task 3 에서 확장됨). */
export interface ScanLocationItem {
  lineRevision?: number;
  countBaselineVersion?: number | null;
  lineId: string;
  skuId: string;
  skuName: string;
  skuCode: string;
  barcode: string | null;
  expectedQuantity: number;
  countedQuantity: number | null;
  status: string;
}

export interface ScanLocationResult {
  sessionRevision?: number;
  locationId: string;
  locationCode: string;
  expectedItems: ScanLocationItem[];
}

/** POST /stocktaking/scan-product — countedQuantity 는 갱신 후 절대값. */
export interface ScanProductResult {
  lineRevision?: number;
  countBaselineVersion?: number | null;
  lineId: string;
  skuId: string;
  countedQuantity: number;
  expectedQuantity: number;
  variance: number;
}

export interface Variance {
  lineId: string;
  locationCode: string | null;
  skuName: string;
  skuCode: string;
  expectedQuantity: number;
  countedQuantity: number | null;
  variance: number | null;
  discrepancyPercent: number;
}

export interface AdjustmentPreview {
  lineId: string;
  skuId: string;
  skuName?: string;
  locationId: string | null;
  countedQuantity: number;
  currentOnHand: number;
  delta: number;
  adjustmentType: 'INCREASE' | 'DECREASE';
}

export interface GenerateAdjustmentsResult {
  sessionRevision: number;
  previewToken: string;
  adjustmentsCreated: number;
  eventsPosted: number;
  message: string;
  preview: AdjustmentPreview[];
  /** 완료하면 줄어드는 재고를 잡은 주문 예약을 놓는다 — 옛 서버는 보내지 않는다 */
  reservationImpact?: ReservationImpact[];
}

export interface ReservationImpact {
  skuId: string;
  /** 예약을 놓고 다시 재고를 기다리게 되는 주문 수와 수량 */
  orderCount: number;
  quantity: number;
  /** 출고 준비에 들어가 놓지 못하는 수량과 그 주문 */
  missingQty: number;
  heldBy: { orderNo: string | null; quantity: number }[];
}
