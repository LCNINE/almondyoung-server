import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IntentSnapshotDto } from './intent-snapshot.dto';

const PAYMENT_REFERENCE_TYPES = ['STORE_ORDER', 'SUBSCRIPTION_BILLING'] as const;

export class CreateIntentDto {
  @ApiProperty({
    description: 'Business reference type',
    enum: PAYMENT_REFERENCE_TYPES,
    example: 'STORE_ORDER',
  })
  @IsString()
  @IsIn(PAYMENT_REFERENCE_TYPES)
  referenceType!: 'STORE_ORDER' | 'SUBSCRIPTION_BILLING';

  @ApiProperty({
    description: 'Business reference identifier',
    maxLength: 128,
    example: 'order-20260222-001',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  referenceId!: string;

  @ApiProperty({
    description: 'User identifier',
    maxLength: 128,
    example: 'user-123',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  userId!: string;

  @ApiProperty({
    description: 'ISO-4217 currency code',
    maxLength: 3,
    example: 'KRW',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency!: string;

  @ApiProperty({
    description: 'Total payable amount (minor units)',
    minimum: 0,
    example: 10000,
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  payableAmount!: number;

  @ApiProperty({
    description: 'Snapshot payload used for pricing validation',
    type: () => IntentSnapshotDto,
  })
  @IsObject()
  @ValidateNested()
  @Type(() => IntentSnapshotDto)
  snapshotPayload!: Record<string, unknown>;

  @ApiProperty({
    description: 'HMAC signature',
    example: '6c94a4f5f4e2f5d95e6...',
  })
  @IsString()
  @IsNotEmpty()
  signature!: string;

  @ApiProperty({
    description: 'Signature version',
    example: 'v1',
  })
  @IsString()
  @IsNotEmpty()
  signatureVersion!: string;

  @ApiProperty({
    description: 'Signature creation time (ISO-8601)',
    format: 'date-time',
    example: '2026-02-22T14:30:00.000Z',
  })
  @IsISO8601()
  signedAt!: string;

  @ApiPropertyOptional({
    description: 'Optional metadata',
    type: 'object',
    additionalProperties: true,
    example: {
      source: 'checkout-web',
    },
  })
  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
