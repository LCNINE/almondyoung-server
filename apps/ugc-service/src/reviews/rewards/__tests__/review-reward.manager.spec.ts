import { ReviewRewardManager } from '../review-reward.manager';
import { OrderEligibilityRow } from '../../../review-permissions/types';
import { RevokedGrant } from '../review-reward-grant.service';

/**
 * 회수 트랜잭션의 «형태»만 본다 — 무엇이 무효화되고, 무엇이 wallet 취소 명령으로 나가고,
 * 재전달에 무엇이 «다시» 나가지 않는가. 판정 자체는 policy 스펙이 본다.
 */
function makeHarness(options: {
  eligibilities: OrderEligibilityRow[];
  /** 자격 update 가 실제로 갱신한 행 (이미 회수된 건은 여기 없다) */
  invalidated: Array<{ id: string; consumedByReviewId: string | null }>;
  revoked: RevokedGrant[];
}) {
  const cancelCommands: Array<{ grantId: string; reviewId: string; reasonCode: string }> = [];
  const revokeCalls: Array<{ reviewIds: string[]; reason: string }> = [];
  const eligibilityRevokes: Array<{ ids: string[]; reason: string }> = [];

  const tx = {} as never;

  const db = { run: (fn: (trx: unknown) => Promise<unknown>) => fn(tx) };
  // 자격 표는 권한 모듈이 소유한다 — manager 는 회수를 «부탁»하고 결과를 받는다.
  const permissionService = {
    findLiveByOrderId: jest.fn().mockResolvedValue(options.eligibilities),
    findLiveByOrderLineIds: jest.fn().mockResolvedValue(options.eligibilities),
    revoke: jest.fn(async (ids: string[], reason: string) => {
      eligibilityRevokes.push({ ids, reason });
      return options.invalidated;
    }),
  };
  const grantService = {
    revokeForReviews: jest.fn(async (reviewIds: string[], reason: string) => {
      revokeCalls.push({ reviewIds, reason });
      return reviewIds.length === 0 ? [] : options.revoked;
    }),
  };
  const publisher = {
    enqueueCancelPointsCommand: jest.fn(async (params: { grantId: string; reviewId: string; reasonCode: string }) => {
      cancelCommands.push(params);
    }),
  };

  const manager = new ReviewRewardManager(
    db as never,
    permissionService as never,
    grantService as never,
    publisher as never,
  );

  return { manager, cancelCommands, revokeCalls, eligibilityRevokes, permissionService };
}

const fullCancel = {
  channelOrderId: 'order_01',
  cancellationScope: 'full' as const,
  reason: 'CUSTOMER_REQUEST' as const,
};

describe('ReviewRewardManager.revokeForCancelledOrder', () => {
  it('취소된 주문의 미소비 자격을 무효화하고, 소비된 자격의 지급은 회수한다', async () => {
    const harness = makeHarness({
      eligibilities: [
        { id: 'elig-1', userId: 'user-1', orderLineId: 'line-1', consumedByReviewId: null },
        { id: 'elig-2', userId: 'user-1', orderLineId: 'line-2', consumedByReviewId: 'review-1' },
      ],
      invalidated: [
        { id: 'elig-1', consumedByReviewId: null },
        { id: 'elig-2', consumedByReviewId: 'review-1' },
      ],
      revoked: [{ grantId: 'grant-1', reviewId: 'review-1', userId: 'user-1', amount: 500 }],
    });

    const result = await harness.manager.revokeForCancelledOrder(fullCancel);

    expect(result).toEqual({ skipped: null, invalidatedEligibilities: 1, revokedGrants: 1 });
    expect(harness.eligibilityRevokes[0]).toMatchObject({ reason: 'ORDER_CANCELLED' });
    expect(harness.revokeCalls).toEqual([{ reviewIds: ['review-1'], reason: 'ORDER_CANCELLED' }]);
    expect(harness.cancelCommands).toEqual([
      {
        grantId: 'grant-1',
        reviewId: 'review-1',
        userId: 'user-1',
        reasonCode: 'review-reward-cancel:order_cancelled',
      },
    ]);
  });

  it('재전달되면 추가 회수가 0건이다 — 이미 회수된 자격은 조회에서 빠진다', async () => {
    const harness = makeHarness({ eligibilities: [], invalidated: [], revoked: [] });

    const result = await harness.manager.revokeForCancelledOrder(fullCancel);

    expect(result).toEqual({ skipped: null, invalidatedEligibilities: 0, revokedGrants: 0 });
    expect(harness.cancelCommands).toEqual([]);
  });

  it('부분취소는 조회조차 하지 않는다 — 취소되지 않은 라인의 자격을 죽이지 않는다', async () => {
    const harness = makeHarness({ eligibilities: [], invalidated: [], revoked: [] });

    const result = await harness.manager.revokeForCancelledOrder({ ...fullCancel, cancellationScope: 'partial' });

    expect(result.skipped).toBe('PARTIAL_NOT_LINE_MAPPABLE');
    expect(harness.permissionService.findLiveByOrderId).not.toHaveBeenCalled();
  });

  it('품절 취소는 고객 귀책이 아닌 사유로 회수한다 — 1인당 한도가 돌아온다', async () => {
    const harness = makeHarness({
      eligibilities: [{ id: 'elig-1', userId: 'user-1', orderLineId: 'line-1', consumedByReviewId: 'review-1' }],
      invalidated: [{ id: 'elig-1', consumedByReviewId: 'review-1' }],
      revoked: [{ grantId: 'grant-1', reviewId: 'review-1', userId: 'user-1', amount: 500 }],
    });

    await harness.manager.revokeForCancelledOrder({ ...fullCancel, reason: 'OUT_OF_STOCK' });

    expect(harness.revokeCalls[0].reason).toBe('ORDER_CANCELLED_NOT_USER_FAULT');
    expect(harness.eligibilityRevokes[0]).toMatchObject({ reason: 'ORDER_CANCELLED_NOT_USER_FAULT' });
  });
});

