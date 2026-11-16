import type { BoxCandidate, BoxView, ReceiveBoxResult, ShipmentSummary } from '../../domains/inbound-shipment/types';

/** 화면 상태 — 대기 → (고르기) → 상자 작업·확정된 상자·전달용 상자 */
export type InboundBoxesView =
  | { kind: 'waiting' }
  | { kind: 'choose'; label: string; candidates: BoxCandidate[] }
  | { kind: 'chooseShipmentForAdd'; label: string; shipments: ShipmentSummary[] }
  | { kind: 'work'; box: BoxView }
  | { kind: 'received'; box: BoxView }
  | { kind: 'forward'; box: BoxView }
  | { kind: 'done'; box: BoxView; result: ReceiveBoxResult };

/** 화면 위 한 줄 — error 는 오류음과 함께 */
export interface InboundBoxesNotice {
  text: string;
  tone: 'error' | 'info';
}

const DAY_MS = 86_400_000;
const ADD_WINDOW_DAYS = 30;

/**
 * 리스트에 없는 상자를 더할 수 있는 선적(스펙 §7.6) — 열린 선적 전부 + 저절로 끝난 지 30일 안.
 * 사람이 닫은 선적은 현장이 상자를 더하지 못한다.
 */
export function addableShipments(shipments: ShipmentSummary[], now: Date): ShipmentSummary[] {
  return shipments.filter((s) => {
    if (s.status === 'expected' || s.status === 'receiving') return true;
    if (s.status !== 'closed' || s.closedManually || !s.closedAt) return false;
    const closed = Date.parse(s.closedAt);
    return Number.isFinite(closed) && now.getTime() - closed <= ADD_WINDOW_DAYS * DAY_MS;
  });
}

/** 도착 예정일을 «11-20» 로 — 날짜가 아니면 null */
export function arrivalDay(expectedArrival: string | null): string | null {
  const match = expectedArrival ? /^\d{4}-(\d{2})-(\d{2})/.exec(expectedArrival) : null;
  return match ? `${match[1]}-${match[2]}` : null;
}
