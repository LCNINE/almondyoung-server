/**
 * 통합 타입 정의
 * - Drizzle 스키마 기반 엔티티 타입
 * - Service 레이어 입력/출력 타입
 * - API 응답 타입
 */

import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import * as schema from './entities/schema';

// Drizzle에서 자동 추론된 타입들
export type User = InferSelectModel<typeof schema.users>;
export type NewUser = InferInsertModel<typeof schema.users>;

export type Tier = InferSelectModel<typeof schema.subscriptionTiers>;
export type NewTier = InferInsertModel<typeof schema.subscriptionTiers>;

export type Plan = InferSelectModel<typeof schema.subscriptionPlans>;
export type NewPlan = InferInsertModel<typeof schema.subscriptionPlans>;

export type Subscription = InferSelectModel<typeof schema.subscriptions>;
export type NewSubscription = InferInsertModel<typeof schema.subscriptions>;

export type SubscriptionRight = InferSelectModel<
  typeof schema.subscriptionRights
>;
export type NewSubscriptionRight = InferInsertModel<
  typeof schema.subscriptionRights
>;

export type SubscriptionEvent = InferSelectModel<
  typeof schema.subscriptionEvents
>;
export type NewSubscriptionEvent = InferInsertModel<
  typeof schema.subscriptionEvents
>;

export type SubscriptionPause = InferSelectModel<
  typeof schema.subscriptionPauses
>;
export type NewSubscriptionPause = InferInsertModel<
  typeof schema.subscriptionPauses
>;

export type PauseUsageTracker = InferSelectModel<
  typeof schema.pauseUsageTracker
>;
export type NewPauseUsageTracker = InferInsertModel<
  typeof schema.pauseUsageTracker
>;

export type SubscriptionPolicy = InferSelectModel<
  typeof schema.subscriptionPolicies
>;
export type NewSubscriptionPolicy = InferInsertModel<
  typeof schema.subscriptionPolicies
>;

// =================================================================
// Service 레이어 입력 타입들 (Drizzle 타입 기반)
// =================================================================

// Admin Operations - Service 레이어에서 사용
export type CreateTierInput = Pick<NewTier, 'code' | 'name' | 'priorityLevel'>;
export type UpdateTierInput = Partial<Pick<Tier, 'name' | 'priorityLevel'>>;
export type CreatePlanInput = Pick<
  NewPlan,
  'tierId' | 'price' | 'durationDays' | 'currency' | 'trialDays'
>;
export type UpdatePlanInput = Partial<
  Pick<Plan, 'price' | 'durationDays' | 'currency' | 'trialDays' | 'isActive'>
>;
export type DeactivatePlanInput = {
  reason: string;
};

// Subscription Operations - Service 레이어에서 사용
export type CreateSubscriptionInput = {
  planId: string;
};
export type UpgradeSubscriptionInput = {
  newPlanId: string;
};
export type DowngradeSubscriptionInput = {
  newPlanId: string;
  effectiveDate?: string;
};
export type PauseSubscriptionInput = {
  startDate: string;
  endDate: string;
  reason?: string;
};
export type ResumeSubscriptionInput = {
  reason?: string;
};
export type CancelSubscriptionInput = {
  reason?: string;
  effectiveDate?: string;
};

// 조인된 타입들 (자주 사용되는 조합)
export type PlanWithTier = Plan & {
  tier: Tier;
};

export type SubscriptionWithPlan = Subscription & {
  plan: Plan;
};

export type SubscriptionWithPlanAndTier = Subscription & {
  plan: PlanWithTier;
};

export type SubscriptionRightWithTier = SubscriptionRight & {
  tier: Tier;
};

// 응답용 타입들 (필요한 필드만 선택)
export type TierInfo = Pick<Tier, 'id' | 'code' | 'name' | 'priorityLevel'>;

export type PlanInfo = Pick<
  Plan,
  'id' | 'price' | 'durationDays' | 'currency' | 'trialDays'
>;

export type CurrentSubscriptionResponse = {
  id: string;
  status: Subscription['status'];
  currentTier: TierInfo;
  plan: PlanInfo;
  nextBillingDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  isPaused: boolean;
  pausedAt: string | null;
};

export type SubscriptionHistoryItem = {
  id: string;
  planId: string;
  tierCode: string;
  status: Subscription['status'];
  startedAt: string;
  endedAt: string | null;
  changeType: Subscription['changeType'];
};

export type PauseHistoryItem = Pick<
  SubscriptionPause,
  'id' | 'startsAt' | 'endsAt' | 'actualResumedAt' | 'status'
> & {
  createdAt: string; // API response should return ISO string
};

export type PauseEligibilityResponse = {
  eligible: boolean;
  currentUsage: number;
  maxPauses: number;
  remainingPauses: number;
};

export type UserRightsResponse = Pick<
  SubscriptionRight,
  'userId' | 'tierId' | 'startsAt' | 'endsAt' | 'isActive' | 'pausedAt'
> & {
  tierCode: string;
  isPaused: boolean;
};

export type BulkSubscriptionCheckResponse = Record<
  string,
  {
    hasActiveSubscription: boolean;
    tierCode?: string;
    isPaused?: boolean;
    expiresAt?: string;
  }
>;

// Tier Benefits 응답용 타입
export type TierBenefits = {
  tier: TierInfo & {
    createdAt: string;
    updatedAt: string;
  };
  plans: Array<
    Pick<Plan, 'id' | 'price' | 'durationDays' | 'currency' | 'trialDays'> & {
      createdAt: string;
      updatedAt: string;
    }
  >;
  benefits: Array<{
    type: string;
    description: string;
    value: string;
  }>;
};

