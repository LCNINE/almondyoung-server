import { drizzle } from 'drizzle-orm/postgres-js';
import { ReviewRewardGrantService } from '../review-reward-grant.service';
import { reviewRewardGrants } from '../../../db/schema';
import { EvaluableRule } from '../reward-rule.evaluator';
import { DEFAULT_REWARD_CONDITIONS, DEFAULT_REWARD_LIMITS, ReviewRewardSpec } from '../reward-rule.types';

type InsertedRow = Record<string, unknown>;

/**
 * 트랜잭션 mock — insert 로 들어온 값만 모은다. 판정 자체는 evaluator 스펙이 검증하므로
 * 여기서는 「어떤 행이 원장에 남고 무엇이 발행 대상으로 나가는가」만 본다.
 */
function makeTx(
  inserted: InsertedRow[],
  counts: {
    userReviews?: number;
    usage?: { count: number; amount: number };
    /** 한도 집계 쿼리의 where 조건을 «부른 순서대로» 받아 간다 (1인당 → 전체 예산). */
    usageWhere?: unknown[];
  } = {},
) {
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
        where: (condition: unknown) => {
          if (columns && 'amount' in columns) {
            counts.usageWhere?.push(condition);
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

/**
 * 두 한도는 목적이 달라 회수(REVOKED)를 다르게 센다 — 1인당은 «기회를 이미 썼다»로 보고,
 * 전체 예산은 «돈이 돌아왔다»로 본다. 집계 쿼리의 where 를 실제로 렌더해 못박는다.
 * (여기서 「둘 다 GRANTED 만」으로 되돌아가면 리뷰를 썼다 지우기만 해도 1인당 한도가 비워진다.)
 */
describe('한도 집계가 세는 지급 상태', () => {
  // 접속하지 않고 조건만 렌더한다 — 드라이버 자리는 비워 둔다.
  const db = drizzle({} as never);
  const renderParams = (condition: unknown) =>
    db
      .select()
      .from(reviewRewardGrants)
      .where(condition as never)
      .toSQL().params;

  const limitedRule = () =>
    rule({ kind: 'POINT_FIXED', amount: 500, expiresInDays: 30 }, {
      limits: {
        perUser: { period: 'MONTH', maxCount: 100, maxAmount: null },
        global: { period: 'MONTH', maxCount: 100, maxAmount: null },
      },
    });

  it('1인당 한도는 회수된 건도 센다', async () => {
    const usageWhere: unknown[] = [];
    const service = makeService([limitedRule()]);

    await service.evaluateForNewReview(input, makeTx([], { usageWhere }));

    expect(renderParams(usageWhere[0])).toEqual(expect.arrayContaining(['GRANTED', 'REVOKED']));
  });

  it('1인당 한도는 판매자 귀책 취소로 회수된 건은 빼고 센다', async () => {
    const usageWhere: unknown[] = [];
    const service = makeService([limitedRule()]);

    await service.evaluateForNewReview(input, makeTx([], { usageWhere }));

    // 옛 코드는 사유를 보지 않고 REVOKED 를 전부 셌으므로 이 파라미터가 없다.
    expect(renderParams(usageWhere[0])).toEqual(expect.arrayContaining(['ORDER_CANCELLED_NOT_USER_FAULT']));
  });

  it('고객 귀책 취소 회수는 1인당 한도에서 빠지지 않는다', async () => {
    const usageWhere: unknown[] = [];
    const service = makeService([limitedRule()]);

    await service.evaluateForNewReview(input, makeTx([], { usageWhere }));

    expect(renderParams(usageWhere[0])).not.toEqual(expect.arrayContaining(['ORDER_CANCELLED']));
  });

  it('전체 예산 한도는 회수된 건을 세지 않는다 — 회수분은 예산으로 돌아온다', async () => {
    const usageWhere: unknown[] = [];
    const service = makeService([limitedRule()]);

    await service.evaluateForNewReview(input, makeTx([], { usageWhere }));

    const budgetParams = renderParams(usageWhere[1]);
    expect(budgetParams).toEqual(expect.arrayContaining(['GRANTED']));
    expect(budgetParams).not.toEqual(expect.arrayContaining(['REVOKED']));
  });
});
