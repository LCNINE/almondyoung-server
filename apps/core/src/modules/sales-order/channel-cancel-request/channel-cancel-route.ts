export type ChannelCancelRoute = 'command' | 'seller_center' | 'core';

/**
 * core 가 `CancelChannelOrder` 를 보낼 수 있는 채널(스펙 §5.2, D10). channel-adapter 능력 벡터
 * (`channel-capabilities.ts` 의 `automatedCancellation`)의 core 쪽 사본이다 — 채널 어휘가 아니라 «명령을 보낼 수 있는가»
 * 목록. 한쪽을 켜면 다른 쪽도 켠다.
 */
const COMMAND_CHANNELS: ReadonlySet<string> = new Set(['medusa']);

/** 자동 취소가 안 되는 마켓. core 는 요청을 거절하고 그 채널의 취소는 수집으로만 받는다. */
const SELLER_CENTER_LABELS: Readonly<Record<string, string>> = { naver: '네이버', coupang: '쿠팡' };

export function channelCancelRoute(salesChannel: string): ChannelCancelRoute {
  if (COMMAND_CHANNELS.has(salesChannel)) return 'command';
  if (salesChannel in SELLER_CENTER_LABELS) return 'seller_center';
  return 'core';
}

export function sellerCenterMessage(salesChannel: string): string {
  return `${SELLER_CENTER_LABELS[salesChannel] ?? salesChannel} 판매자센터에서 취소해 주세요.`;
}
