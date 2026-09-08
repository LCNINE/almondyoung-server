import {
  applyLimits,
  computeReward,
  EvaluableRule,
  matchesConditions,
  periodStart,
  ReviewFacts,
  selectRule,
  toPublicGuides,
} from '../reward-rule.evaluator';
import {
  DEFAULT_REWARD_CONDITIONS,
  DEFAULT_REWARD_LIMITS,
  ReviewRewardConditions,
  ReviewRewardLimits,
  ReviewRewardSpec,
} from '../reward-rule.types';

const NOW = new Date('2026-09-07T03:00:00.000Z'); // KST 2026-09-07(월) 12:00

function rule(overrides: Partial<EvaluableRule> = {}): EvaluableRule {
  return {
    id: 'rule-1',
    priority: 0,
    stopOnMatch: true,
    conditions: { ...DEFAULT_REWARD_CONDITIONS },
    reward: { kind: 'POINT_FIXED', amount: 100, expiresInDays: null } as ReviewRewardSpec,
    limits: { ...DEFAULT_REWARD_LIMITS },
    startsAt: null,
    endsAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function facts(overrides: Partial<ReviewFacts> = {}): ReviewFacts {
  return {
    contentLength: 50,
    mediaCount: 0,
    rating: 5,
    userReviewSequence: 1,
    orderLineAmount: 20000,
    ...overrides,
  };
}

describe('matchesConditions', () => {
  it('reviewType ANY 는 텍스트·포토를 모두 받는다', () => {
    const conditions: ReviewRewardConditions = { ...DEFAULT_REWARD_CONDITIONS, reviewType: 'ANY' };
    expect(matchesConditions(conditions, facts({ mediaCount: 0 }))).toBe(true);
    expect(matchesConditions(conditions, facts({ mediaCount: 2 }))).toBe(true);
  });

  it('PHOTO 조건은 사진 없는 리뷰를 거른다', () => {
    const conditions: ReviewRewardConditions = { ...DEFAULT_REWARD_CONDITIONS, reviewType: 'PHOTO' };
    expect(matchesConditions(conditions, facts({ mediaCount: 0 }))).toBe(false);
    expect(matchesConditions(conditions, facts({ mediaCount: 1 }))).toBe(true);
  });

  it('글자수·사진수·별점 하한을 각각 검사한다', () => {
    expect(
      matchesConditions({ ...DEFAULT_REWARD_CONDITIONS, minContentLength: 100 }, facts({ contentLength: 99 })),
    ).toBe(false);
    expect(matchesConditions({ ...DEFAULT_REWARD_CONDITIONS, minMediaCount: 2 }, facts({ mediaCount: 1 }))).toBe(
      false,
    );
    expect(matchesConditions({ ...DEFAULT_REWARD_CONDITIONS, minRating: 4 }, facts({ rating: 3 }))).toBe(false);
    expect(matchesConditions({ ...DEFAULT_REWARD_CONDITIONS, minRating: 4 }, facts({ rating: 4 }))).toBe(true);
  });

  it('everyNthReview 는 그 배수번째 리뷰에서만 맞는다', () => {
    const conditions: ReviewRewardConditions = { ...DEFAULT_REWARD_CONDITIONS, everyNthReview: 3 };
    expect(matchesConditions(conditions, facts({ userReviewSequence: 2 }))).toBe(false);
    expect(matchesConditions(conditions, facts({ userReviewSequence: 3 }))).toBe(true);
    expect(matchesConditions(conditions, facts({ userReviewSequence: 6 }))).toBe(true);
  });
});

describe('computeReward', () => {
  it('NONE 은 지급하지 않고 사유를 남긴다', () => {
    const decision = computeReward(rule({ reward: { kind: 'NONE' } }), facts(), NOW);
    expect(decision).toMatchObject({ status: 'SKIPPED', skipReason: 'REWARD_NONE' });
  });

  it('BADGE 는 금액 0 으로 지급된다', () => {
    const decision = computeReward(rule({ reward: { kind: 'BADGE' } }), facts(), NOW);
    expect(decision).toMatchObject({ status: 'GRANTED', rewardKind: 'BADGE', amount: 0, expiresAt: null });
  });

  it('정액은 만료일수를 만료 시각으로 바꾼다', () => {
    const decision = computeReward(
      rule({ reward: { kind: 'POINT_FIXED', amount: 500, expiresInDays: 30 } }),
      facts(),
      NOW,
    );
    expect(decision).toMatchObject({ status: 'GRANTED', amount: 500 });
    expect(decision.status === 'GRANTED' && decision.expiresAt?.toISOString()).toBe('2026-10-07T03:00:00.000Z');
  });

  it('정률은 주문금액에 비율을 적용하고 캡으로 자른다', () => {
    const rateRule = rule({
      reward: { kind: 'POINT_RATE', ratePercent: 5, minAmount: null, maxAmount: 500, expiresInDays: null },
    });
    expect(computeReward(rateRule, facts({ orderLineAmount: 20000 }), NOW)).toMatchObject({ amount: 500 });
    expect(computeReward(rateRule, facts({ orderLineAmount: 2000 }), NOW)).toMatchObject({ amount: 100 });
  });

  it('정률에 최소액이 있으면 저가 상품도 최소액까지 올린다', () => {
    const rateRule = rule({
      reward: { kind: 'POINT_RATE', ratePercent: 1, minAmount: 50, maxAmount: null, expiresInDays: null },
    });
    expect(computeReward(rateRule, facts({ orderLineAmount: 1000 }), NOW)).toMatchObject({ amount: 50 });
  });

  it('주문금액을 모르면 0원으로 뭉개지 않고 사유를 남긴다', () => {
    const rateRule = rule({
      reward: { kind: 'POINT_RATE', ratePercent: 5, minAmount: null, maxAmount: null, expiresInDays: null },
    });
    expect(computeReward(rateRule, facts({ orderLineAmount: null }), NOW)).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'ORDER_AMOUNT_UNKNOWN',
    });
  });
});

