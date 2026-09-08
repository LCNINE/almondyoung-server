export type SuggestionFlag = 'default_lead_time' | 'supplier_unknown' | 'low_confidence' | 'legacy_only';

export interface SkuStockInput {
  skuId: string;
  skuCode: string;
  skuName: string;
  supplier: { id: string; name: string } | null;
  /** C 단계: skus.safety_stock. A+B 가 계산값으로 교체 */
  safetyStock: number;
  lot: { moq: number | null; packingUnit: number | null };
  excluded: boolean;
  /** 전 창고 ON_HAND 합 (판매·비판매 모두) */
  onHandTotal: number;
  /** 전 창고 IN_TRANSFER 합 */
  inTransferTotal: number;
  /** 전 창고 확정 예약 합 */
  reservedTotal: number;
  /** 판매 창고 ON_HAND */
  onHandSellable: number;
  /** 판매 창고 확정 예약 */
  reservedSellable: number;
  /** 비판매 창고 ON_HAND 를 (창고, 로케이션) 별로 — 이동 라인 재료 */
  nonSellableOnHand: Array<{ warehouseId: string; locationId: string; qty: number }>;
  /** 파이프라인: 전 창고 발주잔량 / 비판매 창고행 발주잔량 / 판매창고로 이동중 */
  onOrderTotal: number;
  onOrderNonSellable: number;
  inTransitToSellable: number;
  /** draft 이동 지시서에 이미 실린 planned 합 */
  draftTransferPlanned: number;
}

export interface AssembleContext {
  sellableWarehouseId: string;
}

export interface AxisView {
  onHand: number;
  reserved: number;
  position: number;
  safetyStock: number;
  reorderPoint: number;
  targetLevel: number;
  leadTimeDays: number;
}

export interface CompanyAxis extends AxisView {
  inTransfer: number;
  onOrder: number;
}

export interface SellableAxis extends AxisView {
  warehouseId: string;
  inTransit: number;
  onOrderDirect: number;
  daysOfCover: number | null;
}

export type SuggestionAction =
  | { type: 'purchase'; qty: number; supplierId: string | null; sourceWarehouseId: string | null }
  | {
      type: 'transfer';
      qty: number;
      fromWarehouseId: string;
      toWarehouseId: string;
      lines: Array<{ fromLocationId: string; quantity: number }>;
    };

export interface SuggestionRow {
  skuId: string;
  skuCode: string;
  skuName: string;
  supplier: { id: string; name: string } | null;
  pattern: 'insufficient';
  grade: 'C';
  confidence: 'low';
  demand: { dailyMean: number; dailyStd: number };
  company: CompanyAxis;
  sellable: SellableAxis;
  actions: SuggestionAction[];
  flags: SuggestionFlag[];
  legacyReorderPoint: number;
}
