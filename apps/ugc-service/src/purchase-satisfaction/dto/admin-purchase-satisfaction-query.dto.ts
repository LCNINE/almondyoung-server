import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { PURCHASE_SATISFACTION_REASONS, type PurchaseSatisfactionReason } from '../types';

const toBoolean = ({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value);

export class AdminPurchaseSatisfactionQueryDto {
  @ApiPropertyOptional({ example: '2026-10-01', description: 'KST 달력 날짜 (YYYY-MM-DD), 수정 시각 기준' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-28', description: 'KST 달력 날짜, 해당 일 포함' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;

  @ApiPropertyOptional({ enum: ['all', 'low', 'high'], description: 'low 는 3점 이하, high 는 4점 이상' })
  @IsOptional()
  @IsIn(['all', 'low', 'high'])
  score?: 'all' | 'low' | 'high';

  @ApiPropertyOptional({ enum: PURCHASE_SATISFACTION_REASONS })
  @IsOptional()
  @IsIn(PURCHASE_SATISFACTION_REASONS)
  reason?: PurchaseSatisfactionReason;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  hasMemo?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unchecked?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
