import { DemandPattern } from '../policy/classification';
import { DemandGrade } from '../demand/demand-profile.calculator';

export type SuggestionFlag = 'default_lead_time' | 'supplier_unknown' | 'low_confidence';

export interface AxisLevels {
  safetyStock: number;
  reorderPoint: number;
  targetLevel: number;
  leadTimeDays: number;
}

export interface SkuStockInput {
  skuId: string;
  skuCode: string;
  skuName: string;
  supplier: { id: string; name: string } | null;
  /** 공급사 default_warehouse_id — 발주 제안의 출발 창고 */
  sourceWarehouseId: string | null;
  pattern: DemandPattern;
  grade: DemandGrade;
  confidence: 'normal' | 'low';
  demand: { dailyMean: number; dailyStd: number };
  legacyReorderPoint: number;
  /** 정책 층(B)이 축마다 계산한 수준. 조립기는 계산하지 않고 쓴다 */
  levels: { company: AxisLevels; sellable: AxisLevels };
  /** 파라미터 층이 정한 플래그 (default_lead_time · low_confidence). supplier_unknown 은 조립기가 붙인다 */
  parameterFlags: SuggestionFlag[];
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
  /** draft 이동 지시서에 이미 실린 planned 합 — 비판매 출발 창고별 */
  draftTransferPlanned: Array<{ fromWarehouseId: string; qty: number }>;
}

export interface AssembleContext {
  sellableWarehouseId: string;
}

export interface AxisView extends AxisLevels {
  onHand: number;
  reserved: number;
  position: number;
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
  pattern: DemandPattern;
  grade: DemandGrade;
  confidence: 'normal' | 'low';
  demand: { dailyMean: number; dailyStd: number };
  company: CompanyAxis;
  sellable: SellableAxis;
  actions: SuggestionAction[];
  flags: SuggestionFlag[];
  legacyReorderPoint: number;
}
