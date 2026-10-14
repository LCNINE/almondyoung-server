import { StoreFulfillmentStatus, ShipmentProgressDto } from '../dto/store-order-actions.dto';

export interface PhaseFoRow {
  status: string;
  directShipStatus: string | null;
  fulfillmentMode: string | null;
}

export interface FulfillmentPhaseInput {
  foCount: number;
  allFoCanceled: boolean;
  /** canceled/superseded 제외한 상자 status 목록 */
  activeShipmentStatuses: string[];
  /** 직배(drop_ship) FO 의 directShipStatus (canceled 제외; 상자 없음) */
  dropShipStatuses: string[];
  /** FO 가 출고 흔적(partially_shipped/completed/shipped)을 가지는가 = FOI shippedQty>0 */
  anyFoiShipped: boolean;
  /** 인쇄 외주(print_orders) 상태 목록 (취소 제외). 없으면 생략 */
  printStatuses?: string[];
}

export interface FulfillmentPhaseResult {
  phase: StoreFulfillmentStatus;
  progress: ShipmentProgressDto;
}

type UnitPhase = 'preparing' | 'shipping' | 'delivered';

export const MOVED_SHIPMENT_STATUSES = new Set(['shipped', 'in_transit', 'delivered', 'failed']);
const MOVED_DROPSHIP_STATUSES = new Set(['forwarded', 'completed']);

function shipmentUnitPhase(status: string): UnitPhase {
  if (status === 'delivered') return 'delivered';
  if (status === 'shipped' || status === 'in_transit' || status === 'failed') return 'shipping';
  return 'preparing'; // draft, planned, recovery_required
}

function dropShipUnitPhase(status: string): UnitPhase {
  if (status === 'completed') return 'delivered';
  if (status === 'forwarded') return 'shipping';
  return 'preparing'; // pending
}

function printUnitPhase(status: string): UnitPhase {
  if (status === 'delivered') return 'delivered';
  if (status === 'shipped') return 'shipping';
  return 'preparing'; // pending, submitting, submitted, failed, cancelling, cancel_refused …
}

/**
 * 대표 이행 상태 + 진행 요약. 순수 함수 — DB 접근 없음.
 * 합의(consensus) 규칙: 모든 활성 유닛 delivered → delivered; 하나라도 이동 → shipping; 그 외 preparing.
 * 활성 인쇄 외주 행도 창고 상자·직배와 같은 이행 단위로 센다(혼합 주문에서 제작 중인데 배송완료로 보이지 않게).
 */
export function deriveFulfillmentPhase(input: FulfillmentPhaseInput): FulfillmentPhaseResult {
  const empty: ShipmentProgressDto = { total: 0, shipped: 0, delivered: 0 };
  const printUnits = (input.printStatuses ?? []).map(printUnitPhase);
  const warehouseActive = input.foCount > 0 && !input.allFoCanceled;
  if (!warehouseActive && printUnits.length === 0) {
    return { phase: input.foCount === 0 ? 'not_created' : 'canceled', progress: empty };
  }

  const warehouseUnits: UnitPhase[] = warehouseActive
    ? [...input.activeShipmentStatuses.map(shipmentUnitPhase), ...input.dropShipStatuses.map(dropShipUnitPhase)]
    : [];
  // 활성 FO 에 상자·직배가 아직 없으면 창고 몫은 준비중이다 — 진행 요약에는 세지 않지만 배송완료는 막는다
  const warehouseUnitless = warehouseActive && warehouseUnits.length === 0;
  const units = [...warehouseUnits, ...printUnits];

  const delivered = units.filter((u) => u === 'delivered').length;
  const shipped = units.filter((u) => u === 'delivered' || u === 'shipping').length;
  const progress: ShipmentProgressDto = units.length === 0 ? empty : { total: units.length, shipped, delivered };

  if (!warehouseUnitless && units.every((u) => u === 'delivered')) return { phase: 'delivered', progress };
  if (shipped > 0) return { phase: 'shipping', progress };
  return { phase: 'preparing', progress };
}

/** 피킹/패킹 시작 여부 = FO status 'processing' (fulfillment-progress: "picking/packing/inspection has begun") */
export function isPickingStarted(fos: { status: string }[]): boolean {
  return fos.some((fo) => fo.status === 'processing');
}

/** 하나라도 출고 증거가 있는가 (부분 출고 포함) */
export function hasShippedEvidence(input: FulfillmentPhaseInput): boolean {
  if (input.anyFoiShipped) return true;
  if (input.printStatuses?.some((s) => s === 'shipped' || s === 'delivered')) return true;
  if (input.activeShipmentStatuses.some((s) => MOVED_SHIPMENT_STATUSES.has(s))) return true;
  if (input.dropShipStatuses.some((s) => MOVED_DROPSHIP_STATUSES.has(s))) return true;
  return false;
}
