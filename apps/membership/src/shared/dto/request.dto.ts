import { IsIn, IsNotEmpty, IsString, IsUUID } from 'class-validator';
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
  SubscribeWithMethodRequestSchema,

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
export class SubscribeWithMethodRequestDto extends createZodDto(SubscribeWithMethodRequestSchema) {}

// ===== Pause Operations Request DTOs =====

export class PauseSubscriptionRequestDto extends createZodDto(PauseSubscriptionRequestSchema) {}
export class ResumeSubscriptionRequestDto extends createZodDto(ResumeSubscriptionRequestSchema) {}

// ===== Admin Cancellation Operations Request DTOs =====

export class ForceCancelSubscriptionRequestDto extends createZodDto(ForceCancelSubscriptionRequestSchema) {}

export class GetBulkSubscriptionsRequestDto extends createZodDto(GetBulkSubscriptionsRequestSchema) {}

export class AdminSubscribeUserRequestDto {
  @ApiProperty({ description: '구독할 사용자 ID' })
  @IsString()
  @IsNotEmpty()
  userId: string;

  @ApiProperty({ description: '구독할 플랜 ID' })
  @IsUUID()
  planId: string;

  @ApiProperty({ description: '결제 방식', enum: ['one_time', 'recurring'], default: 'recurring' })
  @IsIn(['one_time', 'recurring'])
  billingMode: 'one_time' | 'recurring';
}