const fullReturn = {
  channelOrderId: 'order_01',
  reason: 'change_of_mind' as const,
  returnedLines: [
    { salesOrderLineId: 'sol-1', channelOrderItemId: 'line-1', orderedQuantity: 1, returnedQuantity: 1 },
  ],
};

describe('ReviewRewardManager.revokeForReturnedOrder', () => {
  it('전량 반품된 라인의 자격을 무효화하고, 소비된 자격의 지급은 회수한다', async () => {
    const harness = makeHarness({
      eligibilities: [{ id: 'elig-1', userId: 'user-1', orderLineId: 'line-1', consumedByReviewId: 'review-1' }],
      invalidated: [{ id: 'elig-1', consumedByReviewId: 'review-1' }],
      revoked: [{ grantId: 'grant-1', reviewId: 'review-1', userId: 'user-1', amount: 300 }],
    });

    const result = await harness.manager.revokeForReturnedOrder(fullReturn);

    expect(result).toEqual({ skipped: null, invalidatedEligibilities: 0, revokedGrants: 1, skippedLines: [] });
    expect(harness.eligibilityRevokes[0]).toMatchObject({ reason: 'ORDER_RETURNED' });
    expect(harness.cancelCommands).toEqual([
      {
        grantId: 'grant-1',
        reviewId: 'review-1',
        userId: 'user-1',
        reasonCode: 'review-reward-cancel:order_returned',
      },
    ]);
  });

  it('반품하지 않은 라인은 조회 대상에서 빠진다 — 주문 전체를 회수하지 않는다', async () => {
    const harness = makeHarness({ eligibilities: [], invalidated: [], revoked: [] });

    await harness.manager.revokeForReturnedOrder({
      ...fullReturn,
      returnedLines: [
        { salesOrderLineId: 'sol-1', channelOrderItemId: 'line-1', orderedQuantity: 1, returnedQuantity: 1 },
        { salesOrderLineId: 'sol-2', channelOrderItemId: 'line-2', orderedQuantity: 2, returnedQuantity: 1 },
      ],
    });

    expect(harness.permissionService.findLiveByOrderLineIds).toHaveBeenCalledWith('order_01', ['line-1'], expect.anything());
  });

  it('회수할 라인이 하나도 없으면 조회조차 하지 않고, 제외 사유를 돌려준다', async () => {
    const harness = makeHarness({ eligibilities: [], invalidated: [], revoked: [] });

    const result = await harness.manager.revokeForReturnedOrder({
      ...fullReturn,
      returnedLines: [
        { salesOrderLineId: 'sol-1', channelOrderItemId: 'line-1', orderedQuantity: 3, returnedQuantity: 1 },
      ],
    });

    expect(result.skipped).toBe('NO_REVOCABLE_LINES');
    expect(result.skippedLines).toEqual([{ salesOrderLineId: 'sol-1', skipReason: 'PARTIAL_QUANTITY' }]);
    expect(harness.permissionService.findLiveByOrderLineIds).not.toHaveBeenCalled();
  });

  it('재전달되면 추가 회수가 0건이다 — 이미 회수된 자격은 조회에서 빠진다', async () => {
    const harness = makeHarness({ eligibilities: [], invalidated: [], revoked: [] });

    const result = await harness.manager.revokeForReturnedOrder(fullReturn);

    expect(result).toMatchObject({ skipped: null, invalidatedEligibilities: 0, revokedGrants: 0 });
    expect(harness.cancelCommands).toEqual([]);
  });

  it('불량품 반품은 고객 귀책이 아닌 사유로 회수한다 — 1인당 한도가 돌아온다', async () => {
    const harness = makeHarness({
      eligibilities: [{ id: 'elig-1', userId: 'user-1', orderLineId: 'line-1', consumedByReviewId: 'review-1' }],
      invalidated: [{ id: 'elig-1', consumedByReviewId: 'review-1' }],
      revoked: [{ grantId: 'grant-1', reviewId: 'review-1', userId: 'user-1', amount: 300 }],
    });

    await harness.manager.revokeForReturnedOrder({ ...fullReturn, reason: 'defective' });

    expect(harness.revokeCalls[0].reason).toBe('ORDER_RETURNED_NOT_USER_FAULT');
    expect(harness.cancelCommands[0].reasonCode).toBe('review-reward-cancel:order_returned_not_user_fault');
  });
});
