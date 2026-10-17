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
