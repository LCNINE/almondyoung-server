export type StocktakingStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export interface StocktakingSession {
  id: string;
  warehouseId: string;
  sessionName: string;
  status: StocktakingStatus;
  notes: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface StocktakingLine {
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
  locationId: string;
  locationCode: string;
  expectedItems: ScanLocationItem[];
}

/** POST /stocktaking/scan-product — countedQuantity 는 갱신 후 절대값. */
export interface ScanProductResult {
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
  locationId: string | null;
  countedQuantity: number;
  currentOnHand: number;
  delta: number;
  adjustmentType: 'INCREASE' | 'DECREASE';
}

export interface GenerateAdjustmentsResult {
  adjustmentsCreated: number;
  eventsPosted: number;
  message: string;
  preview: AdjustmentPreview[];
}
