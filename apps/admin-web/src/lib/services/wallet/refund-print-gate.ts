export const PRINT_REFUND_RESTRICTED_NOTE =
  '이 주문에는 아몬드템플릿 인쇄 상품이 있어 금액 직접 환불·결제취소가 막혀 있습니다.';
export const PRINT_PARTIAL_CANCEL_GUIDE =
  '실물 상품만 환불하려면 주문내역 > 주문 취소 > 부분 취소에서 상품을 골라 주세요. 인쇄는 그대로 두고 고른 상품만 환불됩니다.';
export const PRINT_DEFECT_OVERRIDE_LABEL =
  '인쇄물 하자로 재제작이 불가하거나 배송 사고로 인한 환불입니다 (하자는 재제작이 원칙)';

// 막혔을 때 그 주문의 부분 취소로 보내는 주문내역 링크
export const partialCancelHref = (channelOrderId: string | null | undefined): string =>
  channelOrderId ? `/order/history?orderNo=${encodeURIComponent(channelOrderId)}` : '/order/history';

export const PRINT_UNCOLLECTED_NOTE =
  '주문이 아직 수집되지 않아 아몬드템플릿 인쇄 상품이 있는지 확인할 수 없습니다. 몇 분 뒤 새로고침해 주세요.';
export const PRINT_STATUS_UNKNOWN_NOTE = '인쇄 주문 상태를 확인하지 못해 환불·결제취소를 막았습니다. 새로고침해 주세요.';

export type PrintRefundGate = 'open' | 'print' | 'uncollected' | 'unknown';

/**
 * 결제 상세의 환불(부분·전액)·결제취소를 열어도 되는가.
 * - 인쇄 상태를 모르면(조회 중·실패) 막는다.
 * - 취소되지 않은 인쇄 줄이 있으면 상품 하자 체크가 있어야만 연다.
 * - Medusa 주문인데 core 가 아직 수집하지 않았으면 인쇄 여부를 모르므로, 받은 돈을 돌려주는 동작은 막는다.
 *   수집 전에 환불하면 그 뒤 수집된 주문의 인쇄가 그대로 발주된다. 입금 전 거절처럼 돈이 안 오간 취소는 연다.
 */
export function printRefundGate(
  status: { hasActivePrint: boolean; channelOrderId: string | null } | undefined,
  opts: { medusaOrder: boolean; moneyCaptured: boolean; defectConfirmed: boolean }
): PrintRefundGate {
  if (!status) return 'unknown';
  if (status.hasActivePrint) return opts.defectConfirmed ? 'open' : 'print';
  if (opts.medusaOrder && opts.moneyCaptured && status.channelOrderId === null) return 'uncollected';
  return 'open';
}

export const printRefundGateMessage = (gate: PrintRefundGate): string =>
  gate === 'print'
    ? PRINT_REFUND_RESTRICTED_NOTE
    : gate === 'uncollected'
      ? PRINT_UNCOLLECTED_NOTE
      : PRINT_STATUS_UNKNOWN_NOTE;
