import { planCancellation, resolveRevokeReason } from '../order-cancellation.policy';

describe('resolveRevokeReason', () => {
  it.each(['CUSTOMER_REQUEST', 'ADMIN_CANCEL'] as const)('%s 는 고객이 기회를 쓴 것으로 본다', (reason) => {
    expect(resolveRevokeReason(reason)).toBe('ORDER_CANCELLED');
  });

  it.each(['OUT_OF_STOCK', 'PAYMENT_FAILED', 'TIMEOUT'] as const)('%s 는 고객 귀책이 아니다', (reason) => {
    expect(resolveRevokeReason(reason)).toBe('ORDER_CANCELLED_NOT_USER_FAULT');
  });
});

describe('planCancellation', () => {
  it('전체취소는 그 주문의 자격을 회수한다', () => {
    expect(
      planCancellation({ channelOrderId: 'order_01', cancellationScope: 'full', reason: 'CUSTOMER_REQUEST' }),
    ).toEqual({ action: 'REVOKE_ORDER', channelOrderId: 'order_01', revokeReason: 'ORDER_CANCELLED' });
  });

  it('부분취소는 라인을 매칭할 축이 없어 건드리지 않는다 — 전량 회수로 뭉개지 않는다', () => {
    expect(
      planCancellation({ channelOrderId: 'order_01', cancellationScope: 'partial', reason: 'CUSTOMER_REQUEST' }),
    ).toEqual({ action: 'SKIP', skipReason: 'PARTIAL_NOT_LINE_MAPPABLE' });
  });

  it('channelOrderId 가 없으면 어느 주문인지 모르므로 건드리지 않는다', () => {
    expect(planCancellation({ cancellationScope: 'full', reason: 'ADMIN_CANCEL' })).toEqual({
      action: 'SKIP',
      skipReason: 'NO_CHANNEL_ORDER_ID',
    });
  });
});
