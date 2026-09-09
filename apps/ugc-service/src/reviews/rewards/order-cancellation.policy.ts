/**
 * 주문 취소가 리뷰 자격·적립에 무엇을 하는지 정하는 순수 판정.
 *
 * 판정을 여기 모아 두는 이유는 두 가지다 — 취소 사유별로 1인당 한도를 돌려줄지가
 * 갈리고(§13-2), 부분취소는 지금 라인을 매칭할 수단이 없어 «아무것도 하지 않음»이
 * 정답인데 그 둘을 컨슈머 안에 두면 스펙으로 못박을 수 없다.
 */

export type SalesOrderCancelReason = 'CUSTOMER_REQUEST' | 'OUT_OF_STOCK' | 'PAYMENT_FAILED' | 'ADMIN_CANCEL' | 'TIMEOUT';

export type OrderRevokeReason = 'ORDER_CANCELLED' | 'ORDER_CANCELLED_NOT_USER_FAULT';

/** 고객 귀책이 아닌 취소. 1인당 한도를 돌려준다 — 기회를 쓴 것이 고객 탓이 아니다. */
const NOT_USER_FAULT_REASONS: readonly SalesOrderCancelReason[] = ['OUT_OF_STOCK', 'PAYMENT_FAILED', 'TIMEOUT'];

export const resolveRevokeReason = (reason: SalesOrderCancelReason): OrderRevokeReason =>
  NOT_USER_FAULT_REASONS.includes(reason) ? 'ORDER_CANCELLED_NOT_USER_FAULT' : 'ORDER_CANCELLED';

export type CancellationSkipReason = 'NO_CHANNEL_ORDER_ID' | 'PARTIAL_NOT_LINE_MAPPABLE';

export type CancellationPlan =
  | { action: 'REVOKE_ORDER'; channelOrderId: string; revokeReason: OrderRevokeReason }
  | { action: 'SKIP'; skipReason: CancellationSkipReason };

export interface CancellationInput {
  channelOrderId?: string;
  cancellationScope: 'full' | 'partial';
  reason: SalesOrderCancelReason;
}

/**
 * 자격은 Medusa 라인 id 로 키가 걸려 있고, 주문 축은 `channelOrderId` 다.
 * 부분취소 페이로드의 `salesOrderLineId` 는 core PK 라 그 축이 아니다 —
 * 전량 회수로 뭉개면 취소되지 않은 라인의 자격까지 죽으므로 건드리지 않는다.
 */
export const planCancellation = (input: CancellationInput): CancellationPlan => {
  if (!input.channelOrderId) {
    return { action: 'SKIP', skipReason: 'NO_CHANNEL_ORDER_ID' };
  }
  if (input.cancellationScope !== 'full') {
    return { action: 'SKIP', skipReason: 'PARTIAL_NOT_LINE_MAPPABLE' };
  }
  return {
    action: 'REVOKE_ORDER',
    channelOrderId: input.channelOrderId,
    revokeReason: resolveRevokeReason(input.reason),
  };
};
