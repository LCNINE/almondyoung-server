export const PRINT_REFUND_RESTRICTED_NOTE =
  '와우프레스로 제작이 접수된 주문제작 상품이 있어 환불·결제취소가 제한됩니다.';
export const PRINT_DEFECT_OVERRIDE_LABEL =
  '인쇄 불량 등 상품 하자로 인한 환불입니다';

/**
 * 결제 상세의 환불(부분·전액)·결제취소를 막는가. 제작이 접수된 인쇄 줄이 있으면 상품 하자 체크가 있어야만 연다.
 * 인쇄 상태를 아직 모르면(조회 중·실패) 막는다.
 */
export const isPrintRefundBlocked = (
  hasActivePrint: boolean | undefined,
  defectConfirmed: boolean
): boolean => hasActivePrint !== false && !defectConfirmed;
