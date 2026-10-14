import { type PrintOrderRow } from '../schema/print-order.schema';
import { CANCEL_CLAIM_STALE_MS } from './print-order-cancellation.manager';
import { PRINT_ORDER_STALE_MS } from './print-order-submit.manager';
import { isPreservedLastError } from './print-order.repository';
import { type PrintOrderListItem } from './print-order.reader';

// 보드의 판정 한 곳. 목록 플래그와 운영자 조치(재전송·취소 마무리)가 같은 함수를 쓴다

// 와우프레스로 제작이 접수됐을 수 있는 행. 주문권을 쓰지 않은 실패·미지원 행과 취소된 행만 아니다
export function isActivePrint(row: Pick<PrintOrderRow, 'status' | 'orderAttemptedAt'>): boolean {
  if (row.status === 'cancelled') return false;
  if (row.status === 'failed' || row.status === 'unsupported') return row.orderAttemptedAt !== null;
  return true;
}

// 취소되지 않은 인쇄 행. 아직 안 보낸 실패·미지원 행도 재전송되면 제작되므로 살아 있는 것으로 본다
export function isLivePrint(row: Pick<PrintOrderRow, 'status'>): boolean {
  return row.status !== 'cancelled';
}

export function retryBlocked(row: PrintOrderRow): boolean {
  return isPreservedLastError(row.lastError);
}

export function needsWowpressCheck(row: PrintOrderRow): boolean {
  return row.orderAttemptedAt !== null && row.vendorOrderNumber === null;
}

export function isStaleCancelling(row: PrintOrderRow, now: number): boolean {
  return row.status === 'cancelling' && now - row.updatedAt.getTime() > CANCEL_CLAIM_STALE_MS;
}

// 제출 워커가 아직 와우프레스 응답을 기다리고 있을 수 있다
export function orderMayBeInFlight(row: PrintOrderRow, now: number): boolean {
  return row.submittingAt !== null && now - row.submittingAt.getTime() < PRINT_ORDER_STALE_MS;
}

// refundNotOpened 는 reader 가 판매주문 줄의 남은 수량으로 구한 값이다(refundNotOpenedSql). 보호 기록이 있으면 운영자가 마무리한 행만 받는다
function cancelledButNotRefunded(row: PrintOrderRow, refundNotOpened: boolean): boolean {
  return (
    row.status === 'cancelled' &&
    refundNotOpened &&
    (row.cancelResolvedAt !== null || !isPreservedLastError(row.lastError))
  );
}

export function awaitsCancelResolution(row: PrintOrderRow, now: number, refundNotOpened: boolean): boolean {
  return (
    row.status === 'cancel_refused' || isStaleCancelling(row, now) || cancelledButNotRefunded(row, refundNotOpened)
  );
}

export function resolvable(row: PrintOrderRow, now: number, refundNotOpened: boolean): boolean {
  return awaitsCancelResolution(row, now, refundNotOpened) && !orderMayBeInFlight(row, now);
}

export interface PrintOrderFlags {
  retryBlocked: boolean;
  needsWowpressCheck: boolean;
  resolvable: boolean;
  salesCancelFailed: boolean;
}

export function boardFlags(item: PrintOrderListItem, now: number): PrintOrderFlags {
  return {
    retryBlocked: retryBlocked(item),
    needsWowpressCheck: needsWowpressCheck(item),
    resolvable: resolvable(item, now, item.salesCancelFailed),
    salesCancelFailed: item.salesCancelFailed,
  };
}

export type PrintOrderBoardItem = PrintOrderListItem & PrintOrderFlags;

export function toBoardItem(item: PrintOrderListItem, now: number): PrintOrderBoardItem {
  return { ...item, ...boardFlags(item, now) };
}
