import type { ReceiptLineState } from './receiptState';

/** 취소할 수 없는 입고를 지금 어떻게 끝내는지까지 말한다. */
export function cancelBlockMessage(state: ReceiptLineState): string {
  switch (state.cancelBlockReason) {
    case 'CANCELED':
      return '이미 취소된 입고예요.';
    case 'ALREADY_PUTAWAY':
      return `이미 ${state.putawayFromOriginQty}개를 선반에 넣어 입고를 취소할 수 없어요. 나머지도 선반에 넣은 뒤 재고 조회에서 재고 조정으로 수량을 맞춰 주세요.`;
    case 'RETURN_EXISTS':
      return `이미 ${state.returnedQty}개를 회송한 입고라 취소할 수 없어요. 관리자에게 남은 수량도 회송해 달라고 해 주세요.`;
    case 'ORIGIN_STOCK_INCONSISTENT':
      return '입고 기록과 현재 재고가 맞지 않아요. 원위치 실물을 세어 보고 관리자에게 알려 주세요.';
    case 'NOT_TODAY':
      return '오늘 입고분만 취소할 수 있어요. 관리자에게 알려 주세요.';
    default:
      return '원입고 정보를 찾지 못했어요. 관리자에게 알려 주세요.';
  }
}
