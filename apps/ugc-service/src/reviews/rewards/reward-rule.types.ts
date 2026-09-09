/**
 * 리뷰 보상 규칙의 값 타입.
 *
 * 규칙은 「조건(conditions) + 보상(reward) + 한도(limits)」 세 조각으로 이루어진다.
 * 세 조각은 jsonb 로 저장되고 관리자 입력 경계(DTO)에서 검증되며,
 * 계산은 reward-rule.evaluator 의 순수 함수가 맡는다 — DB 도 시각도 모르는 함수라야
 * 지급 판정을 테스트로 못 박을 수 있다.
 */

export const REVIEW_REWARD_TRIGGERS = ['ON_REVIEW_CREATED', 'WEEKLY_BEST'] as const;
export type ReviewRewardTrigger = (typeof REVIEW_REWARD_TRIGGERS)[number];

export const REVIEW_REWARD_KINDS = ['NONE', 'POINT_FIXED', 'POINT_RATE', 'BADGE'] as const;
export type ReviewRewardKind = (typeof REVIEW_REWARD_KINDS)[number];

export const REVIEW_REWARD_PERIODS = ['DAY', 'WEEK', 'MONTH', 'ALL'] as const;
export type ReviewRewardPeriod = (typeof REVIEW_REWARD_PERIODS)[number];

export const REVIEW_TYPE_FILTERS = ['ANY', 'TEXT', 'PHOTO'] as const;
export type ReviewTypeFilter = (typeof REVIEW_TYPE_FILTERS)[number];

export const BEST_SELECTION_MODES = ['HELPFUL_COUNT', 'RANDOM'] as const;
export type BestSelectionMode = (typeof BEST_SELECTION_MODES)[number];

export interface ReviewRewardBestSpec {
  mode: BestSelectionMode;
  topN: number;
  minHelpfulCount: number;
}

export interface ReviewRewardConditions {
  /** 'ANY' 면 텍스트·포토 구분 없이 매칭 */
  reviewType: ReviewTypeFilter;
  minContentLength: number;
  minMediaCount: number;
  /** null 이면 별점 조건 없음 */
  minRating: number | null;
  /** N 이 지정되면 그 사용자의 N 번째 리뷰마다 매칭(누적형). null 이면 매번 */
  everyNthReview: number | null;
  /** WEEKLY_BEST 트리거에서만 쓰인다 */
  best: ReviewRewardBestSpec | null;
}

export type ReviewRewardSpec =
  | { kind: 'NONE' }
  | { kind: 'BADGE' }
  | { kind: 'POINT_FIXED'; amount: number; expiresInDays: number | null }
  | {
      kind: 'POINT_RATE';
      ratePercent: number;
      minAmount: number | null;
      maxAmount: number | null;
      expiresInDays: number | null;
    };

export interface ReviewRewardLimitSpec {
  period: ReviewRewardPeriod;
  /** null 이면 그 축은 무제한 */
  maxCount: number | null;
  maxAmount: number | null;
}

export interface ReviewRewardLimits {
  /** 1인당 한도 */
  perUser: ReviewRewardLimitSpec | null;
  /** 전체 예산 상한(기간당). period 'ALL' 은 누적 총액 상한 */
  global: ReviewRewardLimitSpec | null;
}

export const REVIEW_REWARD_GRANT_STATUSES = ['GRANTED', 'SKIPPED', 'REVOKED'] as const;
export type ReviewRewardGrantStatus = (typeof REVIEW_REWARD_GRANT_STATUSES)[number];

/**
 * 지급되지 않은 사유. 「0원 지급」과 「지급 대상 아님」을 구별하려고 원장에 남긴다 —
 * 화면에서 사유별로 세어 보여줄 수 있어야 한다.
 */
export const REVIEW_REWARD_SKIP_REASONS = [
  'NO_ACTIVE_RULE',
  'NO_MATCHING_RULE',
  'REWARD_NONE',
  'ORDER_AMOUNT_UNKNOWN',
  'PER_USER_LIMIT',
  'GLOBAL_LIMIT',
  'AMOUNT_ZERO',
] as const;
export type ReviewRewardSkipReason = (typeof REVIEW_REWARD_SKIP_REASONS)[number];

export const BEST_SELECTION_STATUSES = ['CANDIDATE', 'CONFIRMED', 'REJECTED'] as const;
export type BestSelectionStatus = (typeof BEST_SELECTION_STATUSES)[number];

export const DEFAULT_REWARD_CONDITIONS: ReviewRewardConditions = {
  reviewType: 'ANY',
  minContentLength: 0,
  minMediaCount: 0,
  minRating: null,
  everyNthReview: null,
  best: null,
};

export const DEFAULT_REWARD_LIMITS: ReviewRewardLimits = {
  perUser: null,
  global: null,
};
