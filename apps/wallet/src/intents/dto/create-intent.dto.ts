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
} from 'class-validator';

export class CreateIntentDto {
  @IsString()
  @IsIn(['STORE_ORDER', 'SUBSCRIPTION_BILLING'])
  referenceType!: 'STORE_ORDER' | 'SUBSCRIPTION_BILLING';

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  referenceId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  customerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  payableAmount!: number;

  @IsObject()
  snapshotPayload!: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  signature!: string;

  @IsString()
  @IsNotEmpty()
  signatureVersion!: string;

  @IsISO8601()
  signedAt!: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, unknown>;
}