describe('applyLimits', () => {
  const granted = {
    status: 'GRANTED' as const,
    ruleId: 'rule-1',
    rewardKind: 'POINT_FIXED' as const,
    amount: 500,
    expiresAt: null,
  };

  it('건수 한도를 넘으면 사유와 함께 막는다', () => {
    const limits: ReviewRewardLimits = {
      perUser: { period: 'MONTH', maxCount: 3, maxAmount: null },
      global: null,
    };
    expect(
      applyLimits(granted, limits, { perUser: { count: 3, amount: 0 }, global: { count: 0, amount: 0 } }),
    ).toMatchObject({ status: 'SKIPPED', skipReason: 'PER_USER_LIMIT' });
    expect(
      applyLimits(granted, limits, { perUser: { count: 2, amount: 0 }, global: { count: 0, amount: 0 } }),
    ).toMatchObject({ status: 'GRANTED' });
  });

  it('전체 예산 상한은 이번 지급액을 더한 값으로 판정한다', () => {
    const limits: ReviewRewardLimits = {
      perUser: null,
      global: { period: 'MONTH', maxCount: null, maxAmount: 100000 },
    };
    expect(
      applyLimits(granted, limits, { perUser: { count: 0, amount: 0 }, global: { count: 0, amount: 99600 } }),
    ).toMatchObject({ status: 'SKIPPED', skipReason: 'GLOBAL_LIMIT' });
    expect(
      applyLimits(granted, limits, { perUser: { count: 0, amount: 0 }, global: { count: 0, amount: 99500 } }),
    ).toMatchObject({ status: 'GRANTED' });
  });
});

