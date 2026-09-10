/**
 * 보상 판정의 순수 함수 모음. DB 도 시각도 여기서 읽지 않는다 —
 * 필요한 사실은 전부 인자로 받는다. 지급 규칙이 바뀌었는지는 이 파일의 테스트가 말한다.
 */
import {
  ReviewRewardConditions,
  ReviewRewardKind,
  ReviewRewardLimitSpec,
  ReviewRewardLimits,
  ReviewRewardPeriod,
  ReviewRewardSkipReason,
  ReviewRewardSpec,
} from './reward-rule.types';

export interface EvaluableRule {
  id: string;
  priority: number;
  stopOnMatch: boolean;
  conditions: ReviewRewardConditions;
  reward: ReviewRewardSpec;
  limits: ReviewRewardLimits;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
}

export interface ReviewFacts {
  contentLength: number;
  mediaCount: number;
  rating: number;
  /** 이 리뷰가 그 사용자의 몇 번째 리뷰인지 (1부터) */
  userReviewSequence: number;
  /** 리뷰가 달린 주문 라인의 결제금액(원). 모르면 null */
  orderLineAmount: number | null;
}

/** 리뷰 «수정»으로 바뀔 수 있는 사실만. 재판정은 이 축들만 다시 본다. */
export type EditableReviewFacts = Pick<ReviewFacts, 'contentLength' | 'mediaCount' | 'rating'>;

export interface UsageFacts {
  count: number;
  amount: number;
}

export type RewardDecision =
  | {
      status: 'GRANTED';
      ruleId: string;
      rewardKind: Exclude<ReviewRewardKind, 'NONE'>;
      amount: number;
      expiresAt: Date | null;
    }
  | {
      status: 'SKIPPED';
      ruleId: string | null;
      rewardKind: ReviewRewardKind;
      skipReason: ReviewRewardSkipReason;
    };

export function resolveReviewType(mediaCount: number): 'TEXT' | 'PHOTO' {
  return mediaCount > 0 ? 'PHOTO' : 'TEXT';
}

export function isRuleInWindow(rule: EvaluableRule, now: Date): boolean {
  if (rule.startsAt && now < rule.startsAt) return false;
  if (rule.endsAt && now > rule.endsAt) return false;
  return true;
}

/** 큰 priority 가 먼저. 같으면 먼저 만든 규칙이 먼저 */
export function sortRules(rules: EvaluableRule[]): EvaluableRule[] {
  return [...rules].sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());
}

export function matchesConditions(conditions: ReviewRewardConditions, facts: ReviewFacts): boolean {
  const reviewType = resolveReviewType(facts.mediaCount);

  if (conditions.reviewType !== 'ANY' && conditions.reviewType !== reviewType) return false;
  if (facts.contentLength < conditions.minContentLength) return false;
  if (facts.mediaCount < conditions.minMediaCount) return false;
  if (conditions.minRating !== null && facts.rating < conditions.minRating) return false;
  if (conditions.everyNthReview !== null && conditions.everyNthReview > 0) {
    if (facts.userReviewSequence % conditions.everyNthReview !== 0) return false;
  }
  return true;
}

/**
 * 리뷰를 «수정»한 뒤에도 그 규칙의 조건을 여전히 만족하는지 본다. `matchesConditions` 와 달리
 * 수정으로 «바뀔 수 있는 축»만 본다 — 본문 길이·미디어 수·별점, 그리고 그 둘에서 파생되는 리뷰 종류다.
 *
 * `everyNthReview` 를 빼는 것은 그 값이 「그 사용자의 몇 번째 리뷰인가」라서 수정으로 변하지 않기
 * 때문이다. 여기서 같이 재보면 이미 지급이 끝난 순번 조건을 되짚어 «수정과 무관한 회수»가 생긴다.
 * 정률의 주문금액도 같은 이유로 빠진다.
 */
export function stillMeetsEditableConditions(conditions: ReviewRewardConditions, facts: EditableReviewFacts): boolean {
  const reviewType = resolveReviewType(facts.mediaCount);

  if (conditions.reviewType !== 'ANY' && conditions.reviewType !== reviewType) return false;
  if (facts.contentLength < conditions.minContentLength) return false;
  if (facts.mediaCount < conditions.minMediaCount) return false;
  if (conditions.minRating !== null && facts.rating < conditions.minRating) return false;
  return true;
}

