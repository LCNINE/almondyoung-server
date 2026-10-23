export interface RefundDecisionRow {
  isFirstOfOrder: boolean;
  orderStatus: string;
  refundStatus?: string;
  refundAwaitingDecision?: boolean;
  refundLinkId?: string;
  walletIntentId?: string | null;
}

export interface RefundDecisionActions {
  /** «환불 실행» (wallet 환불 재시도 경로) */
  execute: boolean;
  /** «환불 안 함» — 링크 id 가 있는 결정 대기 건만 */
  waive: boolean;
}

const NONE: RefundDecisionActions = { execute: false, waive: false };

/** 결정 대기 행에 어떤 버튼이 뜨는가. 권한은 호출부(canRun)가 따로 건다. */
export function refundDecisionActionsOf(row: RefundDecisionRow): RefundDecisionActions {
  if (!row.isFirstOfOrder || !row.refundAwaitingDecision) return NONE;
  // 상자 후 취소가 대기로 끝나 주문이 아직 살아 있으면 재시도가 400 이다 — 취소가 끝나야 실행한다
  if (row.refundStatus === 'requested') return { execute: row.orderStatus === 'cancelled', waive: false };
  if (row.refundStatus === 'manual_pending') {
    return {
      execute: row.orderStatus === 'cancelled' && !!row.walletIntentId,
      waive: !!row.refundLinkId,
    };
  }
  return NONE;
}
