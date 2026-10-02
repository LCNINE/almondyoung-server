/** 출고 검수(F1) 화면이 주고받는 상태 — 부모(InspectionScreen)와 박스별 자식(InspectWork·WithdrawWork)이 같이 쓴다 */

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
