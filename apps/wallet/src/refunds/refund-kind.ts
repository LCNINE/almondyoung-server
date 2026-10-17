import { RefundKind, refundKindEnum } from '../schema';

/** 화면 이름. 값(철자)은 `refund_kind` enum 이 정본이고 여기는 그 라벨이다. */
export const REFUND_KIND_LABELS: Record<RefundKind, string> = {
  ITEM_CANCEL: '품목 취소',
  RETURN: '반품',
  PRICE_ADJUSTMENT: '금액 조정',
  SUBSCRIPTION_FEE: '구독료 환불',
  PAYMENT_ERROR: '결제 오류',
};

export function isRefundKind(v: unknown): v is RefundKind {
  return typeof v === 'string' && (refundKindEnum.enumValues as readonly string[]).includes(v);
}

/**
 * PG 취소 사유. 종류가 있으면 그 이름만 보낸다 — 관리자 자유 문구와 `MEDUSA_REFUND` 같은 내부 코드가
 * PG 가맹점 콘솔에 새지 않게, 그리고 응답 끊긴 환불을 같은 행·같은 멱등 키로 다시 보낼 때 사유가 같도록
 * (메모 `reason_message` 는 디스패치 실패 때 PG 오류로 덮이므로 넣지 않는다). 종류가 없으면 예전 그대로다.
 */
export function pgCancelReason(refund: { kind: RefundKind | null; reasonCode: string | null }): string | undefined {
  return refund.kind ? REFUND_KIND_LABELS[refund.kind] : (refund.reasonCode ?? undefined);
}
