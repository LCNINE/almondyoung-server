/**
 * Request validation schemas - Controller 레이어에서만 사용
 * HTTP 요청 검증을 위한 Zod 스키마와 타입 정의
 * Service 레이어에서는 types.ts의 Input 타입을 사용
 */

import { z } from 'zod';

// Admin Operations - 입력 검증용
export const CreateTierRequestSchema = z.object({
  code: z
    .string()
    .min(1, { error: '티어 코드는 필수입니다' })
    .max(20, { error: '티어 코드는 20자 이하여야 합니다' })
    .regex(/^[A-Z_]+$/, {
      error: '티어 코드는 대문자와 언더스코어만 사용할 수 있습니다',
    }),
  priorityLevel: z
    .number()
    .min(1, { error: '우선순위는 1 이상이어야 합니다' })
    .max(100, '우선순위는 100 이하여야 합니다'),
});

export const UpdateTierRequestSchema = z.object({
  name: z
    .string()
    .min(1, { error: '티어 이름은 필수입니다' })
    .max(50, { error: '티어 이름은 50자 이하여야 합니다' })
    .optional(),
  priorityLevel: z
    .number()
    .min(1, { error: '우선순위는 1 이상이어야 합니다' })
    .max(100, { error: '우선순위는 100 이하여야 합니다' })
    .optional(),
});

export const CreatePlanRequestSchema = z.object({
  tierId: z.uuid({ error: '유효한 티어 ID여야 합니다' }),
  price: z.number().min(0, { error: '가격은 0 이상이어야 합니다' }),
  durationDays: z.number().min(1, { error: '기간은 1일 이상이어야 합니다' }),
  currency: z.string().length(3, { error: '통화 코드는 3자리여야 합니다' }).default('KRW').optional(),
  trialDays: z.number().min(0, { error: '무료 체험 기간은 0 이상이어야 합니다' }).default(0).optional(),
});

export const UpdatePlanRequestSchema = z.object({
  price: z.number().min(0, '가격은 0 이상이어야 합니다').optional(),
  durationDays: z.number().min(1, '기간은 1일 이상이어야 합니다').optional(),
  currency: z.string().length(3, '통화 코드는 3자리여야 합니다').optional(),
  trialDays: z.number().min(0, '무료 체험 기간은 0 이상이어야 합니다').optional(),
  isActive: z.boolean().optional(),
});

export const DeactivatePlanRequestSchema = z.object({
  reason: z
    .string()
    .min(1, { error: '비활성화 사유는 필수입니다' })
    .max(500, { error: '비활성화 사유는 500자 이하여야 합니다' }),
});

// Subscription Operations
export const CreateSubscriptionRequestSchema = z.object({
  planId: z.string().min(1, { error: 'planId는 필수입니다' }),
});

export const CreateCheckoutIntentRequestSchema = z.object({
  planId: z.string().min(1, { error: 'planId는 필수입니다' }),
  returnUrl: z.url({ error: '유효한 returnUrl이어야 합니다' }),
  billingMode: z.enum(['one_time', 'recurring']).optional(),
});

export const ConfirmCheckoutIntentRequestSchema = z.object({
  intentId: z.string().min(1, { error: 'intentId는 필수입니다' }),
});

export const UpgradeSubscriptionRequestSchema = z.object({
  newPlanId: z.uuid({ error: '유효한 UUID 형식이어야 합니다' }),
});

export const DowngradeSubscriptionRequestSchema = z.object({
  newPlanId: z.uuid({ error: '유효한 UUID 형식이어야 합니다' }),
  effectiveDate: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }).optional(),
});

export const PauseSubscriptionRequestSchema = z
  .object({
    startDate: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }),
    endDate: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }),
    reason: z.string().optional(),
  })
  .refine((data) => new Date(data.startDate) < new Date(data.endDate), {
    message: '시작일은 종료일보다 이전이어야 합니다',
    path: ['startDate'],
  });

export const CancelSubscriptionRequestSchema = z.object({
  reasonCode: z.string(),
  reasonText: z.string().optional(),
  reason: z.string().optional(), // 하위 호환성
  effectiveDate: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }).optional(),
});

