import { ShipmentProgressDto } from '../dto/store-order-actions.dto';

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
  /** 인쇄 외주(print_orders) 상태 목록 (취소 제외). 없으면 생략 */
  printStatuses?: string[];
}

type UnitPhase = 'preparing' | 'shipping' | 'delivered';

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
 * 진행 요약 = 소포(창고 상자·직배·인쇄 행) 수. 순수 함수 — DB 접근 없음.
 * 주문의 단계·출고 여부는 여기서 고르지 않는다 — 사다리 한 벌(`orderFulfillmentPhaseSql`)이 정한다(K6 PR2b).
 * 요약은 «몇 개 중 몇 개가 나갔나»라 상자 status 로 센다. 활성 FO 에 상자·직배가 아직 없으면 창고 몫은 세지 않는다.
 */
export function shipmentProgressOf(input: FulfillmentPhaseInput): ShipmentProgressDto {
  const printUnits = (input.printStatuses ?? []).map(printUnitPhase);
  const warehouseUnits: UnitPhase[] =
    input.foCount > 0 && !input.allFoCanceled
      ? [...input.activeShipmentStatuses.map(shipmentUnitPhase), ...input.dropShipStatuses.map(dropShipUnitPhase)]
      : [];
  const units = [...warehouseUnits, ...printUnits];
  return {
    total: units.length,
    shipped: units.filter((u) => u === 'delivered' || u === 'shipping').length,
    delivered: units.filter((u) => u === 'delivered').length,
  };
}

/**
 * 반품·교환을 열 수 있는가. 창고 몫이 모두 배송완료이고 인쇄 몫은 발송만 됐으면 된다.
 * 와우프레스 택배는 출고완료(ordstat=80)에서 끝나 인쇄 행이 shipped 에 머물므로, «있는 몫이 전부 배송완료»로 판정하면 영영 열리지 않는다.
 */
export function isReturnEligible(input: FulfillmentPhaseInput): boolean {
  // 인쇄 줄은 반품·교환을 받지 않는다(주문제작). 창고 몫이 없으면 고를 줄이 없어 신청할 수 없으니 고객센터로 보낸다
  if (input.foCount === 0 || input.allFoCanceled) return false;
  const warehouseUnits = [
    ...input.activeShipmentStatuses.map(shipmentUnitPhase),
    ...input.dropShipStatuses.map(dropShipUnitPhase),
  ];
  if (warehouseUnits.length === 0 || warehouseUnits.some((u) => u !== 'delivered')) return false;
  return (input.printStatuses ?? []).every((s) => printUnitPhase(s) !== 'preparing');
}

/** 피킹/패킹 시작 여부 = FO status 'processing' (fulfillment-progress: "picking/packing/inspection has begun") */
export function isPickingStarted(fos: { status: string }[]): boolean {
  return fos.some((fo) => fo.status === 'processing');
}
