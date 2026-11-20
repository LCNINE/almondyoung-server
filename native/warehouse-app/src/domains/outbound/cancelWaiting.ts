import type { ShipmentByWaybill } from './types';

export interface CancelWaitingLine {
  name: string;
  /** 지금 박스 수량 */
  from: number;
  /** 취소가 끝난 뒤 수량 */
  to: number;
}

export interface CancelWaiting {
  /** 취소로 줄어드는 줄 */
  lines: CancelWaitingLine[];
  /** 모든 줄이 0 이 된다 — 주문 전체 취소 */
  whole: boolean;
}

export const CANCEL_WAITING_SCAN_MESSAGE =
  '취소를 기다리는 박스라 상품을 받지 않아요. F11 로 박스를 빼 주세요.';

/** 취소를 기다리는 박스면 줄마다 «지금 → 취소 뒤» 수량, 아니면 null. 취소 사유를 싣지 않는 core 도 null */
export function cancelWaitingOf(box: ShipmentByWaybill): CancelWaiting | null {
  if (box.recoveryCode !== 'CANCEL_REPLAN_PENDING') return null;
  const canceled = box.pendingCancellation ?? [];
  const canceledOf = (lineId: string) =>
    canceled
      .filter((c) => c.shipmentLineId === lineId)
      .reduce((sum, c) => sum + c.qty, 0);
  const lines = canceled.flatMap((pending) => {
    const line = box.lines.find(
      (l) => l.shipmentLineId === pending.shipmentLineId
    );
    return line
      ? [
          {
            name: line.skuName,
            from: line.qty,
            to: Math.max(0, line.qty - pending.qty),
          },
        ]
      : [];
  });
  const whole =
    canceled.length > 0 &&
    box.lines.every((line) => canceledOf(line.shipmentLineId) >= line.qty);
  return { lines, whole };
}
