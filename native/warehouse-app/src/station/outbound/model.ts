/** 출고 검수(F1) 화면이 주고받는 상태 — 부모(InspectionScreen)와 박스별 자식(InspectWork·WithdrawWork)이 같이 쓴다 */

import type { ShipmentByWaybill } from '../../domains/outbound/types';
import type { LabelItemChange } from '../../domains/outbound/waybillLabel';

/** 왼쪽 큰 칸의 빨간 오류(목업 ③). 다음 스캔에서 사라진다 */
export interface Alert {
  message: string;
  /** 거절된 바코드나 송장번호 */
  detail?: string;
}

export type PrintStatus = { kind: 'printing' } | { kind: 'printed' } | { kind: 'failed'; message: string };

/** 채움(refilled) 배너의 «가져올 것» 한 줄 — `[C-07-1] 퍼머넌트 1제 ×1` */
export interface RefillShown {
  locationCode: string;
  name: string;
  qty: number;
}

/** 송장 대기 화면 위의 직전 박스(목업 ①) */
export type LastBox =
  | { kind: 'shipped'; trackingNo: string }
  | { kind: 'refilled'; trackingNo: string; shipmentId: string; items: RefillShown[]; print: PrintStatus };

/** 부모가 «정한» 화면. 박스 화면은 열 때마다 seq 가 새로 붙는다(같은 박스를 다시 열어도 다른 화면) */
export type View =
  | { kind: 'waiting' }
  | { kind: 'inspect'; box: ShipmentByWaybill; seq: number }
  | { kind: 'reprint'; box: ShipmentByWaybill; changes: LabelItemChange[]; print: PrintStatus }
  | { kind: 'withdraw'; box: ShipmentByWaybill; seq: number }
  | { kind: 'withdrawn'; box: ShipmentByWaybill };

/** 부모(출고 검수 화면)가 송장인지 상품인지 가른 뒤 상품을 넘기는 곳. 내려놓기·전환 전에 앞 스캔을 다 보낸다 */
export interface BoxWorkHandle {
  /** 이 손잡이가 속한 박스 화면 — 부모가 정한 화면과 다르면 상품을 넘기지 않는다 */
  shipmentId: string;
  seq: number;
  accept(code: string): void;
  /** 스캔이 이 화면에 닿았다 — 부모가 거절한 송장 스캔도 «한 번 더» 대기를 푼다 */
  disarm(): void;
  settle(): Promise<void>;
}

/**
 * 정한 화면의 손잡이만 돌려준다. 옛 박스가 한 번 더 그려지면(화면 전환보다 먼저 처리된 키 입력) 그 effect 가 go() 가
 * 비운 자리에 옛 손잡이를 다시 건다 — React 의 그리기 순서와 상관없이, 손잡이가 정한 화면의 것일 때만 상품을 받는다
 */
export function workFor(view: View, handle: BoxWorkHandle | null): BoxWorkHandle | null {
  if (!handle || (view.kind !== 'inspect' && view.kind !== 'withdraw')) return null;
  return handle.shipmentId === view.box.shipmentId && handle.seq === view.seq ? handle : null;
}

/** 큰 칸(왼쪽 380px − 여백 48px)에 한 줄로 들어가는 글자 크기 — 기본 120px, 고정폭 글자 하나 ≈ 0.6em 로 잰다 */
const BIG_TEXT_WIDTH_PX = 332;
const MONO_EM = 0.6;
export function bigTextPx(text: string): number {
  return Math.min(120, Math.floor(BIG_TEXT_WIDTH_PX / (Math.max(text.length, 1) * MONO_EM)));
}
