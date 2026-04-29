import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsUUID, Min } from 'class-validator';
import { Type } from 'class-transformer';

export type StocktakingStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export class ListStocktakingSessionsQueryDto {
  @ApiProperty({ description: '창고 ID (UUID)', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({
    description: '세션 상태 필터',
    enum: ['draft', 'in_progress', 'completed', 'cancelled'],
    required: false,
  })
  @IsOptional()
  @IsEnum(['draft', 'in_progress', 'completed', 'cancelled'])
  status?: StocktakingStatus;

  @ApiProperty({ description: '시작일 필터 (ISO 8601, createdAt 기준)', required: false, example: '2025-01-01' })
  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @ApiProperty({ description: '종료일 필터 (ISO 8601, createdAt 기준)', required: false, example: '2025-12-31' })
  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @ApiProperty({ description: '페이지 번호 (1-based)', required: false, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: '페이지당 항목 수', required: false, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}
