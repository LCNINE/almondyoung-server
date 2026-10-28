import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { PURCHASE_SATISFACTION_REASONS, type PurchaseSatisfactionReason } from '../types';

export class UpsertPurchaseSatisfactionDto {
  @ApiProperty({ format: 'uuid', description: '주문 고객의 almond user id' })
  @IsUUID()
  userId: string;

  @ApiProperty({ minimum: 1, description: '어드민 표시용 주문번호' })
  @IsInt()
  @Min(1)
  orderDisplayId: number;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ enum: PURCHASE_SATISFACTION_REASONS, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(PURCHASE_SATISFACTION_REASONS, { each: true })
  reasons?: PurchaseSatisfactionReason[];

  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  memo?: string;
}