export const ResumeSubscriptionRequestSchema = z.object({
  reason: z.string().optional(),
});

export const GetBulkSubscriptionsRequestSchema = z.object({
  id: z.array(z.string({ error: '사용자 ID는 필수입니다' })),
});

export const SubscribeWithMethodRequestSchema = z
  .object({
    planId: z.string().min(1, { error: 'planId는 필수입니다' }),
    billingMethodId: z.uuid({ error: '유효한 UUID 형식이어야 합니다' }),
    billingMode: z.enum(['one_time', 'recurring']).optional(),
    checkoutAttemptId: z.uuid({ error: '유효한 UUID 형식이어야 합니다' }).optional(),
  })
  .superRefine((data, ctx) => {
    const effectiveMode = data.billingMode ?? 'one_time';
    if (effectiveMode === 'one_time' && !data.checkoutAttemptId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['checkoutAttemptId'],
        message: 'one_time 결제 시 checkoutAttemptId는 필수입니다',
      });
    }
  });

// Type exports - Controller에서만 사용
export type CreateTierRequest = z.infer<typeof CreateTierRequestSchema>;
export type UpdateTierRequest = z.infer<typeof UpdateTierRequestSchema>;
export type CreatePlanRequest = z.infer<typeof CreatePlanRequestSchema>;
export type UpdatePlanRequest = z.infer<typeof UpdatePlanRequestSchema>;
export type DeactivatePlanRequest = z.infer<typeof DeactivatePlanRequestSchema>;
export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequestSchema>;
export type CreateCheckoutIntentRequest = z.infer<typeof CreateCheckoutIntentRequestSchema>;
export type ConfirmCheckoutIntentRequest = z.infer<typeof ConfirmCheckoutIntentRequestSchema>;
export type UpgradeSubscriptionRequest = z.infer<typeof UpgradeSubscriptionRequestSchema>;
export type DowngradeSubscriptionRequest = z.infer<typeof DowngradeSubscriptionRequestSchema>;
export type PauseSubscriptionRequest = z.infer<typeof PauseSubscriptionRequestSchema>;
export type ResumeSubscriptionRequest = z.infer<typeof ResumeSubscriptionRequestSchema>;
export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionRequestSchema>;
export type SubscribeWithMethodRequest = z.infer<typeof SubscribeWithMethodRequestSchema>;

// =================================================================
// Policy Management - 정책 관리 요청 검증용
// =================================================================

/**
 * 지원되는 정책 규칙 타입들
 * 새로운 정책 타입 추가 시 이 배열을 업데이트하세요
 */

export const POLICY_RULE_TYPES = [
  'MAX_PAUSES_PER_YEAR',
  'MIN_PAUSE_DURATION_DAYS',
  'MAX_PAUSE_DURATION_DAYS',
  'PAUSE_COOLDOWN_DAYS',
  'PAUSE_BLACKOUT_PERIODS',
  'PLAN_CHANGE_COOLDOWN_DAYS',
  'ALLOWED_PLAN_CHANGES',
  'DOWNGRADE_RESTRICTIONS',
  'UPGRADE_BENEFITS',
  'TIER_SPECIFIC_LIMITS',
  'VIP_USER_BENEFITS',
  'NEW_USER_GRACE_PERIOD',
  'PROMOTIONAL_PERIODS',
  'SEASONAL_RESTRICTIONS',
  'SPECIAL_EVENT_RULES',
] as const;

/**
 * 정책 규칙 값에 대한 기본 스키마
 * 각 정책 타입별로 더 구체적인 검증이 필요할 수 있습니다
 */
const PolicyRuleValueSchema = z.record(z.string(), z.unknown()).refine((value) => Object.keys(value).length > 0, {
  message: '정책 값은 최소 하나의 속성을 가져야 합니다',
});

export const CreatePolicyRequestSchema = z
  .object({
    ruleType: z.enum(POLICY_RULE_TYPES, {
      error: '유효한 정책 타입이어야 합니다',
    }),
    ruleValue: PolicyRuleValueSchema,
    tierId: z.uuid({ error: '유효한 티어 ID여야 합니다' }).optional(),
    validFrom: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }).optional(),
    validUntil: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }).optional(),
  })
  .refine(
    (data) => {
      if (data.validFrom && data.validUntil) {
        return new Date(data.validFrom) < new Date(data.validUntil);
      }
      return true;
    },
    {
      message: '유효 시작일은 종료일보다 이전이어야 합니다',
      path: ['validFrom'],
    },
  );

