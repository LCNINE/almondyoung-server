// 쇼핑몰 주문은 발송을 그 쇼핑몰의 품목 번호로 알린다. 번호가 없거나 상품 번호를 그대로 담은 줄은
// 어느 품목이 나갔는지 알릴 수 없어 상자를 확정하지 않는다. 출고 준비 목록도 같은 판정으로 사유를 보인다.
const TRUSTED_CHANNELS = new Set(['medusa', 'naver', 'coupang']);

export interface ExternalLineOrigin {
  salesChannel: string | null;
  channelOrderItemId: string | null;
  channelProductId: string | null;
  exchangeReturnLineId: string | null;
}

export function isUntrustedExternalLine(origin: ExternalLineOrigin): boolean {
  if (!origin.salesChannel || !TRUSTED_CHANNELS.has(origin.salesChannel)) {
    return false;
  }

  const itemId = origin.channelOrderItemId?.trim();
  const productId = origin.channelProductId?.trim();

  // 교환 줄은 쇼핑몰 품목 번호를 정산이 나중에 채운다 — 번호가 생기면 같은 검사를 받는다
  if (!itemId) {
    return origin.exchangeReturnLineId === null;
  }

  return Boolean(productId) && itemId === productId;
}