/**
 * 매칭된 규칙 하나에서 지급액을 계산한다. 한도는 여기서 보지 않는다 —
 * 한도는 DB 집계가 있어야 알 수 있어 applyLimits 가 따로 맡는다.
 */
export function computeReward(rule: EvaluableRule, facts: ReviewFacts, now: Date): RewardDecision {
  const reward = rule.reward;

  if (reward.kind === 'NONE') {
    return { status: 'SKIPPED', ruleId: rule.id, rewardKind: 'NONE', skipReason: 'REWARD_NONE' };
  }

  if (reward.kind === 'BADGE') {
    return { status: 'GRANTED', ruleId: rule.id, rewardKind: 'BADGE', amount: 0, expiresAt: null };
  }

  if (reward.kind === 'POINT_FIXED') {
    if (reward.amount <= 0) {
      return { status: 'SKIPPED', ruleId: rule.id, rewardKind: 'POINT_FIXED', skipReason: 'AMOUNT_ZERO' };
    }
    return {
      status: 'GRANTED',
      ruleId: rule.id,
      rewardKind: 'POINT_FIXED',
      amount: reward.amount,
      expiresAt: addDays(now, reward.expiresInDays),
    };
  }

  // POINT_RATE — 주문금액을 모르면 0원으로 뭉개지 않고 사유를 남기고 건너뛴다.
  if (facts.orderLineAmount === null) {
    return { status: 'SKIPPED', ruleId: rule.id, rewardKind: 'POINT_RATE', skipReason: 'ORDER_AMOUNT_UNKNOWN' };
  }

  let amount = Math.floor((facts.orderLineAmount * reward.ratePercent) / 100);
  if (reward.maxAmount !== null) amount = Math.min(amount, reward.maxAmount);
  if (reward.minAmount !== null) amount = Math.max(amount, reward.minAmount);

  if (amount <= 0) {
    return { status: 'SKIPPED', ruleId: rule.id, rewardKind: 'POINT_RATE', skipReason: 'AMOUNT_ZERO' };
  }

  return {
    status: 'GRANTED',
    ruleId: rule.id,
    rewardKind: 'POINT_RATE',
    amount,
    expiresAt: addDays(now, reward.expiresInDays),
  };
}

export function applyLimit(
  limit: ReviewRewardLimitSpec | null,
  usage: UsageFacts,
  amount: number,
): 'OK' | 'EXCEEDED' {
  if (!limit) return 'OK';
  if (limit.maxCount !== null && usage.count + 1 > limit.maxCount) return 'EXCEEDED';
  if (limit.maxAmount !== null && usage.amount + amount > limit.maxAmount) return 'EXCEEDED';
  return 'OK';
}

/** 한도까지 반영한 최종 판정 */
export function applyLimits(
  decision: RewardDecision,
  limits: ReviewRewardLimits,
  usage: { perUser: UsageFacts; global: UsageFacts },
): RewardDecision {
  if (decision.status !== 'GRANTED') return decision;

  if (applyLimit(limits.perUser, usage.perUser, decision.amount) === 'EXCEEDED') {
    return {
      status: 'SKIPPED',
      ruleId: decision.ruleId,
      rewardKind: decision.rewardKind,
      skipReason: 'PER_USER_LIMIT',
    };
  }

  if (applyLimit(limits.global, usage.global, decision.amount) === 'EXCEEDED') {
    return {
      status: 'SKIPPED',
      ruleId: decision.ruleId,
      rewardKind: decision.rewardKind,
      skipReason: 'GLOBAL_LIMIT',
    };
  }

  return decision;
}

/**
 * 활성 규칙 목록에서 이번 리뷰에 적용될 규칙을 고른다.
 * stopOnMatch 가 false 인 규칙은 조건이 맞아도 보상이 안 나가면 다음 규칙으로 넘긴다.
 */
export function selectRule(
  rules: EvaluableRule[],
  facts: ReviewFacts,
  now: Date,
): { rule: EvaluableRule; decision: RewardDecision } | { rule: null; decision: RewardDecision } {
  const candidates = sortRules(rules.filter((rule) => isRuleInWindow(rule, now)));

  if (candidates.length === 0) {
    return { rule: null, decision: noRuleDecision('NO_ACTIVE_RULE') };
  }

  let lastSkip: RewardDecision | null = null;

  for (const rule of candidates) {
    if (!matchesConditions(rule.conditions, facts)) continue;

    const decision = computeReward(rule, facts, now);
    if (decision.status === 'GRANTED') return { rule, decision };

    lastSkip = decision;
    if (rule.stopOnMatch) return { rule, decision };
  }

  return { rule: null, decision: lastSkip ?? noRuleDecision('NO_MATCHING_RULE') };
}

