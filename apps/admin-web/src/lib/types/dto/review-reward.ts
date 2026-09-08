/** 리뷰 보상 규칙 — ugc-service 의 review_reward_rules 와 같은 모양 */

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

export interface ReviewRewardConditions {
  reviewType: ReviewTypeFilter;
  minContentLength: number;
  minMediaCount: number;
  minRating: number | null;
  everyNthReview: number | null;
  best: { mode: BestSelectionMode; topN: number; minHelpfulCount: number } | null;
}

export interface ReviewRewardSpec {
  kind: ReviewRewardKind;
  amount?: number;
  ratePercent?: number;
  minAmount?: number | null;
  maxAmount?: number | null;
  expiresInDays?: number | null;
}

export interface ReviewRewardLimitSpec {
  period: ReviewRewardPeriod;
  maxCount: number | null;
  maxAmount: number | null;
}

export interface ReviewRewardLimits {
  perUser: ReviewRewardLimitSpec | null;
  global: ReviewRewardLimitSpec | null;
}

export interface ReviewRewardRuleDto {
  id: string;
  name: string;
  description: string | null;
  trigger: ReviewRewardTrigger;
  active: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: ReviewRewardConditions;
  reward: ReviewRewardSpec;
  limits: ReviewRewardLimits;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertReviewRewardRuleDto {
  name: string;
  description: string | null;
  trigger: ReviewRewardTrigger;
  active: boolean;
  priority: number;
  stopOnMatch: boolean;
  conditions: ReviewRewardConditions;
  reward: ReviewRewardSpec;
  limits: ReviewRewardLimits;
  startsAt: string | null;
  endsAt: string | null;
}

export type ReviewRewardGrantStatus = 'GRANTED' | 'SKIPPED' | 'REVOKED';

export interface ReviewRewardGrantDto {
  id: string;
  reviewId: string;
  userId: string;
  ruleId: string | null;
  trigger: ReviewRewardTrigger;
  rewardKind: ReviewRewardKind;
  amount: number;
  expiresAt: string | null;
  status: ReviewRewardGrantStatus;
  skipReason: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface ReviewRewardGrantListResponse {
  data: ReviewRewardGrantDto[];
  total: number;
  page: number;
  limit: number;
}

export interface ReviewRewardSummaryDto {
  since: string;
  granted: { count: number; amount: number };
  revoked: { count: number; amount: number };
  skipped: Array<{ reason: string; count: number }>;
}

export type BestSelectionStatus = 'CANDIDATE' | 'CONFIRMED' | 'REJECTED';

export interface BestSelectionDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  reviewId: string;
  userId: string;
  ruleId: string | null;
  rank: number;
  helpfulCount: number;
  status: BestSelectionStatus;
  confirmedAt: string | null;
  rating: number;
  content: string;
  productId: string;
}

export interface BestSelectionListResponse {
  data: BestSelectionDto[];
  total: number;
}
