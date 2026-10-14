export const PRINT_REFUND_RESTRICTED_NOTE =
  '이 주문에는 아몬드템플릿 인쇄 상품이 있어 금액 직접 환불·결제취소가 막혀 있습니다.';
export const PRINT_PARTIAL_CANCEL_GUIDE =
  '실물 상품만 환불하려면 주문내역 > 주문 취소 > 부분 취소에서 상품을 골라 주세요. 인쇄는 그대로 두고 고른 상품만 환불됩니다.';
export const PRINT_DEFECT_OVERRIDE_LABEL =
  '인쇄물 하자로 재제작이 불가하거나 배송 사고로 인한 환불입니다 (하자는 재제작이 원칙)';

// 막혔을 때 그 주문의 부분 취소로 보내는 주문내역 링크
export const partialCancelHref = (channelOrderId: string | null | undefined): string =>
  channelOrderId ? `/order/history?orderNo=${encodeURIComponent(channelOrderId)}` : '/order/history';

/**
 * 결제 상세의 환불(부분·전액)·결제취소를 막는가. 제작이 접수된 인쇄 줄이 있으면 상품 하자 체크가 있어야만 연다.
 * 인쇄 상태를 아직 모르면(조회 중·실패) 막는다.
 */
export const isPrintRefundBlocked = (
  hasActivePrint: boolean | undefined,
  defectConfirmed: boolean
): boolean => hasActivePrint !== false && !defectConfirmed;
