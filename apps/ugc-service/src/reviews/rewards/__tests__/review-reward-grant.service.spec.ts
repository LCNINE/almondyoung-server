import { ReviewRewardGrantService } from '../review-reward-grant.service';
import { EvaluableRule } from '../reward-rule.evaluator';
import { DEFAULT_REWARD_CONDITIONS, DEFAULT_REWARD_LIMITS, ReviewRewardSpec } from '../reward-rule.types';

type InsertedRow = Record<string, unknown>;

/**
 * 트랜잭션 mock — insert 로 들어온 값만 모은다. 판정 자체는 evaluator 스펙이 검증하므로
 * 여기서는 「어떤 행이 원장에 남고 무엇이 발행 대상으로 나가는가」만 본다.
 */
function makeTx(inserted: InsertedRow[], counts: { userReviews?: number; usage?: { count: number; amount: number } } = {}) {
  const usage = counts.usage ?? { count: 0, amount: 0 };

  return {
    insert: () => ({
      values: (values: InsertedRow) => {
        inserted.push(values);
        return {
          returning: () => Promise.resolve([{ id: 'grant-1' }]),
        };
      },
    }),
    select: (columns?: Record<string, unknown>) => ({
      from: () => ({
        where: () => {
          if (columns && 'amount' in columns) {
            return Promise.resolve([{ count: usage.count, amount: usage.amount }]);
          }
          return Promise.resolve([{ value: counts.userReviews ?? 1 }]);
        },
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([{ grantId: 'grant-1', userId: 'user-1', amount: 500 }]),
        }),
      }),
    }),
  } as never;
}

function rule(reward: ReviewRewardSpec, overrides: Partial<EvaluableRule> = {}): EvaluableRule & { name: string } {
  return {
    id: 'rule-1',
    name: '규칙',
    priority: 0,
    stopOnMatch: true,
    conditions: { ...DEFAULT_REWARD_CONDITIONS },
    reward,
    limits: { ...DEFAULT_REWARD_LIMITS },
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeService(rules: Array<EvaluableRule & { name: string }>) {
  const ruleService = { getActiveRules: jest.fn().mockResolvedValue(rules) };
  return new ReviewRewardGrantService({} as never, ruleService as never);
}

const input = {
  reviewId: '11111111-1111-4111-8111-111111111111',
  userId: 'user-1',
  contentLength: 50,
  mediaCount: 1,
  rating: 5,
  orderLineAmount: 20000,
};

describe('ReviewRewardGrantService.evaluateForNewReview', () => {
  it('활성 규칙이 없으면 원장에 아무것도 쓰지 않는다 — 무보상이 기본 상태다', async () => {
    const inserted: InsertedRow[] = [];
    const service = makeService([]);

    const result = await service.evaluateForNewReview(input, makeTx(inserted));

    expect(result).toBeNull();
    expect(inserted).toHaveLength(0);
  });

  it('지급되면 원장에 GRANTED 를 남기고 발행할 내용을 돌려준다', async () => {
    const inserted: InsertedRow[] = [];
    const service = makeService([rule({ kind: 'POINT_FIXED', amount: 500, expiresInDays: 30 })]);

    const result = await service.evaluateForNewReview(input, makeTx(inserted));

    expect(inserted[0]).toMatchObject({ status: 'GRANTED', amount: 500, rewardKind: 'POINT_FIXED' });
    expect(result).toMatchObject({ grantId: 'grant-1', amount: 500, reviewType: 'PHOTO' });
    expect(result?.expiresAt).toBeInstanceOf(Date);
  });

  it('미지급이면 사유와 함께 SKIPPED 를 남기고 발행하지 않는다', async () => {
    const inserted: InsertedRow[] = [];
    const service = makeService([
      rule({ kind: 'POINT_RATE', ratePercent: 5, minAmount: null, maxAmount: null, expiresInDays: null }),
    ]);

    const result = await service.evaluateForNewReview({ ...input, orderLineAmount: null }, makeTx(inserted));

    expect(result).toBeNull();
    expect(inserted[0]).toMatchObject({ status: 'SKIPPED', skipReason: 'ORDER_AMOUNT_UNKNOWN', amount: 0 });
  });

  it('비금전 보상은 원장에만 남고 지갑으로 나가지 않는다', async () => {
    const inserted: InsertedRow[] = [];
    const service = makeService([rule({ kind: 'BADGE' })]);

    const result = await service.evaluateForNewReview(input, makeTx(inserted));

    expect(result).toBeNull();
    expect(inserted[0]).toMatchObject({ status: 'GRANTED', rewardKind: 'BADGE', amount: 0 });
  });

  it('1인당 한도를 넘으면 사유를 남기고 막는다', async () => {
    const inserted: InsertedRow[] = [];
    const service = makeService([
      rule(
        { kind: 'POINT_FIXED', amount: 500, expiresInDays: null },
        { limits: { perUser: { period: 'MONTH', maxCount: 2, maxAmount: null }, global: null } },
      ),
    ]);

    const result = await service.evaluateForNewReview(input, makeTx(inserted, { usage: { count: 2, amount: 1000 } }));

    expect(result).toBeNull();
    expect(inserted[0]).toMatchObject({ status: 'SKIPPED', skipReason: 'PER_USER_LIMIT' });
  });
});

describe('ReviewRewardGrantService.revokeForReview', () => {
  it('회수 대상 중 금액이 있는 건만 취소 명령 대상으로 돌려준다', async () => {
    const service = makeService([]);

    const revoked = await service.revokeForReview(input.reviewId, 'REVIEW_DELETED', makeTx([]));

    expect(revoked).toEqual([{ grantId: 'grant-1', userId: 'user-1', amount: 500 }]);
  });
});