export const UpdatePolicyRequestSchema = z
  .object({
    ruleValue: PolicyRuleValueSchema.optional(),
    isActive: z.boolean().optional(),
    validFrom: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }).optional(),
    validUntil: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }).optional(),
  })
  .refine(
    (data) => {
      if (data.validFrom && data.validUntil) {
        return new Date(data.validFrom) < new Date(data.validUntil);
      }
      return true;
    },
    {
      message: '유효 시작일은 종료일보다 이전이어야 합니다',
      path: ['validFrom'],
    },
  );

export const PolicyValidationRequestSchema = z.object({
  userId: z.uuid({ error: '유효한 사용자 ID여야 합니다' }),
  action: z.string().min(1, { error: '액션은 필수입니다' }).max(100, { error: '액션은 100자 이하여야 합니다' }),
  context: z.record(z.string(), z.unknown(), {
    error: '컨텍스트는 객체 형태여야 합니다',
  }),
  policyIds: z.array(z.string().uuid({ error: '유효한 정책 ID여야 합니다' })).optional(),
});

export const BulkPolicyValidationRequestSchema = z.object({
  requests: z.array(PolicyValidationRequestSchema).min(1, '최소 1개의 요청이 필요합니다'),
});

export const GetPoliciesQuerySchema = z.object({
  ruleType: z.enum(POLICY_RULE_TYPES).optional(),
  tierId: z.uuid({ error: '유효한 티어 ID여야 합니다' }).optional(),
  isActive: z.boolean().optional(),
  page: z.number().min(1, { error: '페이지는 1 이상이어야 합니다' }).default(1).optional(),
  limit: z.number().min(1).max(100).default(20).optional(),
});

export const GetApplicablePoliciesQuerySchema = z.object({
  tierId: z.uuid({ error: '유효한 티어 ID여야 합니다' }).optional(),
  subscriptionId: z.uuid().optional(),
  currentDate: z.iso.datetime({ error: '유효한 날짜 형식이어야 합니다' }).optional(),
});

// =================================================================
// Entitlement Management - 구독 권한 관리 요청 검증용
// =================================================================

export const ExtendEntitlementRequestSchema = z.object({
  userId: z.uuid('유효한 사용자 ID여야 합니다'),
  days: z.number().int().min(-365, '최대 365일까지 차감 가능합니다').max(365, '최대 365일까지 연장 가능합니다'),
  reason: z.string().min(1, '사유는 필수입니다').max(500, '사유는 500자 이하여야 합니다'),
});

// Policy Management Request Types
export type CreatePolicyRequest = z.infer<typeof CreatePolicyRequestSchema>;
export type UpdatePolicyRequest = z.infer<typeof UpdatePolicyRequestSchema>;
export type PolicyValidationRequest = z.infer<typeof PolicyValidationRequestSchema>;
export type BulkPolicyValidationRequest = z.infer<typeof BulkPolicyValidationRequestSchema>;
export type GetPoliciesQuery = z.infer<typeof GetPoliciesQuerySchema>;
export type GetApplicablePoliciesQuery = z.infer<typeof GetApplicablePoliciesQuerySchema>;

// Entitlement Management Request Types
export type ExtendEntitlementRequest = z.infer<typeof ExtendEntitlementRequestSchema>;

// Force Cancel Subscription (Admin)
export const ForceCancelSubscriptionRequestSchema = z.object({
  reason: z.string().min(1, { error: '취소 사유는 필수입니다' }),
  refundType: z.enum(['FULL', 'PARTIAL', 'NONE'], {
    error: '유효한 환불 타입이어야 합니다',
  }),
  refundAmount: z.number().min(0, { error: '환불 금액은 0 이상이어야 합니다' }).optional(),
  adminNote: z.string().optional(),
});

export type ForceCancelSubscriptionRequest = z.infer<typeof ForceCancelSubscriptionRequestSchema>;
