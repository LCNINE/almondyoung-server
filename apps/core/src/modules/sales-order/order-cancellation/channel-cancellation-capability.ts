// #1123 이 끝나면 이 파일을 지운다.
import { inventoryTables } from '../../inventory/schema/inventory.schema';

export type SalesChannelName = (typeof inventoryTables.salesOrders.$inferSelect)['salesChannel'];

/**
 * 채널 취소 능력 표 (K7 PR1, 스펙 §5.8).
 *
 * 채널 어휘가 아니라 «명령을 보낼 수 있는가» 같은 능력으로 판정한다. 호출자는 채널 이름을 비교하지 않고
 * 이 표에서 능력을 읽는다. 표는 `Record<SalesChannelName, …>` 라 enum 에 값이 늘면 tsc 가 빨갛게 한다.
 * 표에 없는 문자열은 `core` 로 떨어지지 않고 던진다(D8) — 모르는 채널을 조용히 core 주문으로 다루지 않는다.
 *
 * `cancel === 'command'` 는 channel-adapter 능력 벡터(`channel-capabilities.ts` 의 `automatedCancellation`)의
 * core 쪽 사본이다. 한쪽을 켜면 다른 쪽도 켠다 — parity spec 이 지킨다.
 */
export interface ChannelCancellationCapability {
  /** command: `CancelChannelOrder` 를 보낼 수 있다 · seller_center: 판매자센터에서 취소 · core: core 가 직접 */
  cancel: 'command' | 'seller_center' | 'core';
  /** 환불·정산을 누가 하는가 */
  settlesMoney: 'channel' | 'core';
  /** 이미 환불한 금액 상계를 받는가(ADR-0043 — Medusa 부분취소만) */
  acceptsAlreadyRefundedOffset: boolean;
  /** 고객이 스토어프론트에서 직접 취소할 수 있는가 */
  customerSelfCancel: boolean;
  /** 결제가 wallet intent 로 이뤄지는가 */
  paidByWalletIntent: boolean;
  /** 판매자센터 안내 문구에 쓰는 이름 */
  sellerCenterLabel: string | null;
}

export const CHANNEL_CANCELLATION_CAPABILITIES: Readonly<Record<SalesChannelName, ChannelCancellationCapability>> = {
  medusa: {
    cancel: 'command',
    settlesMoney: 'channel',
    acceptsAlreadyRefundedOffset: true,
    customerSelfCancel: true,
    paidByWalletIntent: true,
    sellerCenterLabel: null,
  },
  naver: {
    cancel: 'seller_center',
    settlesMoney: 'channel',
    acceptsAlreadyRefundedOffset: false,
    customerSelfCancel: false,
    paidByWalletIntent: false,
    sellerCenterLabel: '네이버',
  },
  coupang: {
    cancel: 'seller_center',
    settlesMoney: 'channel',
    acceptsAlreadyRefundedOffset: false,
    customerSelfCancel: false,
    paidByWalletIntent: false,
    sellerCenterLabel: '쿠팡',
  },
  '3pl': {
    cancel: 'core',
    settlesMoney: 'core',
    acceptsAlreadyRefundedOffset: false,
    customerSelfCancel: false,
    paidByWalletIntent: false,
    sellerCenterLabel: null,
  },
};

export function cancellationCapabilityOf(salesChannel: string): ChannelCancellationCapability {
  if (!Object.hasOwn(CHANNEL_CANCELLATION_CAPABILITIES, salesChannel)) {
    throw new Error(`Unknown sales channel for cancellation: ${salesChannel}`);
  }
  return CHANNEL_CANCELLATION_CAPABILITIES[salesChannel as SalesChannelName];
}

export function channelsWhere(pred: (c: ChannelCancellationCapability) => boolean): SalesChannelName[] {
  return (Object.keys(CHANNEL_CANCELLATION_CAPABILITIES) as SalesChannelName[]).filter((ch) =>
    pred(CHANNEL_CANCELLATION_CAPABILITIES[ch]),
  );
}

export function sellerCenterMessage(salesChannel: string): string {
  const label = cancellationCapabilityOf(salesChannel).sellerCenterLabel;
  return `${label ?? salesChannel} 판매자센터에서 취소해 주세요.`;
}
