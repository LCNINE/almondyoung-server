import { planReturn, resolveReturnRevokeReason } from '../order-return.policy';

const line = (over: Partial<Parameters<typeof planReturn>[0]['returnedLines'][number]> = {}) => ({
  salesOrderLineId: 'sol-1',
  channelOrderItemId: 'item_01',
  orderedQuantity: 2,
  returnedQuantity: 2,
  ...over,
});

describe('resolveReturnRevokeReason', () => {
  it.each(['defective', 'not_as_described', 'wrong_item', 'damaged_in_shipping'] as const)(
    '%s 는 판매자 귀책이라 1인당 한도를 돌려준다',
    (reason) => {
      expect(resolveReturnRevokeReason(reason)).toBe('ORDER_RETURNED_NOT_USER_FAULT');
    },
  );

  it.each(['change_of_mind', 'other'] as const)('%s 는 고객이 기회를 쓴 것으로 본다', (reason) => {
    expect(resolveReturnRevokeReason(reason)).toBe('ORDER_RETURNED');
  });
});

describe('planReturn', () => {
  it('전량 반품된 라인만 회수 대상이 된다', () => {
    expect(planReturn({ channelOrderId: 'order_01', reason: 'change_of_mind', returnedLines: [line()] })).toEqual({
      action: 'REVOKE_LINES',
      channelOrderId: 'order_01',
      revokeReason: 'ORDER_RETURNED',
      orderLineIds: ['item_01'],
      skippedLines: [],
    });
  });

  it('수량 일부만 반품한 라인은 회수하지 않고 사유로 «센다» — 고객은 그 상품을 아직 갖고 있다', () => {
    expect(
      planReturn({
        channelOrderId: 'order_01',
        reason: 'change_of_mind',
        returnedLines: [line({ salesOrderLineId: 'sol-partial', returnedQuantity: 1 })],
      }),
    ).toEqual({
      action: 'SKIP',
      skipReason: 'NO_REVOCABLE_LINES',
      skippedLines: [{ salesOrderLineId: 'sol-partial', skipReason: 'PARTIAL_QUANTITY' }],
    });
  });

  it('나눠 반품해 누적이 주문 수량에 도달하면 그때 회수된다', () => {
    const plan = planReturn({
      channelOrderId: 'order_01',
      reason: 'change_of_mind',
      returnedLines: [line({ orderedQuantity: 3, returnedQuantity: 3 })],
    });
    expect(plan).toMatchObject({ action: 'REVOKE_LINES', orderLineIds: ['item_01'] });
  });

  it('회수 대상 라인과 제외 라인이 섞이면 대상만 회수하고 제외는 사유와 함께 남는다', () => {
    expect(
      planReturn({
        channelOrderId: 'order_01',
        reason: 'defective',
        returnedLines: [
          line({ salesOrderLineId: 'sol-full', channelOrderItemId: 'item_full' }),
          line({ salesOrderLineId: 'sol-partial', channelOrderItemId: 'item_partial', returnedQuantity: 1 }),
          line({ salesOrderLineId: 'sol-unmapped', channelOrderItemId: undefined }),
        ],
      }),
    ).toEqual({
      action: 'REVOKE_LINES',
      channelOrderId: 'order_01',
      revokeReason: 'ORDER_RETURNED_NOT_USER_FAULT',
      orderLineIds: ['item_full'],
      skippedLines: [
        { salesOrderLineId: 'sol-partial', skipReason: 'PARTIAL_QUANTITY' },
        { salesOrderLineId: 'sol-unmapped', skipReason: 'NO_CHANNEL_ORDER_ITEM_ID' },
      ],
    });
  });

  it('channelOrderItemId 가 없는 라인은 자격을 찾을 축이 없어 회수하지 않는다', () => {
    expect(
      planReturn({
        channelOrderId: 'order_01',
        reason: 'change_of_mind',
        returnedLines: [line({ channelOrderItemId: undefined })],
      }),
    ).toEqual({
      action: 'SKIP',
      skipReason: 'NO_REVOCABLE_LINES',
      skippedLines: [{ salesOrderLineId: 'sol-1', skipReason: 'NO_CHANNEL_ORDER_ITEM_ID' }],
    });
  });

  it('channelOrderId 가 없으면 어느 주문인지 모르므로 건드리지 않는다', () => {
    expect(planReturn({ reason: 'change_of_mind', returnedLines: [line()] })).toEqual({
      action: 'SKIP',
      skipReason: 'NO_CHANNEL_ORDER_ID',
      skippedLines: [],
    });
  });
});
