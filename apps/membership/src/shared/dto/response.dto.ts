/**
 * Response DTOs for Swagger documentation
 * Service 반환 타입을 기반으로 한 응답 스키마 정의
 */

import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ===== Base Response Schemas =====

const BaseResponseSchema = z.object({
  success: z.boolean(),
  meta: z.object({
    processedAt: z.string(),
  }).passthrough(),
});

const PaginatedResponseSchema = BaseResponseSchema.extend({
  count: z.number(),
});

// ===== Entity Schemas (Service 반환 타입 기반) =====

const TierSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string().nullable(),
  priorityLevel: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const PlanSchema = z.object({
  id: z.string().uuid(),
  tierId: z.string().uuid(),
  price: z.number(),
  currency: z.string(),
  durationDays: z.number(),
  trialDays: z.number(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const PlanWithTierSchema = z.object({
  plan: PlanSchema,
  tier: TierSchema,
});

const SubscriptionSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  planId: z.string().uuid(),
  status: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const PauseHistorySchema = z.object({
  id: z.string().uuid(),
  subscriptionId: z.string().uuid(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});

// ===== Plan Controller Response DTOs =====

const PlansListResponseSchema = PaginatedResponseSchema.extend({
  data: z.array(PlanWithTierSchema),
});

const PlanDetailsResponseSchema = BaseResponseSchema.extend({
  data: PlanWithTierSchema,
});

const TiersListResponseSchema = PaginatedResponseSchema.extend({
  data: z.array(TierSchema),
});

const TierPlansResponseSchema = PaginatedResponseSchema.extend({
  data: z.array(PlanSchema),
});

const TierBenefitsResponseSchema = BaseResponseSchema.extend({
  data: z.object({
    tier: TierSchema,
    plans: z.array(PlanSchema),
  }),
});

// ===== Subscription Controller Response DTOs =====

const SubscriptionDetailsResponseSchema = BaseResponseSchema.extend({
  data: SubscriptionSchema.extend({
    plan: PlanSchema,
    tier: TierSchema,
  }),
});

const SubscriptionHistoryResponseSchema = PaginatedResponseSchema.extend({
  data: z.array(SubscriptionSchema),
});

// ===== Pause Controller Response DTOs =====

const PauseHistoryResponseSchema = PaginatedResponseSchema.extend({
  data: z.array(PauseHistorySchema),
});

const PauseOperationResponseSchema = BaseResponseSchema.extend({
  data: z.object({
    pauseId: z.string().uuid(),
    subscriptionId: z.string().uuid(),
    startDate: z.string(),
    endDate: z.string(),
    status: z.string(),
  }),
});

// ===== Admin Controller Response DTOs =====

const AdminTierResponseSchema = BaseResponseSchema.extend({
  data: TierSchema,
});

const AdminPlanResponseSchema = BaseResponseSchema.extend({
  data: PlanSchema,
});

const AdminUserPauseHistoryResponseSchema = BaseResponseSchema.extend({
  data: z.object({
    userId: z.string().uuid(),
    pauseHistory: z.array(PauseHistorySchema),
    totalPauses: z.number(),
  }),
});

const AdminEntitlementResponseSchema = BaseResponseSchema.extend({
  data: z.object({
    userId: z.string().uuid(),
    adjustedDays: z.number(),
    newEndDate: z.string(),
    reason: z.string(),
  }),
});

const AdminBillingTestResponseSchema = BaseResponseSchema.extend({
  data: z.object({
    message: z.string(),
    status: z.string(),
    nextRun: z.string(),
    testData: z.string(),
  }),
});

// ===== Error Response DTOs =====

const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    message: z.string(),
    statusCode: z.number(),
    timestamp: z.string(),
  }),
});

// ===== Export DTOs using nestjs-zod =====

// Plan Controller DTOs
export class PlansListResponseDto extends createZodDto(PlansListResponseSchema) {}
export class PlanDetailsResponseDto extends createZodDto(PlanDetailsResponseSchema) {}
export class TiersListResponseDto extends createZodDto(TiersListResponseSchema) {}
export class TierPlansResponseDto extends createZodDto(TierPlansResponseSchema) {}
export class TierBenefitsResponseDto extends createZodDto(TierBenefitsResponseSchema) {}

// Subscription Controller DTOs
export class SubscriptionDetailsResponseDto extends createZodDto(SubscriptionDetailsResponseSchema) {}
export class SubscriptionHistoryResponseDto extends createZodDto(SubscriptionHistoryResponseSchema) {}

// Pause Controller DTOs
export class PauseHistoryResponseDto extends createZodDto(PauseHistoryResponseSchema) {}
export class PauseOperationResponseDto extends createZodDto(PauseOperationResponseSchema) {}

// Admin Controller DTOs
export class AdminTierResponseDto extends createZodDto(AdminTierResponseSchema) {}
export class AdminPlanResponseDto extends createZodDto(AdminPlanResponseSchema) {}
export class AdminUserPauseHistoryResponseDto extends createZodDto(AdminUserPauseHistoryResponseSchema) {}
export class AdminEntitlementResponseDto extends createZodDto(AdminEntitlementResponseSchema) {}
export class AdminBillingTestResponseDto extends createZodDto(AdminBillingTestResponseSchema) {}

// Error Response DTO
export class ErrorResponseDto extends createZodDto(ErrorResponseSchema) {}