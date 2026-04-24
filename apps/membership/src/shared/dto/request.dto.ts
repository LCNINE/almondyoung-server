import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
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

export class CreateTierRequestDto extends createZodDto(CreateTierRequestSchema) {}
export class UpdateTierRequestDto extends createZodDto(UpdateTierRequestSchema) {}
export class CreatePlanRequestDto extends createZodDto(CreatePlanRequestSchema) {}
export class UpdatePlanRequestDto extends createZodDto(UpdatePlanRequestSchema) {}
export class DeactivatePlanRequestDto extends createZodDto(DeactivatePlanRequestSchema) {}
export class ExtendEntitlementRequestDto extends createZodDto(ExtendEntitlementRequestSchema) {}

// ===== Subscription Operations Request DTOs =====

export class CreateSubscriptionRequestDto extends createZodDto(CreateSubscriptionRequestSchema) {}
export class CreateCheckoutIntentRequestDto extends createZodDto(CreateCheckoutIntentRequestSchema) {}
export class ConfirmCheckoutIntentRequestDto extends createZodDto(ConfirmCheckoutIntentRequestSchema) {}
export class UpgradeSubscriptionRequestDto extends createZodDto(UpgradeSubscriptionRequestSchema) {}
export class DowngradeSubscriptionRequestDto extends createZodDto(DowngradeSubscriptionRequestSchema) {}
export class CancelSubscriptionRequestDto extends createZodDto(CancelSubscriptionRequestSchema) {}

// ===== Pause Operations Request DTOs =====

export class PauseSubscriptionRequestDto extends createZodDto(PauseSubscriptionRequestSchema) {}
export class ResumeSubscriptionRequestDto extends createZodDto(ResumeSubscriptionRequestSchema) {}

// ===== Admin Cancellation Operations Request DTOs =====

export class ForceCancelSubscriptionRequestDto extends createZodDto(ForceCancelSubscriptionRequestSchema) {}

export class GetBulkSubscriptionsRequestDto extends createZodDto(GetBulkSubscriptionsRequestSchema) {}

export class SubscribeWithMethodRequestDto {
  @ApiProperty({ description: 'Plan ID to subscribe to' })
  @IsString()
  @IsNotEmpty()
  planId: string;

  @ApiProperty({ description: 'Billing method ID to charge' })
  @IsUUID()
  billingMethodId: string;

  @ApiProperty({ description: '결제 방식. recurring=7일 무료체험 후 자동결제, one_time=즉시결제', enum: ['one_time', 'recurring'], default: 'one_time' })
  @IsOptional()
  @IsIn(['one_time', 'recurring'])
  billingMode?: 'one_time' | 'recurring';
}