// Plan Details 응답용 타입 (API 응답에서 사용)
export type PlanDetailsResponse = {
  id: string;
  tier: {
    id: string;
    code: string;
    name: string;
    priorityLevel: number;
    createdAt: string;
    updatedAt: string;
  };
  price: number;
  durationDays: number;
  currency: string;
  trialDays: number | null;
  createdAt: string;
  updatedAt: string;
};

// Tier List 응답용 타입
export type TierListResponse = Array<{
  id: string;
  code: string;
  name: string;
  priorityLevel: number;
  createdAt: string;
  updatedAt: string;
}>;



// Admin 응답용 타입들
export type AdminOperationResponse = {
  success: boolean;
  message: string;
};

export type CreateTierResponse = AdminOperationResponse & {
  tierId: string;
};

export type UpdateTierResponse = AdminOperationResponse & {
  tierId: string;
  impactAnalysis: {
    affectedPlansCount: number;
    affectedPlans: Array<{
      id: string;
      price: number;
      durationDays: number;
    }>;
    changes: Record<string, any>;
  };
};

export type CreatePlanResponse = AdminOperationResponse & {
  planId: string;
};

export type UpdatePlanResponse = AdminOperationResponse & {
  planId: string;
  impactAnalysis: {
    estimatedAffectedSubscribers: number;
    priceChange: 'PRICE_UPDATED' | 'NO_PRICE_CHANGE';
    durationChange: 'DURATION_UPDATED' | 'NO_DURATION_CHANGE';
    changes: Record<string, any>;
  };
};

export type DeactivatePlanResponse = AdminOperationResponse & {
  planId: string;
  impactAnalysis: {
    estimatedAffectedSubscribers: number;
    alternativePlans: Plan[];
    warning: string;
  };
};


// =================================================================
// Policy Management Types
// =================================================================

// 기본 정책 타입 (Drizzle 스키마 기반)
export type Policy = SubscriptionPolicy;
export type NewPolicy = NewSubscriptionPolicy;

// 정책 검증 관련 타입 (Service 레이어에서 사용)
// Note: HTTP 요청 검증용 타입은 requests.ts에서 정의됨

export type PolicyViolation = {
  policyId: string;
  policyName: string;
  ruleType: string;
  violationType: string;
  message: string;
  severity: 'ERROR' | 'WARNING';
  suggestedAction?: string;
};

export type PolicyWarning = {
  policyId: string;
  policyName: string;
  message: string;
  context: Record<string, any>;
};

export type AppliedPolicy = {
  policyId: string;
  policyName: string;
  ruleType: string;
  appliedValue: any;
  context: Record<string, any>;
};

export type PolicyValidationResult = {
  isValid: boolean;
  violatedPolicies: PolicyViolation[];
  warnings: PolicyWarning[];
  appliedPolicies: AppliedPolicy[];
  executionTime: number;
};

export type BulkPolicyValidationResult = {
  results: PolicyValidationResult[];
  totalExecutionTime: number;
};

// 정책 관리 입력 타입


export type UpdatePolicyInput = Partial<{
  ruleValue: Record<string, any>;
  isActive: boolean;
  validFrom: string;
  validUntil: string;
}>;

// 정책 조회 쿼리 타입 추가
export type GetPoliciesDto = {
  ruleType?: string;
  tierId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
};

// 정책 응답 타입
export type PolicyResponse = {
  id: string;
  ruleType: string;
  ruleValue: Record<string, any>;
  tierId?: string;
  tierInfo?: TierInfo;
  isActive: boolean;
  validFrom?: string;
  validUntil?: string;
  createdAt: string;
  updatedAt: string;
};

export type PolicyListResponse = {
  policies: PolicyResponse[];
  total: number;
  page: number;
  limit: number;
};

// 정책 컨텍스트 타입
export type PolicyContext = {
  userId: string;
  tierId?: string;
  subscriptionId?: string;
  currentDate: string;
  userMetadata?: Record<string, any>;
};

// 적용 가능한 정책 타입
export type ApplicablePolicy = {
  policy: PolicyResponse;
  isApplicable: boolean;
  reason?: string;
  priority: number;
};

// 정책 엔진 결과 타입
export type PolicyEngineResult = {
  decision: 'ALLOW' | 'DENY' | 'WARNING';
  policies: AppliedPolicy[];
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
  metadata: Record<string, any>;
};

// 정책 통계 타입
export type PolicyStatistics = {
  totalPolicies: number;
  activePolicies: number;
  inactivePolicies: number;
  policyByType: Record<string, number>;
  policyByTier: Record<string, number>;
  recentViolations: number;
  topViolatedPolicies: Array<{
    policyId: string;
    ruleType: string;
    violationCount: number;
  }>;
};

// 일시정지 정책 특화 타입
export type PausePolicyValidation = {
  canPause: boolean;
  remainingPauses: number;
  maxPausesPerYear: number;
  minPauseDuration: number;
  maxPauseDuration: number;
  cooldownDays: number;
  lastPauseDate?: string;
  nextAllowedPauseDate?: string;
  blackoutPeriods: Array<{
    startDate: string;
    endDate: string;
    reason: string;
  }>;
};

// 플랜 변경 정책 특화 타입
export type PlanChangePolicyValidation = {
  canChange: boolean;
  allowedChanges: Array<{
    fromPlanId: string;
    toPlanId: string;
    changeType: 'UPGRADE' | 'DOWNGRADE';
    restrictions?: string[];
  }>;
  cooldownDays: number;
  lastChangeDate?: string;
  nextAllowedChangeDate?: string;
  downgradeRestrictions: string[];
  upgradeeBenefits: Record<string, any>;
};