describe('selectRule', () => {
  it('활성 규칙이 없으면 NO_ACTIVE_RULE — 기본은 무보상이다', () => {
    expect(selectRule([], facts(), NOW).decision).toMatchObject({
      status: 'SKIPPED',
      skipReason: 'NO_ACTIVE_RULE',
      ruleId: null,
    });
  });

  it('조건에 맞는 규칙이 없으면 NO_MATCHING_RULE', () => {
    const photoOnly = rule({ conditions: { ...DEFAULT_REWARD_CONDITIONS, reviewType: 'PHOTO' } });
    expect(selectRule([photoOnly], facts({ mediaCount: 0 }), NOW).decision).toMatchObject({
      skipReason: 'NO_MATCHING_RULE',
    });
  });

  it('priority 가 큰 규칙이 먼저 적용된다', () => {
    const low = rule({ id: 'low', priority: 1, reward: { kind: 'POINT_FIXED', amount: 100, expiresInDays: null } });
    const high = rule({ id: 'high', priority: 9, reward: { kind: 'POINT_FIXED', amount: 900, expiresInDays: null } });
    expect(selectRule([low, high], facts(), NOW).decision).toMatchObject({ ruleId: 'high', amount: 900 });
  });

  it('기간 밖 규칙은 후보에서 빠진다', () => {
    const expired = rule({ endsAt: new Date('2026-09-01T00:00:00.000Z') });
    expect(selectRule([expired], facts(), NOW).decision).toMatchObject({ skipReason: 'NO_ACTIVE_RULE' });
  });

  it('stopOnMatch=false 면 지급 못 하는 규칙 다음 규칙까지 본다', () => {
    const blocked = rule({
      id: 'rate',
      priority: 9,
      stopOnMatch: false,
      reward: { kind: 'POINT_RATE', ratePercent: 5, minAmount: null, maxAmount: null, expiresInDays: null },
    });
    const fallback = rule({ id: 'fixed', priority: 1 });
    const decision = selectRule([blocked, fallback], facts({ orderLineAmount: null }), NOW).decision;
    expect(decision).toMatchObject({ status: 'GRANTED', ruleId: 'fixed' });
  });

  it('stopOnMatch=true 면 첫 매칭에서 멈추고 그 사유를 남긴다', () => {
    const blocked = rule({
      id: 'rate',
      priority: 9,
      stopOnMatch: true,
      reward: { kind: 'POINT_RATE', ratePercent: 5, minAmount: null, maxAmount: null, expiresInDays: null },
    });
    const fallback = rule({ id: 'fixed', priority: 1 });
    expect(selectRule([blocked, fallback], facts({ orderLineAmount: null }), NOW).decision).toMatchObject({
      status: 'SKIPPED',
      ruleId: 'rate',
      skipReason: 'ORDER_AMOUNT_UNKNOWN',
    });
  });
});

describe('periodStart', () => {
  it('DAY 경계는 KST 자정이다', () => {
    // KST 2026-09-07 00:30 = UTC 2026-09-06 15:30
    expect(periodStart('DAY', new Date('2026-09-06T15:30:00.000Z'))?.toISOString()).toBe('2026-09-06T15:00:00.000Z');
    // KST 2026-09-06 23:30 = UTC 2026-09-06 14:30 → 전날 자정
    expect(periodStart('DAY', new Date('2026-09-06T14:30:00.000Z'))?.toISOString()).toBe('2026-09-05T15:00:00.000Z');
  });

  it('WEEK 는 KST 월요일 자정에서 시작한다', () => {
    // 2026-09-07 은 월요일
    expect(periodStart('WEEK', NOW)?.toISOString()).toBe('2026-09-06T15:00:00.000Z');
    // 일요일(2026-09-13 KST)은 같은 주의 월요일로 묶인다
    expect(periodStart('WEEK', new Date('2026-09-13T03:00:00.000Z'))?.toISOString()).toBe('2026-09-06T15:00:00.000Z');
  });

  it('MONTH 는 KST 1일 자정이다', () => {
    expect(periodStart('MONTH', NOW)?.toISOString()).toBe('2026-08-31T15:00:00.000Z');
  });

  it('ALL 은 기간 경계가 없다', () => {
    expect(periodStart('ALL', NOW)).toBeNull();
  });
});

describe('toPublicGuides', () => {
  it('활성 규칙이 없으면 안내가 비어 있다 — 고객 화면은 적립 문구를 띄우지 않는다', () => {
    expect(toPublicGuides([], NOW)).toEqual([]);
  });

  it('ANY 규칙은 텍스트·포토 두 갈래로 안내된다', () => {
    const guides = toPublicGuides([rule()], NOW);
    expect(guides.map((g) => g.reviewType).sort()).toEqual(['PHOTO', 'TEXT']);
  });

  it('사진을 요구하는 규칙은 텍스트 안내로 새지 않는다', () => {
    const photoOnly = rule({ conditions: { ...DEFAULT_REWARD_CONDITIONS, reviewType: 'ANY', minMediaCount: 1 } });
    expect(toPublicGuides([photoOnly], NOW).map((g) => g.reviewType)).toEqual(['PHOTO']);
  });

  it('정률은 금액 대신 비율과 상한을 그대로 내보낸다', () => {
    const rateRule = rule({
      conditions: { ...DEFAULT_REWARD_CONDITIONS, reviewType: 'TEXT' },
      reward: { kind: 'POINT_RATE', ratePercent: 5, minAmount: null, maxAmount: 500, expiresInDays: null },
    });
    expect(toPublicGuides([rateRule], NOW)[0]).toMatchObject({
      rewardKind: 'POINT_RATE',
      ratePercent: 5,
      maxAmount: 500,
      rewardAmount: 500,
    });
  });

  it('지급 없음 규칙은 안내하지 않는다', () => {
    expect(toPublicGuides([rule({ reward: { kind: 'NONE' } })], NOW)).toEqual([]);
  });
});
