import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** 기간 조회 공통 파라미터. 날짜는 KST 달력 날짜(YYYY-MM-DD), 양끝 포함. */
export class StatisticsRangeQueryDto {
  @ApiProperty({ example: '2026-08-01', description: '조회 시작일 (KST, 포함)' })
  @Matches(DATE_ONLY, { message: 'from 은 YYYY-MM-DD 형식이어야 합니다' })
  from: string;

  @ApiProperty({ example: '2026-08-24', description: '조회 종료일 (KST, 포함)' })
  @Matches(DATE_ONLY, { message: 'to 는 YYYY-MM-DD 형식이어야 합니다' })
  to: string;

  @ApiPropertyOptional({ description: '판매 채널 필터 (생략 시 전체)' })
  @IsOptional()
  channel?: string;

  @ApiPropertyOptional({ enum: ['day', 'month', 'year'], default: 'day', description: '시계열 버킷 단위' })
  @IsOptional()
  @IsIn(['day', 'month', 'year'])
  granularity?: 'day' | 'month' | 'year' = 'day';
}

export class ProductStatisticsQueryDto extends StatisticsRangeQueryDto {
  @ApiPropertyOptional({ enum: ['revenue', 'quantity', 'orders'], default: 'revenue', description: '랭킹 정렬 기준' })
  @IsOptional()
  @IsIn(['revenue', 'quantity', 'orders'])
  sort?: 'revenue' | 'quantity' | 'orders' = 'revenue';

  @ApiPropertyOptional({ example: 20, default: 20, description: '랭킹 최대 행 수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({ enum: ['desc', 'asc'], default: 'desc', description: '랭킹 정렬 방향 — asc 는 하위(bottom-N) 조회' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc' = 'desc';
}

export class UnsoldProductsQueryDto extends StatisticsRangeQueryDto {
  @ApiPropertyOptional({ example: 50, default: 50, description: '최대 행 수' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
