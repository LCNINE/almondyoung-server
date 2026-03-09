/**
 * Request DTOs for Swagger documentation
 * 기존 Zod 스키마를 nestjs-zod DTO로 변환
 */

import { createZodDto } from 'nestjs-zod';
import {
  // Admin Operations
  CreateTierRequestSchema,
  UpdateTierRequestSchema,
  CreatePlanRequestSchema,
  UpdatePlanRequestSchema,
  DeactivatePlanRequestSchema,
  ExtendEntitlementRequestSchema,

  // Subscription Operations
  CreateSubscriptionRequestSchema,
  CreateCheckoutIntentRequestSchema,
  ConfirmCheckoutIntentRequestSchema,
  UpgradeSubscriptionRequestSchema,
  DowngradeSubscriptionRequestSchema,
  CancelSubscriptionRequestSchema,

  // Pause Operations
  PauseSubscriptionRequestSchema,
  ResumeSubscriptionRequestSchema,
  GetBulkSubscriptionsRequestSchema,
  ForceCancelSubscriptionRequestSchema,
} from '../schemas/requests';

// ===== Admin Operations Request DTOs =====

export class CreateTierRequestDto extends createZodDto(
  CreateTierRequestSchema,
) {}
export class UpdateTierRequestDto extends createZodDto(
  UpdateTierRequestSchema,
) {}
export class CreatePlanRequestDto extends createZodDto(
  CreatePlanRequestSchema,
) {}
export class UpdatePlanRequestDto extends createZodDto(
  UpdatePlanRequestSchema,
) {}
export class DeactivatePlanRequestDto extends createZodDto(
  DeactivatePlanRequestSchema,
) {}
export class ExtendEntitlementRequestDto extends createZodDto(
  ExtendEntitlementRequestSchema,
) {}

// ===== Subscription Operations Request DTOs =====

export class CreateSubscriptionRequestDto extends createZodDto(
  CreateSubscriptionRequestSchema,
) {}
export class CreateCheckoutIntentRequestDto extends createZodDto(
  CreateCheckoutIntentRequestSchema,
) {}
export class ConfirmCheckoutIntentRequestDto extends createZodDto(
  ConfirmCheckoutIntentRequestSchema,
) {}
export class UpgradeSubscriptionRequestDto extends createZodDto(
  UpgradeSubscriptionRequestSchema,
) {}
export class DowngradeSubscriptionRequestDto extends createZodDto(
  DowngradeSubscriptionRequestSchema,
) {}
export class CancelSubscriptionRequestDto extends createZodDto(
  CancelSubscriptionRequestSchema,
) {}

// ===== Pause Operations Request DTOs =====

export class PauseSubscriptionRequestDto extends createZodDto(
  PauseSubscriptionRequestSchema,
) {}
export class ResumeSubscriptionRequestDto extends createZodDto(
  ResumeSubscriptionRequestSchema,
) {}

// ===== Admin Cancellation Operations Request DTOs =====

export class ForceCancelSubscriptionRequestDto extends createZodDto(
  ForceCancelSubscriptionRequestSchema,
) {}

export class GetBulkSubscriptionsRequestDto extends createZodDto(
  GetBulkSubscriptionsRequestSchema,
) {}
