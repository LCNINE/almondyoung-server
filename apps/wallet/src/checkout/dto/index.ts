import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IntentPurpose } from '../../schema';

export class CreateCheckoutSessionDto {
  @ApiProperty({ description: 'User ID' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  userId: string;

  @ApiProperty({ description: 'Payment amount' })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Currency (e.g. KRW)', maxLength: 3 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency: string;

  @ApiProperty({ description: 'Payment purpose', enum: ['PURCHASE', 'SUBSCRIPTION', 'REPAYMENT', 'PAYOUT'] })
  @IsEnum(['PURCHASE', 'SUBSCRIPTION', 'REPAYMENT', 'PAYOUT'])
  purpose: IntentPurpose;

  @ApiPropertyOptional({ description: 'Metadata (subscriberRef, subscriberType, etc.)' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiProperty({ description: 'Redirect URL on success' })
  @IsString()
  @IsNotEmpty()
  successUrl: string;

  @ApiProperty({ description: 'Redirect URL on cancel' })
  @IsString()
  @IsNotEmpty()
  cancelUrl: string;

  @ApiPropertyOptional({ description: 'Allow composite (points + external) payment' })
  @IsOptional()
  @IsBoolean()
  allowComposite?: boolean;
}

export class CompleteCheckoutSessionDto {
  @ApiProperty({ description: 'Linked payment intent ID' })
  @IsUUID()
  intentId: string;

  @ApiPropertyOptional({ description: 'Billing method ID (for creating billing agreement)' })
  @IsOptional()
  @IsUUID()
  billingMethodId?: string;
}

export class CheckoutSessionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  purpose: string;

  @ApiProperty()
  metadata: Record<string, unknown>;

  @ApiProperty()
  successUrl: string;

  @ApiProperty()
  cancelUrl: string;

  @ApiProperty()
  allowComposite: boolean;

  @ApiProperty()
  intentId: string | null;

  @ApiProperty()
  status: string;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;
}