function noRuleDecision(reason: ReviewRewardSkipReason): RewardDecision {
  return { status: 'SKIPPED', ruleId: null, rewardKind: 'NONE', skipReason: reason };
}

function addDays(from: Date, days: number | null): Date | null {
  if (days === null || days <= 0) return null;
  const expires = new Date(from);
  expires.setUTCDate(expires.getUTCDate() + days);
  return expires;
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 한도 기간의 시작 시각(UTC Date). 경계는 KST 기준이다 —
 * 「하루 3건」이 한국 자정에 초기화되지 않으면 관리자가 쓸 수 없는 한도가 된다.
 */
export function periodStart(period: ReviewRewardPeriod, now: Date): Date | null {
  if (period === 'ALL') return null;

  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth();
  const date = kst.getUTCDate();

  if (period === 'DAY') {
    return new Date(Date.UTC(year, month, date) - KST_OFFSET_MS);
  }
  if (period === 'MONTH') {
    return new Date(Date.UTC(year, month, 1) - KST_OFFSET_MS);
  }

  // WEEK — 월요일 시작
  const weekday = kst.getUTCDay(); // 0=일
  const daysSinceMonday = (weekday + 6) % 7;
  return new Date(Date.UTC(year, month, date - daysSinceMonday) - KST_OFFSET_MS);
}

export interface ReviewRewardGuide {
  reviewType: 'TEXT' | 'PHOTO';
  rewardKind: 'POINT_FIXED' | 'POINT_RATE' | 'BADGE';
  /** 정액이면 그 금액, 정률이면 상한(상한이 없으면 0) */
  rewardAmount: number;
  ratePercent: number | null;
  maxAmount: number | null;
  minContentLength: number;
  minMediaCount: number;
  expiresInDays: number | null;
}

/**
 * 고객 화면에 「무엇을 주는지」 안내하기 위한 요약. 활성 규칙이 없으면 빈 배열이고,
 * 그때 스토어프론트는 적립 문구를 아예 띄우지 않는다 — 못 지킬 약속을 걸지 않기 위해서다.
 *
 * 정률 규칙은 금액이 주문에 따라 달라지므로 상한·비율을 그대로 내보낸다.
 * 여기서 대표값 하나로 뭉개면 화면 문구가 실제 지급액과 어긋난다.
 */
export function toPublicGuides(rules: EvaluableRule[], now: Date): ReviewRewardGuide[] {
  const guides = new Map<string, ReviewRewardGuide>();

  for (const rule of sortRules(rules.filter((rule) => isRuleInWindow(rule, now)))) {
    const reward = rule.reward;
    if (reward.kind === 'NONE') continue;

    const types: Array<'TEXT' | 'PHOTO'> =
      rule.conditions.reviewType === 'ANY' ? ['TEXT', 'PHOTO'] : [rule.conditions.reviewType];

    for (const reviewType of types) {
      // PHOTO 조건이 붙은 규칙은 사진 없는 리뷰에 적용될 수 없다.
      if (reviewType === 'TEXT' && rule.conditions.minMediaCount > 0) continue;

      const guide: ReviewRewardGuide = {
        reviewType,
        rewardKind: reward.kind,
        rewardAmount:
          reward.kind === 'POINT_FIXED' ? reward.amount : reward.kind === 'POINT_RATE' ? (reward.maxAmount ?? 0) : 0,
        ratePercent: reward.kind === 'POINT_RATE' ? reward.ratePercent : null,
        maxAmount: reward.kind === 'POINT_RATE' ? reward.maxAmount : null,
        minContentLength: rule.conditions.minContentLength,
        minMediaCount: rule.conditions.minMediaCount,
        expiresInDays: reward.kind === 'POINT_FIXED' || reward.kind === 'POINT_RATE' ? reward.expiresInDays : null,
      };

      const existing = guides.get(reviewType);
      if (!existing || existing.rewardAmount < guide.rewardAmount) {
        guides.set(reviewType, guide);
      }
    }
  }

  return [...guides.values()];
}
