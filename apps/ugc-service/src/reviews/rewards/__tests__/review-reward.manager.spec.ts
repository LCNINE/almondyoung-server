import { ReviewRewardManager } from '../review-reward.manager';
import { OrderEligibilityRow } from '../review-reward.reader';
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
  const eligibilityUpdates: Array<Record<string, unknown>> = [];

  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        eligibilityUpdates.push(values);
        return { where: () => ({ returning: () => Promise.resolve(options.invalidated) }) };
      },
    }),
  } as never;

  const db = { run: (fn: (trx: unknown) => Promise<unknown>) => fn(tx) };
  const reader = { findLiveEligibilitiesByOrderId: jest.fn().mockResolvedValue(options.eligibilities) };
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
    reader as never,
    grantService as never,
    publisher as never,
  );

  return { manager, cancelCommands, revokeCalls, eligibilityUpdates, reader };
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
    expect(harness.eligibilityUpdates[0]).toMatchObject({ revokeReason: 'ORDER_CANCELLED' });
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
    expect(harness.reader.findLiveEligibilitiesByOrderId).not.toHaveBeenCalled();
  });

  it('품절 취소는 고객 귀책이 아닌 사유로 회수한다 — 1인당 한도가 돌아온다', async () => {
    const harness = makeHarness({
      eligibilities: [{ id: 'elig-1', userId: 'user-1', orderLineId: 'line-1', consumedByReviewId: 'review-1' }],
      invalidated: [{ id: 'elig-1', consumedByReviewId: 'review-1' }],
      revoked: [{ grantId: 'grant-1', reviewId: 'review-1', userId: 'user-1', amount: 500 }],
    });

    await harness.manager.revokeForCancelledOrder({ ...fullCancel, reason: 'OUT_OF_STOCK' });

    expect(harness.revokeCalls[0].reason).toBe('ORDER_CANCELLED_NOT_USER_FAULT');
    expect(harness.eligibilityUpdates[0]).toMatchObject({ revokeReason: 'ORDER_CANCELLED_NOT_USER_FAULT' });
  });
});
